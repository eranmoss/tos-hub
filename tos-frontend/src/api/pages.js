import { get, put, del } from './client.js';
import { config } from '../config.js';

export function listPages() {
  return get('/v1/pages');
}

/**
 * Fetch an active page manifest by slug — public endpoint, no auth required.
 * Passes tenant_id from config so the hub can scope the query.
 */
export function getPage(slug) {
  const tid = config.tenantId || '';
  return get(`/v1/pages-public/${encodeURIComponent(slug)}?tenant_id=${encodeURIComponent(tid)}`);
}

/** Get a manifest by ID or slug — requires JWT auth (Partner Dashboard). */
export function getPageById(idOrSlug) {
  return get(`/v1/pages/${idOrSlug}`);
}

/**
 * Create or update a page manifest.
 * Requires JWT auth.
 * @param {string} id  UUID (use crypto.randomUUID() for new pages)
 * @param {{ slug: string, title: string, manifest: object }} payload
 */
export function savePage(id, payload) {
  return put(`/v1/pages/${id}`, payload);
}

/**
 * Delete a page manifest.
 * Requires JWT auth.
 * @param {string} id
 */
export function deletePage(id) {
  return del(`/v1/pages/${id}`);
}

/**
 * Get the component registry (all registered Web Components + schemas).
 * Used by the Builder Agent UI to know what components are available.
 */
export function getComponentRegistry() {
  return get('/v1/components');
}
