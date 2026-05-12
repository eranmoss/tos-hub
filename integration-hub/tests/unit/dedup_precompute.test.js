import bcrypt from 'bcrypt';
import { query, closePool } from '../../src/db/client.js';
import { precomputeDedupForTenant } from '../../src/sync/dedup-precompute.js';

const TENANT = 'test_tenant_dedup_pre';
const A = 'test-dedup-supA';
const B = 'test-dedup-supB';

beforeAll(async () => {
  await query(`DELETE FROM hub_dedup_pairs WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_static_inventory WHERE supplier_slug IN ($1, $2)`, [A, B]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);

  const hash = await bcrypt.hash('key', 4);
  await query(
    `INSERT INTO hub_tenants(tenant_id, name, tier, api_key_hash) VALUES ($1,$2,$3,$4)`,
    [TENANT, 'Dedup Pre', 'GROWTH', hash]
  );
  for (const s of [A, B]) {
    await query(
      `INSERT INTO hub_suppliers(supplier_slug, name, categories, auth_type)
       VALUES ($1, $1, ARRAY['EXPERIENCE'], 'API_KEY')
       ON CONFLICT (supplier_slug) DO NOTHING`,
      [s]
    );
    await query(
      `INSERT INTO hub_tenant_suppliers(tenant_id, supplier_slug, sla_tier, is_active)
       VALUES ($1,$2,'standard',true)`,
      [TENANT, s]
    );
  }
  // Two very-similar rows across suppliers (should be DUPLICATE)
  await query(
    `INSERT INTO hub_static_inventory
       (supplier_slug, supplier_raw_ref, type, title, latitude, longitude, duration_minutes, category)
     VALUES
       ($1, 'X1', 'EXPERIENCE', 'Sagrada Familia Skip The Line', 41.4036, 2.1744, 90, 'CULTURE'),
       ($2, 'Y1', 'EXPERIENCE', 'Sagrada Familia Priority Access', 41.4037, 2.1745, 90, 'CULTURE'),
       ($1, 'X2', 'EXPERIENCE', 'Flamenco Show Barcelona', 41.3851, 2.1734, 120, 'CULTURE')`,
    [A, B]
  );
});

afterAll(async () => {
  await query(`DELETE FROM hub_dedup_pairs WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_static_inventory WHERE supplier_slug IN ($1, $2)`, [A, B]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
  await closePool();
});

describe('Layer 2.5: dedup precompute', () => {
  test('writes DUPLICATE/UNCERTAIN pairs, skips DISTINCT', async () => {
    const res = await precomputeDedupForTenant(TENANT);
    expect(res.pairs_written).toBeGreaterThanOrEqual(1);
    const pairs = await query(
      `SELECT decision, composite_score FROM hub_dedup_pairs WHERE tenant_id = $1`,
      [TENANT]
    );
    expect(pairs.rows.length).toBeGreaterThanOrEqual(1);
    expect(pairs.rows.some(r => r.decision === 'DUPLICATE' || r.decision === 'UNCERTAIN')).toBe(true);
    expect(pairs.rows.every(r => r.decision !== 'DISTINCT')).toBe(true);
  });
});
