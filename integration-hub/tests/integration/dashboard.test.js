import request from 'supertest';
import bcrypt from 'bcrypt';
import { buildApp } from '../../src/index.js';
import { query, closePool } from '../../src/db/client.js';
import { signDashboardJwt } from '../../src/auth/jwt.js';

const TENANT = 'test_tenant_dash';
const OTHER_TENANT = 'test_tenant_other';
const EMAIL = 'dash-test@example.com';
let app;
let jwt;
let otherJwt;

beforeAll(async () => {
  await query(`DELETE FROM hub_agent_conversations WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_saved_prompts WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_auth_tokens WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_webhooks WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_transactions WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_dedup_config WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_escalations WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  const hash = await bcrypt.hash('k', 4);
  await query(
    `INSERT INTO hub_tenants(tenant_id, name, tier, api_key_hash, email)
     VALUES ($1,'DashTest','GROWTH',$2,$3)`,
    [TENANT, hash, EMAIL]
  );
  await query(
    `INSERT INTO hub_tenants(tenant_id, name, tier, api_key_hash, email)
     VALUES ($1,'Other','STARTER',$2,'other@example.com')`,
    [OTHER_TENANT, hash]
  );
  app = buildApp();
  jwt = signDashboardJwt({ tenant_id: TENANT, tenant_name: 'DashTest', tier: 'GROWTH', email: EMAIL });
  otherJwt = signDashboardJwt({ tenant_id: OTHER_TENANT, tenant_name: 'Other', tier: 'STARTER', email: 'other@example.com' });
});

afterAll(async () => {
  await query(`DELETE FROM hub_agent_conversations WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_saved_prompts WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_auth_tokens WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_webhooks WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_transactions WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_dedup_config WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_tenant_suppliers WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
  await closePool();
});

describe('Dashboard auth', () => {
  test('magic-link returns success for unknown email (no enumeration)', async () => {
    const res = await request(app).post('/v1/auth/magic-link').send({ email: 'nobody@nope.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('check your email');
  });

  test('magic-link stores token and verify returns JWT', async () => {
    const resMl = await request(app).post('/v1/auth/magic-link').send({ email: EMAIL });
    expect(resMl.status).toBe(200);
    const row = (await query(
      `SELECT token_hash FROM hub_auth_tokens WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [TENANT]
    )).rows[0];
    expect(row).toBeTruthy();
    // We cannot recover the raw token from the hash; directly generate a fresh pair via /verify by inserting a known token.
    const { randomBytes, createHash } = await import('crypto');
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 60_000);
    await query(
      `INSERT INTO hub_auth_tokens(token_hash, tenant_id, expires_at) VALUES ($1,$2,$3)`,
      [tokenHash, TENANT, expires]
    );
    const resV = await request(app).get(`/v1/auth/verify/${token}`);
    expect(resV.status).toBe(200);
    expect(resV.body.jwt).toBeTruthy();
    expect(resV.body.tenant.tenant_id).toBe(TENANT);

    // Cannot be used twice
    const resV2 = await request(app).get(`/v1/auth/verify/${token}`);
    expect(resV2.status).toBe(400);
  });

  test('JWT middleware rejects missing/invalid tokens', async () => {
    const res = await request(app).get('/v1/dashboard/overview');
    expect(res.status).toBe(401);
    const res2 = await request(app).get('/v1/dashboard/overview').set('Authorization', 'Bearer not-a-jwt');
    expect(res2.status).toBe(401);
  });
});

describe('Dashboard endpoints', () => {
  test('GET /v1/dashboard/overview returns shape', async () => {
    const res = await request(app).get('/v1/dashboard/overview')
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('suppliers');
    expect(res.body).toHaveProperty('transactions');
    expect(res.body).toHaveProperty('agent_sessions');
    expect(res.body).toHaveProperty('escalations');
    expect(res.body).toHaveProperty('dedup');
    expect(Array.isArray(res.body.transactions.volume_by_hour)).toBe(true);
  });

  test('GET /v1/dashboard/transactions paginates + filters', async () => {
    await query(
      `INSERT INTO hub_transactions(tenant_id, supplier_slug, operation, status, latency_ms)
       VALUES ($1,'s1','search','SUCCESS',100),($1,'s1','book','ERROR',400)`,
      [TENANT]
    );
    const res = await request(app).get('/v1/dashboard/transactions?limit=10')
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.transactions.length).toBeGreaterThanOrEqual(2);

    const resFilt = await request(app).get('/v1/dashboard/transactions?status=ERROR')
      .set('Authorization', `Bearer ${jwt}`);
    expect(resFilt.body.transactions.every(t => t.status === 'ERROR')).toBe(true);
  });

  test('tenant isolation: other tenant cannot see TENANT transactions', async () => {
    const res = await request(app).get('/v1/dashboard/transactions')
      .set('Authorization', `Bearer ${otherJwt}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions.every(t => t.tenant_id !== TENANT || t.tenant_id === undefined)).toBe(true);
    // Since tenant_id isn't included in response, assert count == 0 for OTHER_TENANT (we inserted none)
    expect(res.body.total).toBe(0);
  });

  test('saved prompts CRUD', async () => {
    const create = await request(app).post('/v1/agent/saved-prompts')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ label: 'Error spike', prompt_text: 'Why did error rate spike?' });
    expect(create.status).toBe(200);
    const id = create.body.id;
    const list = await request(app).get('/v1/agent/saved-prompts')
      .set('Authorization', `Bearer ${jwt}`);
    expect(list.body.saved_prompts.some(p => p.id === id)).toBe(true);
    const del = await request(app).delete(`/v1/agent/saved-prompts/${id}`)
      .set('Authorization', `Bearer ${jwt}`);
    expect(del.status).toBe(200);
  });

  test('agent chat stores conversation (mock mode)', async () => {
    process.env.AGENT_MOCK = '1';
    const res = await request(app).post('/v1/agent/chat')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ message: 'What is my error rate?', context: { current_page: 'overview', page_data: {} } });
    expect(res.status).toBe(200);
    expect(res.body.response).toBeTruthy();
    expect(res.body.conversation_id).toBeTruthy();
    const followup = await request(app).post('/v1/agent/chat')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ message: 'Anything else?', conversation_id: res.body.conversation_id });
    expect(followup.body.conversation_id).toBe(res.body.conversation_id);
  });

  test('dedup config upsert', async () => {
    const patch = await request(app).patch('/v1/dashboard/dedup-config')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ config_json: { strategy: 'LOWEST_PRICE', threshold: 0.85 }, test_mode: false });
    expect(patch.status).toBe(200);
    expect(patch.body.config_json.strategy).toBe('LOWEST_PRICE');
    const get = await request(app).get('/v1/dashboard/dedup-config')
      .set('Authorization', `Bearer ${jwt}`);
    expect(get.body.config_json.threshold).toBe(0.85);
  });

  test('settings rotate-key returns new full key once', async () => {
    const res = await request(app).post('/v1/dashboard/settings/rotate-key')
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(res.body.new_api_key).toMatch(/^[0-9a-f]{48}$/);
    const settings = await request(app).get('/v1/dashboard/settings')
      .set('Authorization', `Bearer ${jwt}`);
    expect(settings.body.api_key_preview).toMatch(/^\*\*\*\*/);
  });

  test('webhooks create + delete', async () => {
    const c = await request(app).post('/v1/dashboard/settings/webhooks')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ event_type: 'booking.confirmed', endpoint_url: 'https://example.com/hook' });
    expect(c.status).toBe(200);
    expect(c.body.secret).toBeTruthy();
    const d = await request(app).delete(`/v1/dashboard/settings/webhooks/${c.body.id}`)
      .set('Authorization', `Bearer ${jwt}`);
    expect(d.status).toBe(200);
  });
});
