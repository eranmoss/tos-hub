import nock from 'nock';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../../src/db/client.js';
import { search, stage1LocalFilter } from '../../src/search/pipeline.js';
import { setSecret, deleteSecret } from '../../src/infra/secrets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const F = path.resolve(__dirname, '../fixtures');
const load = (f) => JSON.parse(fs.readFileSync(path.join(F, f), 'utf-8'));

const TENANT = 'test_tenant_search_pipeline';
const SUPPLIER = 'hotelbeds-hotels';

beforeAll(async () => {
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
  const hash = await bcrypt.hash('key', 4);
  await query(
    `INSERT INTO hub_tenants(tenant_id, name, tier, api_key_hash) VALUES ($1,$2,$3,$4)`,
    [TENANT, 'Test', 'GROWTH', hash]
  );
  await query(
    `INSERT INTO hub_suppliers(supplier_slug, name, categories, auth_type)
     VALUES ($1, 'HotelBeds Hotels', ARRAY['HOTEL'], 'HMAC')
     ON CONFLICT (supplier_slug) DO NOTHING`,
    [SUPPLIER]
  );
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1 AND supplier_slug = $2`, [TENANT, SUPPLIER]);
  await query(
    `INSERT INTO hub_tenant_suppliers(tenant_id, supplier_slug, sla_tier, is_active)
     VALUES ($1,$2,'standard',true)`,
    [TENANT, SUPPLIER]
  );
  await setSecret(TENANT, SUPPLIER, { api_key: 'k', secret_key: 's', env: 'sandbox' });
  await query(
    `INSERT INTO hub_static_inventory
     (supplier_slug, supplier_raw_ref, type, title, latitude, longitude, city, country)
     VALUES ($1, 'HB-1001', 'HOTEL', 'Test Hotel BCN', 41.3851, 2.1734, 'Barcelona', 'ES')
     ON CONFLICT (supplier_slug, supplier_raw_ref) DO UPDATE SET is_active = true`,
    [SUPPLIER]
  );
});

afterEach(() => nock.cleanAll());
afterAll(async () => {
  await query(`DELETE FROM hub_static_inventory WHERE supplier_slug = $1 AND supplier_raw_ref = 'HB-1001'`, [SUPPLIER]);
  await deleteSecret(TENANT, SUPPLIER);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_transactions WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
  await closePool();
});

describe('Layer 2.5: search pipeline', () => {
  test('Stage 1 returns candidates within radius', async () => {
    const rows = await stage1LocalFilter({
      tenantId: TENANT, type: 'HOTEL', lat: 41.3851, lng: 2.1734, radius_m: 10000,
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some(r => r.supplier_raw_ref === 'HB-1001')).toBe(true);
  });

  test('Stage 1 excludes rows outside radius', async () => {
    const rows = await stage1LocalFilter({
      tenantId: TENANT, type: 'HOTEL', lat: 51.5, lng: -0.12, radius_m: 10000,
    });
    expect(rows.length).toBe(0);
  });

  test('full search merges static + live reprice', async () => {
    nock('https://api.test.hotelbeds.com')
      .post('/hotel-api/1.2/hotels').reply(200, load('hotelbeds-hotel-response.json'));
    const out = await search({
      tenantId: TENANT,
      params: { type: 'HOTEL', lat: 41.3851, lng: 2.1734, radius_m: 10000, destination: 'BCN' },
    });
    expect(out.stage1_count).toBeGreaterThanOrEqual(1);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    expect(out.suppliers_repriced[0].slug).toBe(SUPPLIER);
  });

  test('empty Stage 1 short-circuits without supplier call', async () => {
    const out = await search({
      tenantId: TENANT,
      params: { type: 'HOTEL', lat: 51.5, lng: -0.12, radius_m: 1000 },
    });
    expect(out.stage1_count).toBe(0);
    expect(out.results).toEqual([]);
  });
});
