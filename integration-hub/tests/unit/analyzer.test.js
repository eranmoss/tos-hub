import nock from 'nock';
import { analyzeDocs } from '../../src/onboarding/analyzer.js';

const OAUTH2_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Bridgify API' },
  servers: [{ url: 'https://api.bridgify.io' }],
  paths: {
    '/accounts/token/': { post: { summary: 'OAuth token' } },
    '/attractions/products/': { get: { summary: 'Search products', tags: ['attractions'] } },
    '/attractions/products/{product_id}': { get: { summary: 'Product detail' } },
    '/attractions/products/availability/{product_id}': { get: { summary: 'Product availability' } },
    '/attractions/bookings/': { post: { summary: 'Create booking', tags: ['bookings'] } },
    '/attractions/bookings/{id}': { delete: { summary: 'Cancel booking' } },
  },
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          clientCredentials: {
            tokenUrl: '/accounts/token/',
            scopes: { read: 'read', write: 'write' },
          },
        },
      },
    },
  },
};

const API_KEY_SPEC = {
  openapi: '3.0.3',
  info: { title: 'ApiKey Supplier' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/products': { get: { summary: 'List products' } },
    '/bookings': { post: { summary: 'Create booking' } },
  },
  components: {
    securitySchemes: {
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
    },
  },
};

describe('OpenAPI analyzer', () => {
  afterEach(() => nock.cleanAll());

  test('detects OAuth2 client credentials, token URL, operations', async () => {
    const host = 'https://docs.bridgify.io';
    nock(host).get('/').reply(200, '<html>docs SPA shell</html>', { 'content-type': 'text/html' });
    nock(host).get('/openapi.yaml').reply(200, JSON.stringify(OAUTH2_SPEC), { 'content-type': 'application/json' });

    const r = await analyzeDocs({ url: `${host}/` });

    expect(r.ok).toBe(true);
    expect(r.mode).toBe('OPENAPI');
    expect(r.auth.auth_type).toBe('OAUTH2_CLIENT_CREDENTIALS');
    expect(r.auth.credential_fields).toEqual(['client_id', 'client_secret']);
    expect(r.auth.token_url).toBe('https://api.bridgify.io/accounts/token/');
    expect(r.auth.scopes).toEqual(expect.arrayContaining(['read', 'write']));
    expect(r.base_url_sandbox).toBe('https://api.bridgify.io');
    expect(r.operations.search).toBeDefined();
    expect(r.operations.book).toBeDefined();
    expect(r.operations.cancel).toBeDefined();
    expect(r.supplier_name).toBe('Bridgify API');
  });

  test('detects API_KEY auth with header location', async () => {
    const host = 'https://example.com';
    nock(host).get('/docs').reply(200, JSON.stringify(API_KEY_SPEC), { 'content-type': 'application/json' });

    const r = await analyzeDocs({ url: `${host}/docs` });

    expect(r.ok).toBe(true);
    expect(r.auth.auth_type).toBe('API_KEY');
    expect(r.auth.credential_fields).toEqual(['api_key']);
    expect(r.auth.api_key_location).toBe('header');
    expect(r.auth.api_key_name).toBe('X-Api-Key');
  });

  test('returns HTML_FALLBACK_UNAVAILABLE when no spec found', async () => {
    const host = 'https://no-openapi.example.com';
    nock(host).get('/').reply(200, '<html>nothing</html>', { 'content-type': 'text/html' });
    for (const p of ['openapi.yaml', 'openapi.json', 'swagger.yaml', 'swagger.json', 'api-docs.json']) {
      nock(host).get(`/${p}`).reply(404);
    }

    const r = await analyzeDocs({ url: `${host}/` });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe('HTML_FALLBACK_UNAVAILABLE');
    expect(Array.isArray(r.attempts)).toBe(true);
  });

  test('rejects invalid URL', async () => {
    await expect(analyzeDocs({ url: 'not-a-url' })).rejects.toThrow(/url/i);
  });
});
