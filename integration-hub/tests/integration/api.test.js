import request from 'supertest';
import bcrypt from 'bcrypt';
import { buildApp } from '../../src/index.js';
import { query, closePool } from '../../src/db/client.js';

const TENANT = 'test_tenant_api';
const API_KEY = 'test-api-key-api';
let app;

beforeAll(async () => {
  await query(`DELETE FROM hub_transactions WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
  const hash = await bcrypt.hash(API_KEY, 4);
  await query(
    `INSERT INTO hub_tenants(tenant_id, name, tier, api_key_hash, rate_limit_rpm)
     VALUES ($1,'APIT','GROWTH',$2,1000)`, [TENANT, hash]
  );
  app = buildApp();
});

afterAll(async () => {
  await query(`DELETE FROM hub_transactions WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
  await closePool();
});

describe('Layer 7: API surface', () => {
  test('health endpoint', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  test('401 when X-Api-Key missing', async () => {
    const res = await request(app).post('/v1/search').send({});
    expect(res.status).toBe(401);
  });

  test('401 when X-Api-Key invalid', async () => {
    const res = await request(app).post('/v1/search').set('X-Api-Key', 'wrong').send({});
    expect(res.status).toBe(401);
  });

  test('200 with valid key, GET /v1/integrations', async () => {
    const res = await request(app).get('/v1/integrations').set('X-Api-Key', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.integrations)).toBe(true);
  });

  test('GET /v1/tools returns list', async () => {
    const res = await request(app).get('/v1/tools').set('X-Api-Key', API_KEY);
    expect(res.status).toBe(200);
  });

  test('POST /v1/integrations/onboard creates session', async () => {
    const res = await request(app)
      .post('/v1/integrations/onboard').set('X-Api-Key', API_KEY)
      .send({ manifest: { supplier: { slug: 'testsup' } } });
    expect(res.status).toBe(200);
    expect(res.body.session_id).toBeDefined();
  });

  test('admin endpoint requires X-Admin-Key', async () => {
    const res = await request(app).get(`/v1/admin/dedup/test-log/${TENANT}`);
    expect(res.status).toBe(401);
    const res2 = await request(app).get(`/v1/admin/dedup/test-log/${TENANT}`).set('X-Admin-Key', process.env.ADMIN_KEY);
    expect(res2.status).toBe(200);
  });

  test('internal callback requires X-Internal-Token', async () => {
    const res = await request(app).post('/v1/agent/callback').send({});
    expect(res.status).toBe(401);
  });

  test('webhook without secret → 401', async () => {
    const res = await request(app).post('/v1/webhook/bridgify').send({});
    expect(res.status).toBe(401);
  });

  test('rate limit fires above tenant RPM', async () => {
    const RL_TENANT = 'test_tenant_rl';
    const RL_KEY = 'rl-key';
    const hash = await bcrypt.hash(RL_KEY, 4);
    await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [RL_TENANT]);
    await query(
      `INSERT INTO hub_tenants(tenant_id,name,tier,api_key_hash,rate_limit_rpm) VALUES ($1,'RL','GROWTH',$2,2)`,
      [RL_TENANT, hash]
    );
    const rlApp = buildApp();
    const r1 = await request(rlApp).get('/v1/tools').set('X-Api-Key', RL_KEY);
    const r2 = await request(rlApp).get('/v1/tools').set('X-Api-Key', RL_KEY);
    const r3 = await request(rlApp).get('/v1/tools').set('X-Api-Key', RL_KEY);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [RL_TENANT]);
  });
});
