import { get, post } from './client.js';

/**
 * Typed wrappers for Integration Hub public catalog endpoints.
 * All params are plain objects — serialised to query strings where needed.
 */

/** Serialize an object to a URL query string, omitting null/undefined values. */
function toQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') q.set(k, v);
  }
  const str = q.toString();
  return str ? `?${str}` : '';
}

/**
 * Browse paginated inventory.
 * @param {{ type?, destination?, city?, category?, sort?, limit?, offset? }} params
 */
export function browse(params = {}) {
  return get(`/v1/catalog/browse${toQuery(params)}`);
}

/**
 * Semantic keyword / natural language search.
 * @param {string} query
 * @param {{ type?, destination?, limit?, min_score? }} params
 */
export function search(query, params = {}) {
  return get(`/v1/catalog/search${toQuery({ q: query, ...params })}`);
}

/**
 * Full product detail.
 * @param {string} id  hub_static_inventory UUID
 */
export function detail(id) {
  return get(`/v1/catalog/${id}`);
}

/**
 * Event occurrences for a product (same title + location, different dates).
 * @param {string} id
 */
export function occurrences(id) {
  return get(`/v1/catalog/${id}/occurrences`);
}

/**
 * Live availability check for a single product.
 * @param {string} id
 * @param {{ date?, guests?, rooms? }} params
 */
export function availability(id, params = {}) {
  return post(`/v1/catalog/${id}/availability`, params);
}

/**
 * Batch availability for up to 20 products.
 * @param {{ ids: string[], date?, guests? }} payload
 */
export function batchAvailability(payload) {
  return post('/v1/catalog/availability', payload);
}

/**
 * Book a product.
 * @param {string} id
 * @param {{ guests: object[], date: string, contact: object, payment?: object }} payload
 */
export function book(id, payload) {
  return post(`/v1/catalog/${id}/book`, payload);
}

/**
 * Home page collection carousels.
 * Returns { sections: [{ title, type, items[] }] }
 */
export function homeCollections() {
  return get('/v1/catalog/collections/home');
}

/**
 * Points of interest catalog.
 * @param {{ destination?, city?, category?, limit?, offset? }} params
 */
export function pois(params = {}) {
  return get(`/v1/catalog/pois${toQuery(params)}`);
}

/**
 * Cities with inventory counts.
 */
export function cities() {
  return get('/v1/catalog/cities');
}

/**
 * Canonical category taxonomy.
 */
export function categories() {
  return get('/v1/catalog/categories');
}
