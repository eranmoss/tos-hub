import { query } from '../db/client.js';
import { execSync } from '../executor/sync.js';
import { search as pipelineSearch } from '../search/pipeline.js';
import { buildContextPackage } from '../agents/context-packager.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const classify = ({ suppliers = [], complexity = 'LOW' }) => {
  if (suppliers.length > 2 || complexity === 'HIGH') return 'ASYNC';
  return 'SYNC';
};

// TODO: internal scheduler for SCHEDULED route — no cloud scheduler.
export const dispatch = async ({ tenantId, task }) => {
  if (!tenantId) throw new Error('tenant_id is required');
  const tenant = await query(
    'SELECT tenant_id FROM hub_tenants WHERE tenant_id = $1', [tenantId]
  );
  if (!tenant.rows[0]) throw new Error(`Unknown tenant: ${tenantId}`);

  const route = classify(task);
  log('info', 'dispatch', { tenant_id: tenantId, route, task_type: task.type });

  // Layer 2.5 two-stage pipeline: SEARCH with geo params routes through
  // hub_static_inventory + live reprice. Legacy single-supplier search
  // (explicit suppliers[] with no lat/lng) still hits execSync directly.
  const p = task.params || task.args || {};
  if (task.type === 'SEARCH' && p.type && typeof p.lat === 'number' && typeof p.lng === 'number') {
    const out = await pipelineSearch({ tenantId, params: p });
    return { route: 'PIPELINE', ...out };
  }

  if (route === 'SYNC') {
    const results = [];
    for (const supplier of task.suppliers || []) {
      const res = await execSync({
        tenantId, supplier, operation: task.operation || 'search', args: task.args,
      });
      results.push({ supplier, result: res });
    }
    return { route: 'SYNC', results };
  }

  const context = await buildContextPackage(tenantId, task);
  // TODO: invoke Claude Managed Agent here; for Phase 1 return context + stub
  log('info', 'async_agent_stub', { tenant_id: tenantId, task_type: task.type });
  return { route: 'ASYNC', context, status: 'DISPATCHED' };
};
