import axios from 'axios';
import { SupplierBase } from '../base.js';
import { normalize } from '../../normalization/pipeline.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

// Bridgify uses OAuth2 client credentials.
// Pattern matches the working Flask client in app/routes/bridgify_api.py:
//   POST {base}/accounts/token/  form-encoded → { access_token, expires_in }
//   Authorization: Bearer <token> on subsequent calls.
// Token cache is per-instance; in a multi-process setup move it to Redis.

export class BridgifyExperiences extends SupplierBase {
  constructor({ apiKey, clientId, clientSecret, baseUrl } = {}) {
    super({
      slug: 'bridgify',
      baseUrl: (baseUrl || 'https://api.bridgify.io').replace(/\/+$/, ''),
      rateLimitRpm: 60,
    });
    // `apiKey` is treated as `client_id` for backward compatibility with the
    // earlier scaffold; explicit clientId wins.
    this.clientId = clientId || apiKey;
    this.clientSecret = clientSecret;
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  async _getToken({ forceRefresh = false } = {}) {
    const now = Math.floor(Date.now() / 1000);
    if (!forceRefresh && this._token && now < this._tokenExpiresAt) return this._token;
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Bridgify credentials missing client_id / client_secret');
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials',
      scope: 'read write',
    }).toString();
    const res = await axios.post(`${this.baseUrl}/accounts/token/`, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      timeout: 10000,
    });
    const token = res.data?.access_token;
    if (!token) throw new Error('Bridgify token response missing access_token');
    const expiresIn = Number(res.data?.expires_in || 3600);
    this._token = token;
    this._tokenExpiresAt = now + Math.max(60, expiresIn - 60);
    log('info', 'bridgify_token_refreshed', { ttl_s: expiresIn });
    return token;
  }

  async _authedRequest(opts) {
    const token = await this._getToken();
    return this.request({
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  }

  async search(params = {}) {
    const data = await this._authedRequest({
      method: 'GET', url: '/attractions/products/', params, operation: 'search',
    });
    const list = data?.attractions || data?.results || data?.items || data?.experiences || [];
    return normalize({ experiences: list }, 'bridgify');
  }

  async detail(id) {
    const data = await this._authedRequest({
      method: 'GET', url: `/attractions/products/${id}/`, operation: 'detail',
    });
    return normalize({ experiences: [data.attraction || data.product || data] }, 'bridgify');
  }

  async availability(id, params) {
    return this._authedRequest({
      method: 'GET', url: `/attractions/products/${id}/availability/`, params, operation: 'availability',
    });
  }

  async book(payload) {
    return this._authedRequest({
      method: 'POST', url: '/bookings/', data: payload,
      headers: { 'Content-Type': 'application/json' }, operation: 'book',
    });
  }

  async get(ref) {
    return this._authedRequest({
      method: 'GET', url: `/bookings/${ref}/`, operation: 'get',
    });
  }

  async cancel(ref) {
    return this._authedRequest({
      method: 'DELETE', url: `/bookings/${ref}/`, operation: 'cancel',
    });
  }
}
