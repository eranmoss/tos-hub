import { createHash } from 'crypto';
import nock from 'nock';
import { buildHeaders } from '../../src/suppliers/hotelbeds/auth.js';
import { SupplierBase } from '../../src/suppliers/base.js';

describe('Layer 3: HotelBeds auth', () => {
  test('signature is SHA256(apiKey + secretKey + timestamp)', () => {
    const headers = buildHeaders('KEY', 'SECRET', 1700000000);
    const expected = createHash('sha256').update('KEYSECRET1700000000').digest('hex');
    expect(headers['X-Signature']).toBe(expected);
    expect(headers['X-Api-Key']).toBe('KEY');
    expect(headers['X-Timestamp']).toBe('1700000000');
  });
});

describe('Layer 3: SupplierBase', () => {
  afterEach(() => nock.cleanAll());

  test('retries on 5xx up to 3 times', async () => {
    const scope = nock('https://api.test')
      .get('/x').reply(500)
      .get('/x').reply(500)
      .get('/x').reply(200, { ok: true });
    const s = new SupplierBase({ slug: 'test', baseUrl: 'https://api.test', maxRetries: 3 });
    const res = await s.request({ method: 'GET', url: '/x' });
    expect(res).toEqual({ ok: true });
    expect(scope.isDone()).toBe(true);
  });

  test('gives up after maxRetries', async () => {
    nock('https://api.test').get('/y').times(3).reply(500);
    const s = new SupplierBase({ slug: 'test', baseUrl: 'https://api.test', maxRetries: 3 });
    await expect(s.request({ method: 'GET', url: '/y' })).rejects.toThrow(/500/);
  });

  test('4xx is not retried', async () => {
    const scope = nock('https://api.test').get('/z').reply(404, { err: 'not found' });
    const s = new SupplierBase({ slug: 'test', baseUrl: 'https://api.test', maxRetries: 3 });
    await expect(s.request({ method: 'GET', url: '/z' })).rejects.toThrow(/404/);
    expect(scope.isDone()).toBe(true);
  });

  test('timeout fires at configured ms', async () => {
    nock('https://api.test').get('/slow').delay(500).reply(200, {});
    const s = new SupplierBase({ slug: 'test', baseUrl: 'https://api.test', timeoutMs: 100, maxRetries: 1 });
    await expect(s.request({ method: 'GET', url: '/slow' })).rejects.toThrow();
  });
});
