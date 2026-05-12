import nock from 'nock';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../../src/db/client.js';
import { dispatch } from '../../src/router/dispatch.js';
import { setSecret, deleteSecret } from '../../src/infra/secrets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const F = path.resolve(__dirname, '../fixtures');
const load = (f) => JSON.parse(fs.readFileSync(path.join(F, f), 'utf-8'));

const TENANT = 'test_tenant_dispatch';

beforeAll(async () => {
  await query(`DELETE FROM hub_transactions WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
  const hash = await bcrypt.hash('key', 4);
  await query(
    `INSERT INTO hub_tenants(tenant_id, name, tier, api_key_hash) VALUES ($1,$2,$3,$4)`,
    [TENANT, 'Test', 'GROWTH', hash]
  );
  await setSecret(TENANT, 'hotelbeds-hotels', { api_key: 'test', secret_key: 'test', env: 'sandbox' });
});

afterEach(() => nock.cleanAll());
afterAll(async () => {
  await deleteSecret(TENANT, 'hotelbeds-hotels');
  await query(`DELETE FROM hub_transactions WHERE tenant_id = $1`, [TENANT]);
  await query(`DELETE FROM hub_tenants WHERE tenant_id = $1`, [TENANT]);
  await closePool();
});

describe('Layer 6: dispatch routing', () => {
  test('throws when tenantId missing', async () => {
    await expect(dispatch({ tenantId: null, task: {} })).rejects.toThrow(/tenant_id/);
  });

  test('throws when tenant unknown', async () => {
    await expect(dispatch({ tenantId: 'nobody', task: { suppliers: [] } })).rejects.toThrow(/Unknown tenant/);
  });

  test('SYNC route for 1 supplier writes hub_transactions', async () => {
    nock('https://api.test.hotelbeds.com')
      .post('/hotel-api/1.2/hotels').reply(200, load('hotelbeds-hotel-response.json'));
    const result = await dispatch({
      tenantId: TENANT,
      task: { suppliers: ['hotelbeds-hotels'], operation: 'search', args: { destination: 'BCN' }, complexity: 'LOW', type: 'SEARCH' },
    });
    expect(result.route).toBe('SYNC');
    expect(result.results[0].result.length).toBeGreaterThan(0);
    const txn = await query(
      `SELECT * FROM hub_transactions WHERE tenant_id = $1 AND operation = 'search' ORDER BY created_at DESC LIMIT 1`,
      [TENANT]
    );
    expect(txn.rows.length).toBe(1);
    expect(txn.rows[0].status).toBe('OK');
  });

  test('ASYNC route for >2 suppliers returns context', async () => {
    const result = await dispatch({
      tenantId: TENANT,
      task: { suppliers: ['a', 'b', 'c'], complexity: 'HIGH', type: 'SEARCH' },
    });
    expect(result.route).toBe('ASYNC');
    expect(result.context.tenant.id).toBe(TENANT);
    expect(result.status).toBe('DISPATCHED');
  });
});
