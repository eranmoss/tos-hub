import { query, closePool } from '../../src/db/client.js';

const EXPECTED_TABLES = [
  'hub_tenants', 'hub_credentials_map', 'hub_transactions',
  'hub_schema_mappings', 'hub_dedup_config', 'hub_dedup_test_log',
  'hub_prompts', 'hub_escalations', 'agent_sessions', 'hub_webhooks',
  'hotel_content', 'hub_suppliers', 'hub_tenant_suppliers',
  'hub_onboarding_sessions', 'hub_integration_tests', 'hub_tool_contracts',
];

afterAll(async () => { await closePool(); });

const LAYER_2_5_TABLES = [
  'hub_static_inventory', 'hub_dedup_pairs', 'hub_sync_jobs', 'hub_sync_errors',
];

describe('Layer 1: initial schema', () => {
  test('all 16 tables exist', async () => {
    const res = await query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [EXPECTED_TABLES]
    );
    const found = res.rows.map(r => r.table_name).sort();
    expect(found).toEqual([...EXPECTED_TABLES].sort());
  });

  test('Layer 2.5 static inventory tables exist', async () => {
    const res = await query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [LAYER_2_5_TABLES]
    );
    const found = res.rows.map(r => r.table_name).sort();
    expect(found).toEqual([...LAYER_2_5_TABLES].sort());
  });
});
