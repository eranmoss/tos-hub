/**
 * Reads window.TOS_CONFIG injected by the host runtime.
 * Provides defaults for every key so the bundle is safe to load
 * even if the host only sets a subset.
 *
 * Host contract (what a Flask / Express / static host must inject):
 *
 *   window.TOS_CONFIG = {
 *     apiBase:   "https://api.tos-hub.com",  // Integration Hub URL
 *     pageSlug:  "home",                      // manifest page to load (null = use router)
 *     tenantId:  "acme-travel",              // tenant scoping
 *     branding: {
 *       primaryColor: "#0D3B6E",
 *       logoUrl:      "/logo.png",
 *       fontFamily:   "Inter",
 *     },
 *     auth: {
 *       token: "<jwt>",                       // optional; null = unauthenticated
 *     },
 *   };
 */

const HOST_CONFIG = (typeof window !== 'undefined' && window.TOS_CONFIG) || {};
const _url = (typeof window !== 'undefined') ? new URLSearchParams(window.location.search) : null;

export const config = {
  apiBase:  HOST_CONFIG.apiBase  || 'http://localhost:3000',
  pageSlug: HOST_CONFIG.pageSlug || _url?.get('pageSlug') || null,
  tenantId: HOST_CONFIG.tenantId || _url?.get('tenantId') || null,
  preview:  HOST_CONFIG.preview  || _url?.get('preview')  || null,

  branding: {
    primaryColor: HOST_CONFIG.branding?.primaryColor || '#0D3B6E',
    logoUrl:      HOST_CONFIG.branding?.logoUrl      || null,
    fontFamily:   HOST_CONFIG.branding?.fontFamily   || 'Inter',
  },

  auth: {
    token: HOST_CONFIG.auth?.token || null,
  },
};

/** Returns the stored JWT — checks config first, then localStorage fallback. */
export function getToken() {
  return config.auth.token || localStorage.getItem('tos_jwt') || null;
}

/** Persists a JWT to localStorage and updates in-memory config. */
export function setToken(token) {
  config.auth.token = token;
  localStorage.setItem('tos_jwt', token);
}

/** Clears auth state. */
export function clearToken() {
  config.auth.token = null;
  localStorage.removeItem('tos_jwt');
}
