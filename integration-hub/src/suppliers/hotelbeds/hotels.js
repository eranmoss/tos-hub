import { SupplierBase } from '../base.js';
import { buildHeaders } from './auth.js';
import { normalize } from '../../normalization/pipeline.js';
import { query } from '../../db/client.js';

const SANDBOX_BOOKING = 'https://api.test.hotelbeds.com/hotel-api/1.2';
const SANDBOX_CONTENT = 'https://api.test.hotelbeds.com/hotel-content-api/1.0';
const PROD_BOOKING = 'https://api.hotelbeds.com/hotel-api/1.2';
const PROD_CONTENT = 'https://api.hotelbeds.com/hotel-content-api/1.0';

const CACHE_TTL_HOURS = 24;

export class HotelbedsHotels extends SupplierBase {
  constructor({ apiKey, secretKey, env = 'sandbox' }) {
    const base = env === 'production' ? PROD_BOOKING : SANDBOX_BOOKING;
    super({ slug: 'hotelbeds-hotels', baseUrl: base, rateLimitRpm: 500 });
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.contentBaseUrl = env === 'production' ? PROD_CONTENT : SANDBOX_CONTENT;
  }

  _headers() { return buildHeaders(this.apiKey, this.secretKey); }

  async getContent(hotelCode) {
    try {
      const res = await query(
        `SELECT * FROM hotel_content
         WHERE hotel_code = $1 AND cached_at > now() - INTERVAL '${CACHE_TTL_HOURS} hours'`,
        [String(hotelCode)]
      );
      if (res.rows[0]) return res.rows[0];
    } catch {}
    const data = await this.request({
      method: 'GET',
      url: `${this.contentBaseUrl}/hotels/${hotelCode}`,
      headers: this._headers(),
      operation: 'content',
    });
    const h = data.hotel || data;
    try {
      await query(
        `INSERT INTO hotel_content(hotel_code, supplier_slug, name, description, star_rating, latitude, longitude, country_code, city, timezone, image_urls, cached_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         ON CONFLICT (hotel_code) DO UPDATE SET
           name=EXCLUDED.name, description=EXCLUDED.description,
           star_rating=EXCLUDED.star_rating, latitude=EXCLUDED.latitude,
           longitude=EXCLUDED.longitude, country_code=EXCLUDED.country_code,
           city=EXCLUDED.city, timezone=EXCLUDED.timezone,
           image_urls=EXCLUDED.image_urls, cached_at=now()`,
        [
          String(hotelCode), 'hotelbeds-hotels', h.name?.content || h.name,
          h.description?.content, Number(h.categoryCode || 0),
          h.coordinates?.latitude, h.coordinates?.longitude,
          h.countryCode, h.city?.content, 'UTC',
          (h.images || []).map(i => i.path),
        ]
      );
    } catch {}
    return h;
  }

  async search(params) {
    // TODO: consider caching search results if request volume justifies
    const data = await this.request({
      method: 'POST', url: '/hotels',
      headers: this._headers(),
      data: params,
      operation: 'search',
    });
    return normalize(data, 'hotelbeds-hotels');
  }

  async checkrates(rateKey) {
    return this.request({
      method: 'POST', url: '/checkrates',
      headers: this._headers(),
      data: { rooms: [{ rateKey }] },
      operation: 'checkrates',
    });
  }

  async detail(hotelCode) { return this.getContent(hotelCode); }

  async availability(params) { return this.search(params); }

  async book({ rateKey, holder, rooms, clientReference }) {
    await this.checkrates(rateKey);
    const ref = clientReference || `TOS-${Date.now()}`;
    return this.request({
      method: 'POST', url: '/bookings',
      headers: this._headers(),
      data: {
        holder,
        clientReference: ref,
        rooms: rooms || [{
          rateKey,
          paxes: [
            { roomId: 1, type: 'AD', name: holder.name, surname: holder.surname },
            { roomId: 1, type: 'AD', name: holder.name, surname: holder.surname },
          ],
        }],
      },
      operation: 'book',
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
