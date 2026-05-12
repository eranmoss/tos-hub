import 'dotenv/config';
import express from 'express';
import { randomUUID, createHash } from 'crypto';
import { query } from './db/client.js';
import { apiKeyAuth, internalAuth, adminAuth } from './middleware/auth.js';
import { tenantRateLimit } from './middleware/rate-limit.js';
import { dispatch } from './router/dispatch.js';
import { execSync } from './executor/sync.js';
import { validateManifest } from './onboarding/manifest.js';
import { runSandboxValidation } from './onboarding/validation.js';
import { runProvisioning } from './onboarding/provisioning.js';
import { probeAndMatch } from './onboarding/auto-mapper.js';
import { targetsForType } from './onboarding/cts-targets.js';
import { evaluateTriggers } from './prompts/library.js';
import { setSecret, deleteSecret } from './infra/secrets.js';
import { buildDashboardRouter } from './dashboard/routes.js';
import { buildCatalogRouter } from './catalog/routes.js';

export const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // CORS for dashboard dev server
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.DASHBOARD_APP_URL || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Public catalog API (deduplicated inventory)
  app.use(buildCatalogRouter());

  // Dashboard API (magic-link auth + JWT-protected endpoints)
  app.use(buildDashboardRouter());

  // ---- Core API (API Key) ----
  const api = express.Router();
  api.use(apiKeyAuth);
  api.use(tenantRateLimit);

  api.post('/v1/search', async (req, res) => {
    try {
      const result = await dispatch({ tenantId: req.tenant.tenant_id, task: { ...req.body, type: 'SEARCH' } });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.post('/v1/book', async (req, res) => {
    try {
      const { supplier, args } = req.body;
      const result = await execSync({ tenantId: req.tenant.tenant_id, supplier, operation: 'book', args });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.post('/v1/cancel', async (req, res) => {
    try {
      const { supplier, ref } = req.body;
      const result = await execSync({ tenantId: req.tenant.tenant_id, supplier, operation: 'cancel', args: ref });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/v1/booking/:id', async (req, res) => {
    try {
      const { supplier } = req.query;
      const result = await execSync({ tenantId: req.tenant.tenant_id, supplier, operation: 'get', args: req.params.id });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- Onboarding ----
  api.post('/v1/integrations/onboard', async (req, res) => {
    const manifest = req.body.manifest || req.body;
    if (manifest?.tenant_config) manifest.tenant_config.tenant_id = req.tenant.tenant_id;
    const v = validateManifest(manifest, { partial: true });
    const r = await query(
      `INSERT INTO hub_onboarding_sessions(tenant_id, path, status, manifest_json)
       VALUES ($1,$2,'IN_PROGRESS',$3) RETURNING session_id`,
      [req.tenant.tenant_id, req.body.path || 'API', manifest]
    );
    res.json({ session_id: r.rows[0].session_id, validation_hint: v.errors || null });
  });

  api.get('/v1/integrations/onboard/:id', async (req, res) => {
    const r = await query(
      `SELECT session_id, status, manifest_json AS manifest, validation_report
       FROM hub_onboarding_sessions WHERE session_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenant.tenant_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  });

  api.patch('/v1/integrations/onboard/:id/manifest', async (req, res) => {
    const manifest = req.body;
    if (manifest?.tenant_config) manifest.tenant_config.tenant_id = req.tenant.tenant_id;
    const r = await query(
      `UPDATE hub_onboarding_sessions SET manifest_json = $1, updated_at = now()
       WHERE session_id = $2 AND tenant_id = $3 RETURNING session_id, manifest_json`,
      [manifest, req.params.id, req.tenant.tenant_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  });

  api.post('/v1/integrations/onboard/:id/auto-map', async (req, res) => {
    const r = await query(
      `SELECT manifest_json FROM hub_onboarding_sessions
       WHERE session_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenant.tenant_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    const manifest = r.rows[0].manifest_json;
    const credentials = req.body?.credentials || manifest?.auth?.credentials || {};
    const type = manifest?.cts_mapping?.type_value;
    if (!type) return res.status(400).json({ error: 'cts_mapping.type_value missing' });
    try {
      const result = await probeAndMatch({
        manifest,
        credentials,
        cts_targets: targetsForType(type),
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.post('/v1/integrations/onboard/:id/confirm', async (req, res) => {
    const r = await query(
      `SELECT manifest_json FROM hub_onboarding_sessions
       WHERE session_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenant.tenant_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    const v = validateManifest(r.rows[0].manifest_json);
    if (!v.ok) {
      await query(
        `UPDATE hub_onboarding_sessions SET status='FAILED', validation_report=$1 WHERE session_id=$2`,
        [{ manifest_errors: v.errors }, req.params.id]
      );
      return res.status(400).json({ error: 'manifest invalid', details: v.errors });
    }
    const report = await runSandboxValidation(r.rows[0].manifest_json);
    const status = report.passed ? 'VALIDATED' : 'FAILED';
    await query(
      `UPDATE hub_onboarding_sessions SET status=$1, validation_report=$2, updated_at=now() WHERE session_id=$3`,
      [status, report, req.params.id]
    );
    res.json({ status, report });
  });

  api.post('/v1/integrations/onboard/:id/promote', async (req, res) => {
    const r = await query(
      `SELECT manifest_json, status FROM hub_onboarding_sessions
       WHERE session_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenant.tenant_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    if (r.rows[0].status !== 'VALIDATED') {
      return res.status(400).json({ error: 'validation not passed' });
    }
    const result = await runProvisioning({
      manifest: r.rows[0].manifest_json, tenantId: req.tenant.tenant_id,
    });
    await query(
      `UPDATE hub_onboarding_sessions SET status='PROMOTED', promoted_at=now() WHERE session_id=$1`,
      [req.params.id]
    );
    res.json({ status: 'PROMOTED', provisioning: result });
  });

  api.get('/v1/integrations', async (req, res) => {
    const r = await query(
      `SELECT ts.supplier_slug, ts.sla_tier, s.name, s.categories, ts.is_active
       FROM hub_tenant_suppliers ts JOIN hub_suppliers s ON s.supplier_slug = ts.supplier_slug
       WHERE ts.tenant_id = $1`, [req.tenant.tenant_id]
    );
    res.json({ integrations: r.rows });
  });

  api.delete('/v1/integrations/:slug', async (req, res) => {
    await query(
      `UPDATE hub_tenant_suppliers SET is_active=false WHERE tenant_id=$1 AND supplier_slug=$2`,
      [req.tenant.tenant_id, req.params.slug]
    );
    res.json({ status: 'deactivated' });
  });

  api.get('/v1/session/:id', async (req, res) => {
    const r = await query(
      `SELECT session_id, status, checkpoint, result FROM agent_sessions
       WHERE session_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenant.tenant_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  });

  api.get('/v1/tools', async (_req, res) => {
    const r = await query(
      `SELECT tool_name, version, executor, sla_ms FROM hub_tool_contracts WHERE is_active = true`
    );
    res.json({ tools: r.rows });
  });

  api.post('/v1/tools/:contract', async (req, res) => {
    const r = await query(
      `SELECT * FROM hub_tool_contracts WHERE tool_name = $1 AND is_active = true`,
      [req.params.contract]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'contract not found' });
    res.json({ status: 'dispatched', contract: r.rows[0].tool_name });
  });

  // ---- Webhooks ----
  app.post('/v1/webhook/:partner', async (req, res) => {
    const secret = req.header('X-Webhook-Secret') || '';
    const hash = createHash('sha256').update(secret).digest('hex');
    const rows = (await query(
      `SELECT id, tenant_id FROM hub_webhooks WHERE secret_hash = $1 AND is_active = true LIMIT 1`, [hash]
    )).rows;
    if (!rows[0]) return res.status(401).json({ error: 'invalid webhook secret' });
    console.log(JSON.stringify({ level: 'info', event: 'webhook_received', partner: req.params.partner, tenant_id: rows[0].tenant_id }));
    res.json({ received: true });
  });

  // ---- Internal ----
  app.post('/v1/agent/callback', internalAuth, async (req, res) => {
    const { session_id, result, status = 'COMPLETED' } = req.body;
    await query(
      `UPDATE agent_sessions SET status=$1, result=$2, updated_at=now() WHERE session_id=$3`,
      [status, result, session_id]
    );
    res.json({ ack: true });
  });

  // ---- Admin ----
  app.get('/v1/admin/dedup/test-log/:tenantId', adminAuth, async (req, res) => {
    const r = await query(
      `SELECT * FROM hub_dedup_test_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.params.tenantId]
    );
    res.json({ entries: r.rows });
  });

  app.post('/v1/admin/prompts', adminAuth, async (req, res) => {
    const { prompt_key, category, trigger_condition, prompt_template, escalate_to_human } = req.body;
    const r = await query(
      `INSERT INTO hub_prompts(prompt_key, category, trigger_condition, prompt_template, escalate_to_human)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (prompt_key) DO UPDATE SET
         category=EXCLUDED.category, trigger_condition=EXCLUDED.trigger_condition,
         prompt_template=EXCLUDED.prompt_template, escalate_to_human=EXCLUDED.escalate_to_human,
         updated_at=now()
       RETURNING prompt_key, is_active`,
      [prompt_key, category, trigger_condition, prompt_template, !!escalate_to_human]
    );
    res.json(r.rows[0]);
  });

  app.post('/v1/admin/credentials', adminAuth, async (req, res) => {
    try {
      const { tenant_id, supplier_slug, credentials } = req.body;
      if (!tenant_id || !supplier_slug || !credentials || typeof credentials !== 'object') {
        return res.status(400).json({ error: 'tenant_id, supplier_slug, credentials (object) required' });
      }
      await setSecret(tenant_id, supplier_slug, credentials);
      res.json({ status: 'stored', tenant_id, supplier_slug });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/v1/admin/credentials/:tenantId/:supplierSlug', adminAuth, async (req, res) => {
    try {
      await deleteSecret(req.params.tenantId, req.params.supplierSlug);
      res.json({ status: 'deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/v1/admin/knowledge/:slug', adminAuth, async (req, res) => {
    try {
      const { loadVendorKnowledge } = await import('./knowledge/vendor-knowledge.js');
      const v = await loadVendorKnowledge(req.params.slug);
      if (!v) return res.status(404).json({ error: 'no knowledge for vendor' });
      res.json(v);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/v1/admin/knowledge/:slug', adminAuth, async (req, res) => {
    try {
      const { applyPendingUpdate, saveVendorKnowledge, loadVendorKnowledge } = await import('./knowledge/vendor-knowledge.js');
      const action = req.body?.action || 'apply_pending';
      if (action === 'apply_pending') {
        const updated = await applyPendingUpdate(req.params.slug);
        if (!updated) return res.status(404).json({ error: 'no pending update' });
        return res.json(updated);
      }
      if (action === 'set') {
        const { category, knowledge_md, knowledge_json } = req.body;
        if (!category || !knowledge_md) return res.status(400).json({ error: 'category and knowledge_md required' });
        await saveVendorKnowledge(req.params.slug, { category, knowledge_md, knowledge_json: knowledge_json || {}, generated_by: 'admin' });
        return res.json(await loadVendorKnowledge(req.params.slug));
      }
      res.status(400).json({ error: 'unknown action' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/v1/admin/knowledge-events/:slug', adminAuth, async (req, res) => {
    try {
      const r = await query(
        `SELECT id, event_type, payload, proposed_update, status, created_at
         FROM hub_knowledge_events WHERE supplier_slug=$1 ORDER BY created_at DESC LIMIT 50`,
        [req.params.slug]
      );
      res.json({ events: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/v1/admin/escalation/:id/resolve', adminAuth, async (req, res) => {
    try {
      const { resolution, resolved_by } = req.body;
      const r = await query(
        `UPDATE hub_escalations SET status='RESOLVED', resolution=$1, resolved_by=$2, resolved_at=now()
         WHERE id=$3 RETURNING id, status`,
        [resolution, resolved_by, req.params.id]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.use(api);

  return app;
};

if (process.env.NODE_ENV !== 'test') {
  const app = buildApp();
  const port = Number(process.env.PORT || 3000);
  const cleanStaleJobs = async (retries = 5) => {
    for (let i = 0; i < retries; i++) {
      try {
        const stale = await query(
          `UPDATE hub_sync_jobs SET status = 'FAILED', error_message = 'Server restarted — marked stale', completed_at = now()
           WHERE status = 'RUNNING'
           RETURNING id, job_type, supplier_slug, started_at`
        );
        if (stale.rows.length > 0) {
          console.log(JSON.stringify({ level: 'warn', event: 'stale_jobs_cleaned', count: stale.rows.length, jobs: stale.rows }));
        }
        return;
      } catch (e) {
        console.error(`Stale job cleanup attempt ${i + 1}/${retries} failed:`, e.message);
        if (i < retries - 1) await new Promise(r => setTimeout(r, 2000));
      }
    }
  };

  app.listen(port, () => {
    console.log(JSON.stringify({
      level: 'info', event: 'server_started', port,
      database: process.env.DATABASE_URL?.replace(/\/\/.*@/, '//***@'),
    }));
    cleanStaleJobs();
  });
}
