import { query } from '../db/client.js';
import { loadDedupConfig } from '../dedup/config.js';

export const buildContextPackage = async (tenantId, task = {}) => {
  const tenant = await query(
    'SELECT * FROM hub_tenants WHERE tenant_id = $1', [tenantId]
  );
  if (!tenant.rows[0]) throw new Error(`Unknown tenant: ${tenantId}`);
  const t = tenant.rows[0];

  const suppliers = await query(
    `SELECT supplier_slug, sla_tier, preferred_for_cats FROM hub_tenant_suppliers
     WHERE tenant_id = $1 AND is_active = true`, [tenantId]
  );
  const tools = await query(
    'SELECT tool_name, executor, sla_ms FROM hub_tool_contracts WHERE is_active = true'
  );
  const prompts = await query(
    'SELECT prompt_key, trigger_condition FROM hub_prompts WHERE is_active = true'
  );
  const dedup = await loadDedupConfig(tenantId);

  const supplierHealth = {};
  for (const row of suppliers.rows) supplierHealth[row.supplier_slug] = 'UP';

  const secretsMap = {};
  for (const row of suppliers.rows) {
    secretsMap[row.supplier_slug] = `/tos/prod/${tenantId}/${row.supplier_slug}/credentials`;
  }

  return {
    tenant: {
      id: t.tenant_id,
      tier: t.tier,
      rate_limits: { rpm: t.rate_limit_rpm },
      approved_suppliers: suppliers.rows.map(r => r.supplier_slug),
      schema_profile_id: t.schema_profile || 'standard',
      sla_thresholds: { response_ms: 800, uptime_pct: 99.5 },
    },
    task: {
      type: task.type || 'SEARCH',
      priority: task.priority || 'NORMAL',
      timeout_seconds: task.timeout_seconds || 30,
      escalation_path: task.escalation_path || 'email',
    },
    tool_contracts: tools.rows.map(r => ({
      tool_name: r.tool_name, executor: r.executor, sla_ms: r.sla_ms,
    })),
    cts_schema_reference: { version: '1.3', types: ['EXPERIENCE', 'HOTEL', 'TRANSFER'] },
    supplier_health: supplierHealth,
    domain_rules: {
      dedup_strategy: dedup.strategy,
      preferred_supplier: dedup.preferred_supplier,
      max_rebook_delta_usd: 50,
    },
    secrets_map: secretsMap,
    active_prompts: prompts.rows,
  };
};
