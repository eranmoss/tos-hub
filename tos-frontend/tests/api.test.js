import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiError } from '../src/api/client.js';
import * as catalog from '../src/api/catalog.js';

// ── client.js ───────────────────────────────────────────────────────────────

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds Authorization header when token present', async () => {
    const { config } = await import('../src/config.js');
    config.auth.token = 'test-jwt';

    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true }),
    });

    await apiFetch('/v1/test');
    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer test-jwt');
  });

  it('throws ApiError on non-ok response', async () => {
    fetch.mockResolvedValueOnce({
      ok: false, status: 500,
      json: async () => ({ error: 'server error' }),
    });

    await expect(apiFetch('/v1/fail')).rejects.toThrow(ApiError);
  });

  it('throws ApiError with status 429 on rate limit', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    const err = await apiFetch('/v1/rate').catch(e => e);
    expect(err.status).toBe(429);
  });

  it('dispatches tos:auth-expired on 401', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    const events = [];
    window.addEventListener('tos:auth-expired', () => events.push(true));

    await apiFetch('/v1/secure').catch(() => {});
    expect(events.length).toBe(1);
  });

  it('returns null on 204 No Content', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 204 });
    const result = await apiFetch('/v1/empty');
    expect(result).toBeNull();
  });
});

// ── catalog.js ──────────────────────────────────────────────────────────────

describe('catalog.browse', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('calls /v1/catalog/browse with no params', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    await catalog.browse();
    expect(fetch.mock.calls[0][0]).toContain('/v1/catalog/browse');
  });

  it('appends type param to query string', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    await catalog.browse({ type: 'HOTEL' });
    expect(fetch.mock.calls[0][0]).toContain('type=HOTEL');
  });

  it('omits null/empty params from query string', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    await catalog.browse({ type: 'HOTEL', destination: null, city: '' });
    const url = fetch.mock.calls[0][0];
    expect(url).not.toContain('destination');
    expect(url).not.toContain('city');
  });
});

describe('catalog.search', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('sends q param to /v1/catalog/search', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    await catalog.search('Paris tours');
    const url = fetch.mock.calls[0][0];
    expect(url).toContain('/v1/catalog/search');
    expect(url).toContain('q=Paris+tours');
  });
});

describe('catalog.availability', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs to /v1/catalog/:id/availability', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await catalog.availability('abc-123', { date: '2026-06-01', guests: 2 });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain('/v1/catalog/abc-123/availability');
    expect(opts.method).toBe('POST');
  });
});
