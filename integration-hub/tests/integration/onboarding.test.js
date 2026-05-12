import nock from 'nock';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { buildApp } from '../../src/index.js';
import { validateManifest } from '../../src/onboarding/manifest.js';
import { runSandboxValidation } from '../../src/onboarding/validation.js';
import { runProvisioning } from '../../src/onboarding/provisioning.js';
import { fetchDocs } from '../../src/agents/onboarding.js';
import { query, closePool } from '../../src/db/client.js';

const TENANT = 'test_tenant_onb';
const API_KEY = 'onb-key';
let app;

const validManifest = () => ({
  manifest_version: '1.0',
  supplier: {
    name: 'Viator Test',
    slug: 'viator-test',
    categories: ['EXPERIENCE'],
    base_url_sandbox: 'https://sandbox.viator.test',
    base_url_production: 'https://api.viator.test',
    documentation_url: 'https://docs.viator.test/api',
  },
  auth: { type: 'API_KEY', credential_fields: ['api_key'] },
  operations: {
    search: { method: 'GET', endpoint: '/experiences' },
    detail: { method: 'GET', endpoint: '/experiences/:id' },
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

beforeAll(async () => {
  await query(`DELETE FROM hub_onboarding_sessions WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_schema_mappings WHERE supplier_slug = 'viator-test'`);
  await query(`DELETE FROM hub_integration_tests WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_credentials_map WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_dedup_config WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_suppliers WHERE supplier_slug = 'viator-test'`);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
  const hash = await bcrypt.hash(API_KEY, 4);
  await query(
    `INSERT INTO hub_tenants(tenant_id,name,tier,api_key_hash,rate_limit_rpm) VALUES ($1,'ONB','GROWTH',$2,1000)`,
    [TENANT, hash]
  );
  app = buildApp();
});

afterEach(() => nock.cleanAll());
afterAll(async () => {
  await query(`DELETE FROM hub_onboarding_sessions WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_schema_mappings WHERE supplier_slug = 'viator-test'`);
  await query(`DELETE FROM hub_integration_tests WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_credentials_map WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_dedup_config WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_suppliers WHERE supplier_slug = 'viator-test'`);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
  await closePool();
});

describe('Layer 8: manifest validation', () => {
  test('valid manifest passes', () => {
    const r = validateManifest(validManifest());
    expect(r.ok).toBe(true);
  });

  test('missing search/book fails', () => {
    const m = validManifest();
    delete m.operations.book;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
  });
});

describe('Layer 8: sandbox validation pipeline', () => {
  test('full pass: auth + search + normalize', async () => {
    nock('https://sandbox.viator.test')
      .get('/experiences').query(true).times(3)
      .reply(200, { results: [{ id: '1', title: 'X' }, { id: '2', title: 'Y' }] })
      .get('/experiences/1').reply(200, { id: '1', title: 'X' });
    const report = await runSandboxValidation(validManifest());
    expect(report.passed).toBe(true);
    expect(report.steps.length).toBeGreaterThanOrEqual(6);
  });

  test('auth failure exhausts retry budget and writes failure report', async () => {
    nock('https://sandbox.viator.test').get('/experiences').query(true).times(3).reply(401);
    const report = await runSandboxValidation(validManifest());
    expect(report.passed).toBe(false);
    expect(report.failure_report).toMatch(/VALIDATION_FAILURE_REPORT/);
  });
});

describe('Layer 8: provisioning pipeline', () => {
  test('9-step provisioning writes all targets', async () => {
    const res = await runProvisioning({ manifest: validManifest(), tenantId: TENANT });
    expect(res.ok).toBe(true);
    expect(res.steps.length).toBe(9);
    const supplier = await query(`SELECT * FROM hub_suppliers WHERE supplier_slug='viator-test'`);
    expect(supplier.rows.length).toBe(1);
    const ts = await query(`SELECT * FROM hub_tenant_suppliers WHERE tenant_id=$1`, [TENANT]);
    expect(ts.rows.length).toBe(1);
  });
});

describe('Layer 8: doc fetch', () => {
  test('extracts endpoints + field names from fetched content', async () => {
    nock('https://docs.viator.test')
      .get('/api').reply(200, `GET /experiences
POST /bookings
Response: { "title": "...", "duration_minutes": 120 }`);
    const docs = await fetchDocs('https://docs.viator.test/api');
    expect(docs.endpoints.length).toBeGreaterThan(0);
    expect(docs.fields).toContain('title');
    expect(docs.proposedMappings.length).toBeGreaterThan(0);
  });
});

describe('Layer 8: end-to-end API flow', () => {
  test('onboard → confirm → promote', async () => {
    nock('https://sandbox.viator.test')
      .get('/experiences').query(true).times(3)
      .reply(200, { results: [{ id: '1', title: 'Eiffel' }] })
      .get('/experiences/1').reply(200, { id: '1' });

    // clean prior provisioning from earlier test
    await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
    await query(`DELETE FROM hub_schema_mappings WHERE supplier_slug = 'viator-test'`);
    await query(`DELETE FROM hub_integration_tests WHERE tenant_id = $1`, [TENANT]);
    await query(`DELETE FROM hub_credentials_map WHERE tenant_id = $1`, [TENANT]);
    await query(`DELETE FROM hub_dedup_config WHERE tenant_id = $1`, [TENANT]);
    await query(`DELETE FROM hub_suppliers WHERE supplier_slug = 'viator-test'`);

    const r1 = await request(app).post('/v1/integrations/onboard')
      .set('X-Api-Key', API_KEY).send({ manifest: validManifest() });
    expect(r1.status).toBe(200);
    const sid = r1.body.session_id;

    const r2 = await request(app).post(`/v1/integrations/onboard/${sid}/confirm`)
      .set('X-Api-Key', API_KEY);
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe('VALIDATED');

    const r3 = await request(app).post(`/v1/integrations/onboard/${sid}/promote`)
      .set('X-Api-Key', API_KEY);
    expect(r3.status).toBe(200);
    expect(r3.body.status).toBe('PROMOTED');
  });
});
