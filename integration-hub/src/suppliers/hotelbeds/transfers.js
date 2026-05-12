import { randomUUID } from 'crypto';
import { SupplierBase } from '../base.js';
import { buildHeaders } from './auth.js';
import { normalize } from '../../normalization/pipeline.js';

const SANDBOX = 'https://api.test.hotelbeds.com/transfer-api/1.0';
const PROD = 'https://api.hotelbeds.com/transfer-api/1.0';

export class HotelbedsTransfers extends SupplierBase {
  constructor({ apiKey, secretKey, env = 'sandbox' }) {
    super({ slug: 'hotelbeds-transfers', baseUrl: env === 'production' ? PROD : SANDBOX, rateLimitRpm: 500 });
    this.apiKey = apiKey;
    this.secretKey = secretKey;
  }

  _headers() { return buildHeaders(this.apiKey, this.secretKey); }

  async search(params) {
    const tripId = params.trip_id || randomUUID();
    const data = await this.request({
      method: 'GET', url: '/transfers/availability',
      headers: this._headers(), params, operation: 'search',
    });
    return normalize(data, 'hotelbeds-transfers', { tripId });
  }

  async returnSearch(params, outboundTripId) {
    const data = await this.request({
      method: 'GET', url: '/transfers/availability',
      headers: this._headers(), params, operation: 'return_search',
    });
    return normalize(data, 'hotelbeds-transfers', { tripId: outboundTripId });
  }

  async detail(id) {
    const data = await this.request({
      method: 'GET', url: `/transfers/${id}`,
      headers: this._headers(), operation: 'detail',
    });
    return normalize({ transfers: [data.transfer || data] }, 'hotelbeds-transfers');
  }

  async book(payload) {
    return this.request({
      method: 'POST', url: '/bookings',
      headers: this._headers(), data: payload, operation: 'book',
    });
  }

  async get(ref, lang = 'en') {
    return this.request({
      method: 'GET', url: `/bookings/${lang}/reference/${ref}`,
      headers: this._headers(), operation: 'get',
    });
  }

  async cancel(ref, lang = 'en') {
    return this.request({
      method: 'DELETE', url: `/bookings/${lang}/reference/${ref}`,
      headers: this._headers(), operation: 'cancel',
    });
  }
}
