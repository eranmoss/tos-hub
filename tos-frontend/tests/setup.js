// Global test setup for jsdom environment

// Provide a default window.TOS_CONFIG so src/config.js doesn't throw
globalThis.window = globalThis.window || {};
window.TOS_CONFIG = {
  apiBase:  'http://localhost:3000',
  pageSlug: null,
  tenantId: 'test-tenant',
  branding: { primaryColor: '#0D3B6E', fontFamily: 'Inter' },
  auth:     { token: 'test-jwt-token' },
};
