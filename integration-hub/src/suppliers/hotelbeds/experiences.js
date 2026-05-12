import { SupplierBase } from '../base.js';
import { buildHeaders } from './auth.js';
import { normalize } from '../../normalization/pipeline.js';

const SANDBOX = 'https://api.test.hotelbeds.com/activity-api/1.0';
const PROD = 'https://api.hotelbeds.com/activity-api/1.0';

export class HotelbedsExperiences extends SupplierBase {
  constructor({ apiKey, secretKey, env = 'sandbox' }) {
    super({ slug: 'hotelbeds-activities', baseUrl: env === 'production' ? PROD : SANDBOX, rateLimitRpm: 500 });
    this.apiKey = apiKey;
    this.secretKey = secretKey;
  }

  _headers() { return buildHeaders(this.apiKey, this.secretKey); }

  async search(params) {
    const data = await this.request({
      method: 'GET', url: '/activities',
      headers: this._headers(), params, operation: 'search',
    });
    return normalize(data, 'hotelbeds-activities');
  }

  async detail(activityCode) {
    const data = await this.request({
      method: 'GET', url: `/activities/${activityCode}`,
      headers: this._headers(), operation: 'detail',
    });
    return normalize({ activities: [data.activity || data] }, 'hotelbeds-activities');
  }

  async availability(params) {
    const data = await this.request({
      method: 'GET', url: '/activities',
      headers: this._headers(), params, operation: 'availability',
    });
    return normalize(data, 'hotelbeds-activities');
  }

  async book(payload) {
    return this.request({
      method: 'POST', url: '/bookings',
      headers: this._headers(), data: payload, operation: 'book',
    });
  }

  async confirm(ref) {
    return this.request({
      method: 'POST', url: `/bookings/${ref}/confirmation`,
      headers: this._headers(), operation: 'confirm',
    });
  }

  async get(ref) {
    return this.request({
      method: 'GET', url: `/bookings/${ref}`,
      headers: this._headers(), operation: 'get',
    });
  }

  async cancel(ref) {
    return this.request({
      method: 'DELETE', url: `/bookings/${ref}`,
      headers: this._headers(), operation: 'cancel',
    });
  }
}
