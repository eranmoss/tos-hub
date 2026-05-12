import nock from 'nock';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildApp } from '../../src/index.js';
import { query, closePool } from '../../src/db/client.js';
import { signDashboardJwt } from '../../src/auth/jwt.js';

const TENANT = 'test_tenant_dash_onb';
const EMAIL = 'dash-onb@example.com';
const SLUG = 'mocksupp-dash';
let app;
let jwt;

const bearer = (req) => req.set('Authorization', `Bearer ${jwt}`);

const manifest = () => ({
  manifest_version: '1.0',
  supplier: {
    name: 'MockSupp',
    slug: SLUG,
    categories: ['EXPERIENCE'],
    base_url_sandbox: 'https://sandbox.mocksupp.test',
    base_url_production: 'https://api.mocksupp.test',
    documentation_url: 'https://docs.mocksupp.test/api',
  },
  auth: { type: 'API_KEY', credential_fields: ['api_key'] },
  operations: {
    search: { method: 'GET', endpoint: '/experiences' },
    book: { method: 'POST', endpoint: '/bookings' },
  },
  rate_limit_rpm: 60,
  cts_mapping: {
    type_value: 'EXPERIENCE',
    field_mappings: [{ source: 'title', target: 'title', transform: null }],
  },
  test_suite: { sandbox_search_params: { city: 'Paris' }, expected_result_count_min: 1 },
  tenant_config: { tenant_id: TENANT, sla_tier: 'GROWTH' },
});

const cleanup = async () => {
  await query(`DELETE FROM hub_onboarding_sessions WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_schema_mappings WHERE supplier_slug = $1`, [SLUG]);
  await query(`DELETE FROM hub_integration_tests WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_credentials_map WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_dedup_config WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_suppliers WHERE supplier_slug = $1`, [SLUG]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
};

beforeAll(async () => {
  await cleanup();
  const hash = await bcrypt.hash('k', 4);
  await query(
    `INSERT INTO hub_tenants(tenant_id, name, tier, api_key_hash, email)
     VALUES ($1, 'DashOnb', 'GROWTH', $2, $3)`,
    [TENANT, hash, EMAIL]
  );
  app = buildApp();
  jwt = signDashboardJwt({ tenant_id: TENANT, tenant_name: 'DashOnb', tier: 'GROWTH', email: EMAIL });
});

afterEach(() => nock.cleanAll());
afterAll(async () => { await cleanup(); await closePool(); });

describe('Dashboard onboarding flow', () => {
  test('create → patch → confirm (pass) → promote writes hub_tenant_suppliers', async () => {
    nock('https://sandbox.mocksupp.test')
      .get('/experiences').query(true).times(3)
      .reply(200, { results: [{ id: '1', title: 'Tour' }, { id: '2', title: 'Hike' }] });

    // 1. create session (partial manifest allowed)
    const r1 = await bearer(request(app).post('/v1/dashboard/onboard'))
      .send({ supplier: { name: 'MockSupp', slug: SLUG, categories: ['EXPERIENCE'], base_url_sandbox: 'https://sandbox.mocksupp.test' } });
    expect(r1.status).toBe(200);
    const sid = r1.body.session_id;
    expect(sid).toBeDefined();

    // 2. patch with full manifest
    const r2 = await bearer(request(app).patch(`/v1/dashboard/onboard/${sid}/manifest`))
      .send(manifest());
    expect(r2.status).toBe(200);

    // 3. get session returns manifest
    const r3 = await bearer(request(app).get(`/v1/dashboard/onboard/${sid}`));
    expect(r3.status).toBe(200);
    expect(r3.body.manifest.supplier.slug).toBe(SLUG);

    // 4. confirm runs validation → VALIDATED
    const r4 = await bearer(request(app).post(`/v1/dashboard/onboard/${sid}/confirm`));
    expect(r4.status).toBe(200);
    expect(r4.body.status).toBe('VALIDATED');
    expect(r4.body.report.passed).toBe(true);

    // 5. promote writes hub_tenant_suppliers
    const r5 = await bearer(request(app).post(`/v1/dashboard/onboard/${sid}/promote`));
    expect(r5.status).toBe(200);
    expect(r5.body.status).toBe('PROMOTED');

    const ts = await query(`SELECT * FROM hub_tenant_suppliers WHERE tenant_id=$1 AND supplier_slug=$2`, [TENANT, SLUG]);
    expect(ts.rows.length).toBe(1);
    expect(ts.rows[0].sla_tier).toBe('GROWTH');
  });

  test('confirm fails when supplier auth rejects → FAILED status, no provisioning', async () => {
    // new session
    const r1 = await bearer(request(app).post('/v1/dashboard/onboard'))
      .send(manifest());
    const sid = r1.body.session_id;

    nock('https://sandbox.mocksupp.test')
      .get('/experiences').query(true).times(3).reply(401);

    const r2 = await bearer(request(app).post(`/v1/dashboard/onboard/${sid}/confirm`));
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe('FAILED');
    expect(r2.body.report.failure_report).toMatch(/VALIDATION_FAILURE_REPORT/);

    // promote should refuse
    const r3 = await bearer(request(app).post(`/v1/dashboard/onboard/${sid}/promote`));
    expect(r3.status).toBe(400);
  });

  test('tenant isolation: other tenant cannot see session', async () => {
    const r1 = await bearer(request(app).post('/v1/dashboard/onboard')).send(manifest());
    const sid = r1.body.session_id;
    const otherJwt = signDashboardJwt({ tenant_id: 'stranger', tenant_name: 'X', tier: 'STARTER', email: 'x@x.com' });
    const r2 = await request(app).get(`/v1/dashboard/onboard/${sid}`)
      .set('Authorization', `Bearer ${otherJwt}`);
    expect(r2.status).toBe(404);
  });

  test('no JWT → 401', async () => {
    const r = await request(app).post('/v1/dashboard/onboard').send(manifest());
    expect(r.status).toBe(401);
  });
});
