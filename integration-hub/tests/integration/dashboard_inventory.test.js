import request from 'supertest';
import bcrypt from 'bcrypt';
import { buildApp } from '../../src/index.js';
import { query, closePool } from '../../src/db/client.js';
import { signDashboardJwt } from '../../src/auth/jwt.js';

const TENANT_A = 'test_tenant_inv_a';
const TENANT_B = 'test_tenant_inv_b';
const SUPPLIER_A = 'mockinv-hotels';
const SUPPLIER_B = 'mockinv-tours';

let app;
let jwtA;
let jwtB;

const cleanup = async () => {
  await query(`DELETE FROM hub_static_inventory WHERE supplier_slug IN ($1,$2)`, [SUPPLIER_A, SUPPLIER_B]);
  await query(`DELETE FROM hub_sync_errors WHERE sync_job_id IN (
    SELECT id FROM hub_sync_jobs WHERE supplier_slug IN ($1,$2))`, [SUPPLIER_A, SUPPLIER_B]);
  await query(`DELETE FROM hub_sync_jobs WHERE supplier_slug IN ($1,$2)`, [SUPPLIER_A, SUPPLIER_B]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  await query(`DELETE FROM hub_suppliers WHERE supplier_slug IN ($1,$2)`, [SUPPLIER_A, SUPPLIER_B]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
};

beforeAll(async () => {
  await cleanup();
  const hash = await bcrypt.hash('k', 4);
  await query(
    `INSERT INTO hub_tenants(tenant_id, name, tier, api_key_hash, email)
     VALUES ($1,'InvA','GROWTH',$2,'inv-a@example.com'),
            ($3,'InvB','STARTER',$2,'inv-b@example.com')`,
    [TENANT_A, hash, TENANT_B]
  );
  await query(
    `INSERT INTO hub_suppliers(supplier_slug, name, categories, base_url_sandbox, auth_type)
     VALUES ($1,'MockHotels',ARRAY['HOTEL'],'https://a.test','API_KEY'),
            ($2,'MockTours',ARRAY['EXPERIENCE'],'https://b.test','API_KEY')`,
    [SUPPLIER_A, SUPPLIER_B]
  );
  await query(
    `INSERT INTO hub_tenant_suppliers(tenant_id, supplier_slug, sla_tier, is_active)
     VALUES ($1,$2,'ENTERPRISE',true), ($3,$4,'STARTER',true)`,
    [TENANT_A, SUPPLIER_A, TENANT_B, SUPPLIER_B]
  );

  // Seed inventory: 3 hotels under supplier A (2 Barcelona, 1 Madrid), 2 tours under B (Paris)
  await query(
    `INSERT INTO hub_static_inventory
       (supplier_slug, supplier_raw_ref, type, title, city, country, latitude, longitude,
        category, star_rating, is_active, last_synced_at)
     VALUES
       ($1,'H1','HOTEL','Hotel Arts Barcelona','Barcelona','ES',41.38,2.19,NULL,5.0,true,now()),
       ($1,'H2','HOTEL','W Barcelona','Barcelona','ES',41.36,2.18,NULL,5.0,true,now()),
       ($1,'H3','HOTEL','Hotel Madrid Centro','Madrid','ES',40.41,-3.70,NULL,3.0,false,now()),
       ($2,'T1','EXPERIENCE','Eiffel Tower Tour','Paris','FR',48.85,2.29,'CULTURE',NULL,true,now()),
       ($2,'T2','EXPERIENCE','Louvre Skip Line','Paris','FR',48.86,2.33,'CULTURE',NULL,true,now())`,
    [SUPPLIER_A, SUPPLIER_B]
  );

  await query(
    `INSERT INTO hub_sync_jobs(supplier_slug, status, records_fetched, records_upserted,
       records_deactivated, records_errored, started_at, completed_at)
     VALUES
       ($1,'COMPLETE',3,3,0,0,now() - INTERVAL '1 hour', now() - INTERVAL '59 minutes'),
       ($1,'COMPLETE',3,0,1,0,now() - INTERVAL '2 hours', now() - INTERVAL '1 hour 59 minutes'),
       ($2,'COMPLETE',2,2,0,0,now() - INTERVAL '30 minutes', now() - INTERVAL '29 minutes')`,
    [SUPPLIER_A, SUPPLIER_B]
  );

  app = buildApp();
  jwtA = signDashboardJwt({ tenant_id: TENANT_A, tenant_name: 'InvA', tier: 'GROWTH', email: 'inv-a@example.com' });
  jwtB = signDashboardJwt({ tenant_id: TENANT_B, tenant_name: 'InvB', tier: 'STARTER', email: 'inv-b@example.com' });
});

afterAll(async () => { await cleanup(); await closePool(); });

const bearer = (req, token) => req.set('Authorization', `Bearer ${token}`);

describe('Dashboard inventory (§7B)', () => {
  test('GET /inventory returns only tenant-active-supplier records', async () => {
    const rA = await bearer(request(app).get('/v1/dashboard/inventory'), jwtA);
    expect(rA.status).toBe(200);
    expect(rA.body.records.every((r) => r.supplier_slug === SUPPLIER_A)).toBe(true);
    expect(rA.body.total).toBe(3);

    const rB = await bearer(request(app).get('/v1/dashboard/inventory'), jwtB);
    expect(rB.body.records.every((r) => r.supplier_slug === SUPPLIER_B)).toBe(true);
    expect(rB.body.total).toBe(2);
  });

  test('city filter narrows results (ILIKE partial match)', async () => {
    const r = await bearer(
      request(app).get('/v1/dashboard/inventory').query({ city: 'Barcelona' }),
      jwtA
    );
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.records.every((x) => x.city === 'Barcelona')).toBe(true);
  });

  test('type filter narrows results', async () => {
    const r = await bearer(
      request(app).get('/v1/dashboard/inventory').query({ type: 'EXPERIENCE' }),
      jwtB
    );
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.records.every((x) => x.type === 'EXPERIENCE')).toBe(true);
  });

  test('sync_summary reflects latest job + inventory counts', async () => {
    const r = await bearer(request(app).get('/v1/dashboard/inventory'), jwtA);
    expect(r.body.sync_summary).not.toBeNull();
    expect(r.body.sync_summary.status).toBe('COMPLETE');
    const s = r.body.sync_status_by_supplier.find((x) => x.supplier_slug === SUPPLIER_A);
    expect(s.records_active).toBe(2);
    expect(s.records_inactive).toBe(1);
  });

  test('GET /inventory/sync-history returns only jobs for tenant suppliers', async () => {
    const r = await bearer(request(app).get('/v1/dashboard/inventory/sync-history'), jwtA);
    expect(r.status).toBe(200);
    expect(r.body.jobs.length).toBe(2);
    expect(r.body.jobs.every((j) => j.supplier_slug === SUPPLIER_A)).toBe(true);
  });

  test('GET /overview includes sync_status_by_supplier', async () => {
    const r = await bearer(request(app).get('/v1/dashboard/overview'), jwtA);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.sync_status_by_supplier)).toBe(true);
    const row = r.body.sync_status_by_supplier.find((x) => x.supplier_slug === SUPPLIER_A);
    expect(row).toBeDefined();
    expect(row.records_active).toBe(2);
    expect(row.records_inactive).toBe(1);
    expect(row.last_job_status).toBe('COMPLETE');
  });

  test('GET /overview includes content_by_type grouped by supplier', async () => {
    const r = await bearer(request(app).get('/v1/dashboard/overview'), jwtA);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.content_by_type)).toBe(true);
    const hotel = r.body.content_by_type.find((c) => c.type === 'HOTEL');
    expect(hotel).toBeDefined();
    expect(hotel.total_active).toBe(2);
    expect(hotel.by_supplier[0]).toEqual({ supplier_slug: SUPPLIER_A, count: 2 });
  });

  test('no JWT → 401', async () => {
    const r = await request(app).get('/v1/dashboard/inventory');
    expect(r.status).toBe(401);
  });
});
