import { config, getToken, clearToken } from '../config.js';

/**
 * Base fetch wrapper for all Integration Hub API calls.
 * Reads apiBase and auth token from TOS_CONFIG at call time
 * (not at import time) so late-injected config works correctly.
 */

/** @param {string} path  @param {RequestInit} options */
export async function apiFetch(path, options = {}) {
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const url = `${config.apiBase}${path}`;

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    // Dispatch an event so the shell can redirect to login
    window.dispatchEvent(new CustomEvent('tos:auth-expired'));
    throw new ApiError(401, 'Unauthorised');
  }

  if (res.status === 429) {
    throw new ApiError(429, 'Rate limit exceeded — please try again shortly');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || body.message || res.statusText, body);
  }

  // 204 No Content
  if (res.status === 204) return null;

  return res.json();
}

export class ApiError extends Error {
  constructor(status, message, body = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Convenience helpers */
export const get  = (path, opts = {}) => apiFetch(path, { method: 'GET',    ...opts });
export const post = (path, body, opts = {}) =>
  apiFetch(path, { method: 'POST',   body: JSON.stringify(body), ...opts });
export const put  = (path, body, opts = {}) =>
  apiFetch(path, { method: 'PUT',    body: JSON.stringify(body), ...opts });
export const del  = (path, opts = {}) => apiFetch(path, { method: 'DELETE', ...opts });
