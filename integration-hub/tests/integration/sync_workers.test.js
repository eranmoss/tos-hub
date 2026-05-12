import nock from 'nock';
import { query, closePool } from '../../src/db/client.js';
import { syncHotelbedsHotels } from '../../src/sync/hotelbeds-hotels.js';
import { syncBridgifyExperiences } from '../../src/sync/bridgify-experiences.js';

const HB = 'hotelbeds-hotels';
const BR = 'bridgify';

beforeAll(async () => {
  for (const [slug, name, cats, auth] of [
    [HB, 'HotelBeds Hotels', ['HOTEL'], 'HMAC'],
    [BR, 'Bridgify', ['EXPERIENCE'], 'OAUTH2'],
  ]) {
    await query(
      `INSERT INTO hub_suppliers(supplier_slug, name, categories, auth_type)
       VALUES ($1,$2,$3,$4) ON CONFLICT (supplier_slug) DO NOTHING`,
      [slug, name, cats, auth]
    );
  }
  await query(`DELETE FROM hub_static_inventory WHERE supplier_slug IN ($1,$2)`, [HB, BR]);
});

afterEach(() => nock.cleanAll());
afterAll(async () => {
  await query(`DELETE FROM hub_static_inventory WHERE supplier_slug IN ($1,$2)`, [HB, BR]);
  await query(`DELETE FROM hub_sync_errors WHERE sync_job_id IN (SELECT id FROM hub_sync_jobs WHERE supplier_slug = ANY($1))`, [[HB, BR]]);
  await query(`DELETE FROM hub_sync_jobs WHERE supplier_slug = ANY($1)`, [[HB, BR]]);
  await closePool();
});

describe('Layer 2.5: HotelBeds hotels sync worker', () => {
  test('fetches content page and upserts static inventory', async () => {
    nock('https://api.test.hotelbeds.com')
      .get('/hotel-content-api/1.0/hotels')
      .query(true)
      .reply(200, {
        hotels: [{
          code: 12345, name: { content: 'Hotel Barcelona' },
          description: { content: 'Nice hotel' },
          coordinates: { latitude: 41.3851, longitude: 2.1734 },
          city: { content: 'Barcelona' }, countryCode: 'ES',
          categoryCode: '4EST', images: [{ path: 'a.jpg' }],
        }],
      });
    const res = await syncHotelbedsHotels({ apiKey: 'k', secretKey: 's', env: 'sandbox' });
    expect(res.upserted).toBe(1);
    const rows = await query(
      `SELECT title, latitude, country FROM hub_static_inventory WHERE supplier_slug=$1`,
      [HB]
    );
    expect(rows.rows[0].title).toBe('Hotel Barcelona');
    expect(rows.rows[0].country).toBe('ES');
  });
});

describe('Layer 2.5: Bridgify experiences sync worker', () => {
  test('fetches via OAuth and upserts static inventory', async () => {
    nock('https://sandbox.bridgify.test')
      .post('/accounts/token/').reply(200, { access_token: 't', expires_in: 3600 })
      .get('/attractions/products/').query(true)
      .reply(200, {
        attractions: [{
          id: 'BR-1', title: 'Sagrada Tour', duration_minutes: 90,
          category: 'CULTURE',
          location: { lat: 41.4036, lng: 2.1744, city: 'Barcelona', country: 'ES' },
        }],
      });
    const res = await syncBridgifyExperiences({
      clientId: 'cid', clientSecret: 'csec', baseUrl: 'https://sandbox.bridgify.test',
    });
    expect(res.upserted).toBe(1);
    const rows = await query(
      `SELECT title, category, duration_minutes FROM hub_static_inventory WHERE supplier_slug=$1`,
      [BR]
    );
    expect(rows.rows[0].title).toBe('Sagrada Tour');
    expect(rows.rows[0].duration_minutes).toBe(90);
  });
});
