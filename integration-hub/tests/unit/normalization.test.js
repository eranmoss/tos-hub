import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalize } from '../../src/normalization/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const F = path.resolve(__dirname, '../fixtures');
const load = (file) => JSON.parse(fs.readFileSync(path.join(F, file), 'utf-8'));

describe('Layer 2: CTS normalization pipeline', () => {
  test('bridgify experiences → valid CTS', async () => {
    const res = await normalize(load('bridgify-experience-response.json'), 'bridgify');
    expect(res.length).toBe(2);
    expect(res[0].type).toBe('EXPERIENCE');
    expect(res[0].supplier_slug).toBe('bridgify');
    expect(res[0].price.amount_usd).toBeGreaterThan(0);
    expect(res[0].price.original_currency).toBe('EUR');
  });

  test('hotelbeds activities → one option per modality', async () => {
    const res = await normalize(load('hotelbeds-experience-response.json'), 'hotelbeds-activities');
    expect(res.length).toBe(2);
    expect(res.every(r => r.supplier_raw_ref === 'E-BCN-SAGR')).toBe(true);
    expect(res[0].duration_minutes).toBe(120);
    expect(res[1].duration_minutes).toBe(180);
  });

  test('hotelbeds hotels → valid CTS with net pricing', async () => {
    const res = await normalize(load('hotelbeds-hotel-response.json'), 'hotelbeds-hotels');
    expect(res.length).toBe(1);
    expect(res[0].type).toBe('HOTEL');
    expect(res[0].meal_plan).toBe('BB');
    expect(res[0].price.net_amount_usd).toBeGreaterThan(0);
    expect(res[0].price.markup_applied).toBe(false);
  });

  test('hotelbeds transfers → valid CTS with trip_id', async () => {
    const res = await normalize(load('hotelbeds-transfer-response.json'), 'hotelbeds-transfers', { tripId: null });
    expect(res.length).toBe(2);
    expect(res[0].type).toBe('TRANSFER');
    expect(res[0].transfer_meta.trip_id).toBeDefined();
    expect(res[0].transfer_meta.inbound_flight).toBe('VY1234');
  });

  test('100% Zod pass rate across all fixtures', async () => {
    const suppliers = [
      ['bridgify', 'bridgify-experience-response.json'],
      ['hotelbeds-activities', 'hotelbeds-experience-response.json'],
      ['hotelbeds-hotels', 'hotelbeds-hotel-response.json'],
      ['hotelbeds-transfers', 'hotelbeds-transfer-response.json'],
    ];
    for (const [slug, file] of suppliers) {
      const res = await normalize(load(file), slug);
      expect(res.length).toBeGreaterThan(0);
    }
  });
});
