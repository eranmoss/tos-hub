import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nock from 'nock';
import { HotelbedsHotels } from '../../src/suppliers/hotelbeds/hotels.js';
import { HotelbedsExperiences } from '../../src/suppliers/hotelbeds/experiences.js';
import { HotelbedsTransfers } from '../../src/suppliers/hotelbeds/transfers.js';
import { BridgifyExperiences } from '../../src/suppliers/bridgify/experiences.js';
import { closePool } from '../../src/db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const F = path.resolve(__dirname, '../fixtures');
const load = (file) => JSON.parse(fs.readFileSync(path.join(F, file), 'utf-8'));

afterEach(() => nock.cleanAll());
afterAll(async () => { await closePool(); });

describe('Layer 4: HotelbedsHotels', () => {
  test('search normalizes response', async () => {
    nock('https://api.test.hotelbeds.com')
      .post('/hotel-api/1.2/hotels').reply(200, load('hotelbeds-hotel-response.json'));
    const s = new HotelbedsHotels({ apiKey: 'K', secretKey: 'S' });
    const res = await s.search({ destination: 'BCN' });
    expect(res.length).toBe(1);
    expect(res[0].type).toBe('HOTEL');
  });

  test('book calls checkrates first then book', async () => {
    const scope = nock('https://api.test.hotelbeds.com')
      .post('/hotel-api/1.2/checkrates').reply(200, { hotel: { rooms: [] } })
      .post('/hotel-api/1.2/bookings').reply(200, { booking: { reference: 'HB-123' } });
    const s = new HotelbedsHotels({ apiKey: 'K', secretKey: 'S' });
    const res = await s.book({ rateKey: 'RK', holder: { name: 'X', surname: 'Y' } });
    expect(res.booking.reference).toBe('HB-123');
    expect(scope.isDone()).toBe(true);
  });
});

describe('Layer 4: HotelbedsExperiences', () => {
  test('search returns one option per modality', async () => {
    nock('https://api.test.hotelbeds.com')
      .get('/activity-api/1.0/activities')
      .query(true)
      .reply(200, load('hotelbeds-experience-response.json'));
    const s = new HotelbedsExperiences({ apiKey: 'K', secretKey: 'S' });
    const res = await s.search({ destination: 'BCN' });
    expect(res.length).toBe(2);
  });

  test('confirm hits two-step endpoint', async () => {
    nock('https://api.test.hotelbeds.com')
      .post('/activity-api/1.0/bookings/REF-1/confirmation').reply(200, { confirmed: true });
    const s = new HotelbedsExperiences({ apiKey: 'K', secretKey: 'S' });
    const res = await s.confirm('REF-1');
    expect(res.confirmed).toBe(true);
  });
});

describe('Layer 4: HotelbedsTransfers', () => {
  test('search normalizes + assigns trip_id', async () => {
    nock('https://api.test.hotelbeds.com')
      .get('/transfer-api/1.0/transfers/availability')
      .query(true)
      .reply(200, load('hotelbeds-transfer-response.json'));
    const s = new HotelbedsTransfers({ apiKey: 'K', secretKey: 'S' });
    const res = await s.search({ from: 'BCN', to: 'BCN_HOTEL' });
    expect(res.length).toBe(2);
    expect(res[0].transfer_meta.trip_id).toBe(res[1].transfer_meta.trip_id);
  });
});

describe('Layer 4: BridgifyExperiences', () => {
  test('search normalizes response', async () => {
    nock('https://sandbox.bridgify.test')
      .post('/accounts/token/').reply(200, { access_token: 'tok-123', expires_in: 3600 })
      .get('/attractions/products/').query(true)
      .reply(200, load('bridgify-experience-response.json'));
    const s = new BridgifyExperiences({
      clientId: 'cid', clientSecret: 'csec', baseUrl: 'https://sandbox.bridgify.test',
    });
    const res = await s.search({ city_name: 'Barcelona' });
    expect(res.length).toBe(2);
    expect(res[0].supplier_slug).toBe('bridgify');
  });
});
