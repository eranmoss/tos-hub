import express from 'express';
import axios from 'axios';
import { randomUUID, createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { query } from '../db/client.js';
import { jwtAuth } from '../middleware/jwt-auth.js';
import { signDashboardJwt } from '../auth/jwt.js';
import {
  createMagicLinkToken,
  consumeMagicLinkToken,
  sendMagicLinkEmail,
} from '../auth/magic-link.js';
import { handleChat } from '../agents/chat.js';
import { validateManifest } from '../onboarding/manifest.js';
import { runSandboxValidation } from '../onboarding/validation.js';
import { runProvisioning } from '../onboarding/provisioning.js';
import { analyzeDocs } from '../onboarding/analyzer.js';
import { probeAndMatch } from '../onboarding/auto-mapper.js';
import { targetsForType } from '../onboarding/cts-targets.js';
import { runLifecycleStep, supportedSuppliers } from '../lifecycle/router.js';
import { precomputeDedup, llmJudgePass, llmGeoReview } from '../sync/dedup-precompute.js';
import { clusterAttractions, validateAttractions } from '../sync/attraction-cluster.js';
import { syncBridgifyExperiences } from '../sync/bridgify-experiences.js';
import { syncHotelbedsHotels } from '../sync/hotelbeds-hotels.js';
import { syncHotelbedsExperiences } from '../sync/hotelbeds-experiences.js';
import { syncHotelbedsTransfers } from '../sync/hotelbeds-transfers.js';
import { syncViatorExperiences } from '../sync/viator-experiences.js';
import { syncTicketmasterEvents } from '../sync/ticketmaster-events.js';
import { syncDuffelFlights } from '../sync/duffel-flights.js';
import { syncViatorTaxonomy } from '../sync/viator-taxonomy.js';
import { migrateAttractionsToGlobalPois, matchInventoryToPois, refreshPoiCounts } from '../sync/poi-matcher.js';
import { enrichActivities } from '../sync/enrich-activities.js';
import { buildEmbeddings } from '../sync/build-embeddings.js';
import { loadRankingConfig, saveRankingConfig } from '../catalog/ranker.js';
import { autoMapUnmapped, getUnmappedCategories } from '../knowledge/category-mapper.js';
import { sampleGoldPairs, labelGoldPairs, evalGoldDataset, getGoldDataset } from '../dedup/gold-dataset.js';
import { getSecret } from '../infra/secrets.js';
import { JOB_TYPES, runTracked, updateJobProgress, getActiveJobs, getRunningJobs, cancelJob } from '../jobs/tracker.js';

const tenantId = (req) => req.dashboardTenant.tenant_id;

const hotelbedsHotelsDefaultManifest = (slug) => ({
  manifest_version: '1.0',
  supplier: {
    name: 'HotelBeds Hotels', slug,
    categories: ['HOTEL'],
    base_url_sandbox: 'https://api.test.hotelbeds.com',
    base_url_production: 'https://api.hotelbeds.com',
    documentation_url: 'https://developer.hotelbeds.com/documentation/hotels/',
    support_contact: 'ops@tos.dev',
  },
  auth: {
    type: 'HMAC_SHA256',
    credential_fields: ['api_key', 'secret'],
    credentials: {
      api_key: process.env.HOTELBEDS_API_KEY,
      secret: process.env.HOTELBEDS_SECRET || process.env.HOTELBEDS_SECRET_KEY,
    },
    signature_algorithm: 'SHA256',
    signature_inputs: ['api_key', 'secret', 'timestamp'],
  },
  operations: {
    search: { method: 'POST', endpoint: '/hotel-api/1.0/hotels' },
    book:   { method: 'POST', endpoint: '/hotel-api/1.0/bookings' },
    cancel: { method: 'DELETE', endpoint: '/hotel-api/1.0/bookings/:ref' },
  },
  rate_limit_rpm: 500, response_format: 'JSON', supports_webhooks: false,
  cts_mapping: {
    type_value: 'HOTEL',
    field_mappings: [
      { source: 'hotels.hotels[].code', target: 'supplier_raw_ref', transform: null },
      { source: 'hotels.hotels[].name', target: 'title', transform: null },
    ],
    default_currency: 'EUR',
  },
  test_suite: {
    sandbox_search_params: {
      stay: { checkIn: '2026-06-01', checkOut: '2026-06-02' },
      occupancies: [{ rooms: 1, adults: 2, children: 0 }],
      destinations: [{ code: 'BCN' }],
    },
    expected_result_count_min: 1,
    test_booking_ref: null,
  },
  tenant_config: { tenant_id: '', sla_tier: 'ENTERPRISE', preferred_for_categories: ['HOTEL'] },
});

const hotelbedsActivitiesDefaultManifest = (slug) => ({
  manifest_version: '1.0',
  supplier: {
    name: 'HotelBeds Activities', slug,
    categories: ['EXPERIENCE'],
    base_url_sandbox: 'https://api.test.hotelbeds.com',
    base_url_production: 'https://api.hotelbeds.com',
    documentation_url: 'https://developer.hotelbeds.com/documentation/activities/',
    support_contact: 'ops@tos.dev',
  },
  auth: {
    type: 'HMAC_SHA256',
    credential_fields: ['api_key', 'secret'],
    credentials: {
      api_key: process.env.HOTELBEDS_API_KEY,
      secret: process.env.HOTELBEDS_SECRET || process.env.HOTELBEDS_SECRET_KEY,
    },
    signature_algorithm: 'SHA256',
    signature_inputs: ['api_key', 'secret', 'timestamp'],
  },
  operations: {
    search: { method: 'POST', endpoint: '/activity-api/3.0/activities' },
    book:   { method: 'POST', endpoint: '/activity-api/3.0/bookings' },
    cancel: { method: 'DELETE', endpoint: '/activity-api/3.0/bookings/:ref' },
  },
  rate_limit_rpm: 500, response_format: 'JSON', supports_webhooks: false,
  cts_mapping: { type_value: 'EXPERIENCE', field_mappings: [], default_currency: 'EUR' },
  test_suite: {
    sandbox_search_params: {
      filters: [{ searchFilterItems: [{ type: 'destination', value: 'BCN' }] }],
      from: '2026-06-01', to: '2026-06-02',
      paxes: [{ age: 30 }, { age: 30 }],
    },
    expected_result_count_min: 1,
    test_booking_ref: null,
  },
  tenant_config: { tenant_id: '', sla_tier: 'ENTERPRISE', preferred_for_categories: ['EXPERIENCE'] },
});

const hotelbedsTransfersDefaultManifest = (slug) => ({
  manifest_version: '1.0',
  supplier: {
    name: 'HotelBeds Transfers', slug,
    categories: ['TRANSFER'],
    base_url_sandbox: 'https://api.test.hotelbeds.com',
    base_url_production: 'https://api.hotelbeds.com',
    documentation_url: 'https://developer.hotelbeds.com/documentation/transfers/',
    support_contact: 'ops@tos.dev',
  },
  auth: {
    type: 'HMAC_SHA256',
    credential_fields: ['api_key', 'secret'],
    credentials: {
      api_key: process.env.HOTELBEDS_API_KEY,
      secret: process.env.HOTELBEDS_SECRET || process.env.HOTELBEDS_SECRET_KEY,
    },
    signature_algorithm: 'SHA256',
    signature_inputs: ['api_key', 'secret', 'timestamp'],
  },
  operations: {
    search: { method: 'GET', endpoint: '/transfer-api/1.0/availability/en/from/IATA/BCN/to/ATLAS/348/2026-06-01/2026-06-02/2/0/0' },
    book:   { method: 'POST', endpoint: '/transfer-api/1.0/bookings' },
    cancel: { method: 'DELETE', endpoint: '/transfer-api/1.0/bookings/:ref' },
  },
  rate_limit_rpm: 500, response_format: 'JSON', supports_webhooks: false,
  cts_mapping: { type_value: 'TRANSFER', field_mappings: [], default_currency: 'EUR' },
  test_suite: {
    sandbox_search_params: {},
    expected_result_count_min: 1,
    test_booking_ref: null,
  },
  tenant_config: { tenant_id: '', sla_tier: 'ENTERPRISE', preferred_for_categories: ['TRANSFER'] },
});

const resolveSupplierManifest = async (tid, slug) => {
  const row = (await query(
    `SELECT manifest_json FROM hub_onboarding_sessions
      WHERE tenant_id = $1 AND manifest_json->'supplier'->>'slug' = $2
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1`,
    [tid, slug]
  )).rows[0];
  if (row?.manifest_json) return row.manifest_json;
  if (slug.startsWith('hotelbeds-hotels')) return hotelbedsHotelsDefaultManifest(slug);
  if (slug.startsWith('hotelbeds-activities')) return hotelbedsActivitiesDefaultManifest(slug);
  if (slug.startsWith('hotelbeds-transfers')) return hotelbedsTransfersDefaultManifest(slug);
  return null;
};

export const buildDashboardRouter = () => {
  const r = express.Router();

  // -------- Auth (public) --------
  r.post('/v1/auth/magic-link', async (req, res) => {
    try {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: 'email required' });
      const u = (await query(
        `SELECT u.id AS user_id, u.name AS user_name, u.email, u.role,
                t.tenant_id, t.name AS tenant_name, t.tier
         FROM hub_users u
         JOIN hub_tenants t ON t.tenant_id = u.tenant_id
         WHERE LOWER(u.email) = LOWER($1) AND u.is_active = true
         LIMIT 1`,
        [email]
      )).rows[0];
      if (!u) return res.json({ message: 'check your email' });
      const { token } = await createMagicLinkToken(u.tenant_id, u.user_id);
      const appBaseUrl = process.env.DASHBOARD_APP_URL || 'http://localhost:5173';
      await sendMagicLinkEmail({ email: u.email, token, appBaseUrl });
      res.json({ message: 'check your email' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.post('/v1/auth/dev-login', async (req, res) => {
    if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'not found' });
    try {
      const email = req.body?.email || null;
      const u = (await query(
        email
          ? `SELECT u.id AS user_id, u.name AS user_name, u.email, u.role,
                    t.tenant_id, t.name AS tenant_name, t.tier
             FROM hub_users u
             JOIN hub_tenants t ON t.tenant_id = u.tenant_id
             WHERE LOWER(u.email) = LOWER($1) AND u.is_active = true
             LIMIT 1`
          : `SELECT u.id AS user_id, u.name AS user_name, u.email, u.role,
                    t.tenant_id, t.name AS tenant_name, t.tier
             FROM hub_users u
             JOIN hub_tenants t ON t.tenant_id = u.tenant_id
             WHERE u.is_active = true
             ORDER BY t.tenant_id LIMIT 1`,
        email ? [email] : []
      )).rows[0];
      if (!u) return res.status(404).json({ error: 'no user with that email' });
      const jwt = signDashboardJwt(u);
      res.json({ jwt, tenant: u });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.get('/v1/auth/verify/:token', async (req, res) => {
    try {
      const result = await consumeMagicLinkToken(req.params.token);
      if (!result.ok) return res.status(400).json({ error: result.reason });
      const jwt = signDashboardJwt(result.tenant);
      res.json({ jwt, tenant: result.tenant });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // -------- JWT-protected --------
  // Apply jwtAuth per-route (not router-level) so unmatched paths fall through
  // to other routers mounted on the app.
  const p = express.Router();

  // ---- Agent ----
  p.post('/v1/agent/chat', jwtAuth, async (req, res) => {
    try {
      const { message, conversation_id, context } = req.body || {};
      const out = await handleChat({
        tenant_id: tenantId(req), message, conversation_id, context,
      });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.get('/v1/agent/conversations', jwtAuth, async (req, res) => {
    const rows = (await query(
      `SELECT id, jsonb_array_length(messages) AS message_count, created_at, updated_at
         FROM hub_agent_conversations WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 20`,
      [tenantId(req)]
    )).rows;
    res.json({ conversations: rows });
  });

  p.get('/v1/agent/conversations/:id', jwtAuth, async (req, res) => {
    const row = (await query(
      `SELECT id, messages, created_at, updated_at FROM hub_agent_conversations
        WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId(req)]
    )).rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  });

  p.get('/v1/agent/saved-prompts', jwtAuth, async (req, res) => {
    const rows = (await query(
      `SELECT id, label, prompt_text, created_at FROM hub_saved_prompts
        WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId(req)]
    )).rows;
    res.json({ saved_prompts: rows });
  });

  p.post('/v1/agent/saved-prompts', jwtAuth, async (req, res) => {
    const { label, prompt_text } = req.body || {};
    if (!label || !prompt_text)
      return res.status(400).json({ error: 'label and prompt_text required' });
    const count = (await query(
      `SELECT COUNT(*)::int AS n FROM hub_saved_prompts WHERE tenant_id = $1`,
      [tenantId(req)]
    )).rows[0].n;
    if (count >= 20) return res.status(400).json({ error: 'saved prompt limit reached (20)' });
    const row = (await query(
      `INSERT INTO hub_saved_prompts(tenant_id, label, prompt_text)
       VALUES ($1, $2, $3)
       RETURNING id, label, prompt_text, created_at`,
      [tenantId(req), label, prompt_text]
    )).rows[0];
    res.json(row);
  });

  p.delete('/v1/agent/saved-prompts/:id', jwtAuth, async (req, res) => {
    const r2 = await query(
      `DELETE FROM hub_saved_prompts WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, tenantId(req)]
    );
    if (!r2.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: r2.rows[0].id });
  });

  // ---- Overview (Layer 5) ----
  p.get('/v1/dashboard/overview', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const suppliers = (await query(
      `SELECT ts.supplier_slug,
              s.name, s.categories,
              COALESCE(
                (SELECT (CASE WHEN COUNT(*) = 0 THEN 'UP'
                              WHEN (COUNT(*) FILTER (WHERE status != 'SUCCESS'))::float / NULLIF(COUNT(*),0) > 0.10 THEN 'DOWN'
                              WHEN (COUNT(*) FILTER (WHERE status != 'SUCCESS'))::float / NULLIF(COUNT(*),0) > 0.02 THEN 'DEGRADED'
                              ELSE 'UP' END)
                   FROM hub_transactions
                  WHERE tenant_id = $1 AND supplier_slug = ts.supplier_slug
                    AND created_at >= now() - INTERVAL '1 hour'),
                'UP'
              ) AS status,
              COALESCE((
                SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int
                  FROM hub_transactions
                 WHERE tenant_id = $1 AND supplier_slug = ts.supplier_slug
                   AND created_at >= now() - INTERVAL '24 hours'
              ), 0) AS latency_p95_ms,
              COALESCE((
                SELECT ROUND(((COUNT(*) FILTER (WHERE status != 'SUCCESS'))::numeric
                              / NULLIF(COUNT(*),0)::numeric) * 100, 2)
                  FROM hub_transactions
                 WHERE tenant_id = $1 AND supplier_slug = ts.supplier_slug
                   AND created_at >= now() - INTERVAL '24 hours'
              ), 0) AS error_rate_pct,
              COALESCE((
                SELECT COUNT(*)::int FROM hub_transactions
                 WHERE tenant_id = $1 AND supplier_slug = ts.supplier_slug
                   AND created_at >= now() - INTERVAL '24 hours'
              ), 0) AS transactions_24h
         FROM hub_tenant_suppliers ts
         JOIN hub_suppliers s ON s.supplier_slug = ts.supplier_slug
        WHERE ts.tenant_id = $1 AND ts.is_active = true`,
      [tid]
    )).rows;

    const txnAgg = (await query(
      `SELECT COUNT(*)::int AS total_24h,
              COALESCE(ROUND(((COUNT(*) FILTER (WHERE status = 'SUCCESS'))::numeric
                / NULLIF(COUNT(*),0)::numeric) * 100, 2), 0) AS success_rate_pct,
              COALESCE(AVG(latency_ms), 0)::int AS avg_latency_ms
         FROM hub_transactions
        WHERE tenant_id = $1 AND created_at >= now() - INTERVAL '24 hours'`,
      [tid]
    )).rows[0];

    const volumeByHour = (await query(
      `SELECT date_trunc('hour', created_at) AS hour,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE status != 'SUCCESS')::int AS errors
         FROM hub_transactions
        WHERE tenant_id = $1 AND created_at >= now() - INTERVAL '24 hours'
     GROUP BY hour ORDER BY hour`,
      [tid]
    )).rows;

    const sessions = (await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS active,
         COUNT(*) FILTER (WHERE status = 'COMPLETED' AND updated_at >= now() - INTERVAL '24 hours')::int AS completed_24h,
         COUNT(*) FILTER (WHERE status = 'FAILED' AND updated_at >= now() - INTERVAL '24 hours')::int AS failed_24h
         FROM agent_sessions WHERE tenant_id = $1`,
      [tid]
    )).rows[0];

    const esc = (await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'RESOLVED' AND resolved_at >= now() - INTERVAL '24 hours')::int AS resolved_24h
         FROM hub_escalations WHERE tenant_id = $1`,
      [tid]
    )).rows[0];

    const dedup = (await query(
      `SELECT
         COUNT(*) FILTER (WHERE canonical_id IS NOT NULL)::int AS duplicates_hidden,
         COUNT(*) FILTER (WHERE canonical_id IS NULL)::int AS unique_shown,
         COUNT(DISTINCT canonical_id) FILTER (WHERE canonical_id IS NOT NULL)::int AS clusters,
         COUNT(*) FILTER (WHERE type = 'EXPERIENCE')::int AS total_experiences,
         COUNT(*) FILTER (WHERE type = 'HOTEL')::int AS total_hotels,
         COUNT(*) FILTER (WHERE type = 'TRANSFER')::int AS total_transfers
         FROM hub_static_inventory
        WHERE is_active = true`
    )).rows[0];

    const syncRows = (await query(
      `SELECT ts.supplier_slug,
              (SELECT COUNT(*)::int FROM hub_static_inventory si
                WHERE si.supplier_slug = ts.supplier_slug AND si.is_active = true) AS records_active,
              (SELECT COUNT(*)::int FROM hub_static_inventory si
                WHERE si.supplier_slug = ts.supplier_slug AND si.is_active = false) AS records_inactive,
              (SELECT MAX(last_synced_at) FROM hub_static_inventory si
                WHERE si.supplier_slug = ts.supplier_slug) AS last_synced_at,
              (SELECT status FROM hub_sync_jobs sj
                WHERE sj.supplier_slug = ts.supplier_slug
                ORDER BY started_at DESC NULLS LAST LIMIT 1) AS last_job_status,
              (SELECT started_at FROM hub_sync_jobs sj
                WHERE sj.supplier_slug = ts.supplier_slug
                ORDER BY started_at DESC NULLS LAST LIMIT 1) AS last_job_started_at
         FROM hub_tenant_suppliers ts
        WHERE ts.tenant_id = $1 AND ts.is_active = true`,
      [tid]
    )).rows;

    const embeddingStats = (await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_embedding,
         COUNT(*) FILTER (WHERE embedding IS NULL)::int AS without_embedding
       FROM hub_static_inventory
       WHERE is_active = true`
    )).rows[0];

    const embeddingBySupplier = (await query(
      `SELECT si.supplier_slug,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE si.embedding IS NOT NULL)::int AS with_embedding
         FROM hub_static_inventory si
         JOIN hub_tenant_suppliers ts
           ON ts.supplier_slug = si.supplier_slug
          AND ts.tenant_id = $1
          AND ts.is_active = true
        WHERE si.is_active = true
        GROUP BY si.supplier_slug
        ORDER BY total DESC`,
      [tid]
    )).rows;

    const lastImportJob = (await query(
      `SELECT supplier_slug, status, records_fetched, records_upserted,
              started_at, completed_at,
              EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - started_at))::int AS duration_sec
         FROM hub_sync_jobs
        WHERE supplier_slug = 'bridgify_import'
        ORDER BY started_at DESC LIMIT 1`
    )).rows[0] || null;

    const contentRows = (await query(
      `SELECT si.type, si.supplier_slug, COUNT(*)::int AS count
         FROM hub_static_inventory si
         JOIN hub_tenant_suppliers ts
           ON ts.supplier_slug = si.supplier_slug
          AND ts.tenant_id = $1
          AND ts.is_active = true
        WHERE si.is_active = true
        GROUP BY si.type, si.supplier_slug
        ORDER BY si.type, si.supplier_slug`,
      [tid]
    )).rows;
    const byType = new Map();
    for (const row of contentRows) {
      if (!byType.has(row.type)) byType.set(row.type, { type: row.type, total_active: 0, by_supplier: [] });
      const bucket = byType.get(row.type);
      bucket.total_active += row.count;
      bucket.by_supplier.push({ supplier_slug: row.supplier_slug, count: row.count });
    }
    const contentByType = Array.from(byType.values());

    const categoryBreakdown = (await query(
      `SELECT si.category, si.supplier_slug, COUNT(*)::int AS count
         FROM hub_static_inventory si
         JOIN hub_tenant_suppliers ts
           ON ts.supplier_slug = si.supplier_slug
          AND ts.tenant_id = $1
          AND ts.is_active = true
        WHERE si.is_active = true AND si.type = 'EXPERIENCE'
          AND si.category IS NOT NULL AND si.category != ''
        GROUP BY si.category, si.supplier_slug
        ORDER BY count DESC`,
      [tid]
    )).rows;
    const byCategory = new Map();
    for (const row of categoryBreakdown) {
      if (!byCategory.has(row.category)) byCategory.set(row.category, { category: row.category, total: 0, by_supplier: [] });
      const bucket = byCategory.get(row.category);
      bucket.total += row.count;
      bucket.by_supplier.push({ supplier_slug: row.supplier_slug, count: row.count });
    }
    const experienceCategories = Array.from(byCategory.values()).sort((a, b) => b.total - a.total);

    res.json({
      suppliers,
      transactions: {
        total_24h: txnAgg.total_24h,
        success_rate_pct: Number(txnAgg.success_rate_pct),
        avg_latency_ms: txnAgg.avg_latency_ms,
        volume_by_hour: volumeByHour.map(v => ({
          hour: v.hour, count: v.count, errors: v.errors,
        })),
      },
      agent_sessions: sessions,
      escalations: esc,
      dedup,
      embedding_coverage: {
        total: embeddingStats.total,
        with_embedding: embeddingStats.with_embedding,
        without_embedding: embeddingStats.without_embedding,
        pct: embeddingStats.total > 0
          ? Math.round((embeddingStats.with_embedding / embeddingStats.total) * 1000) / 10
          : 0,
        by_supplier: embeddingBySupplier.map((r2) => ({
          supplier_slug: r2.supplier_slug,
          total: r2.total,
          with_embedding: r2.with_embedding,
          pct: r2.total > 0 ? Math.round((r2.with_embedding / r2.total) * 1000) / 10 : 0,
        })),
      },
      last_import_job: lastImportJob,
      sync_status_by_supplier: syncRows,
      content_by_type: contentByType,
      experience_categories: experienceCategories,
    });
  });

  // ---- Suppliers (Layer 6) ----
  p.get('/v1/dashboard/suppliers', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const rows = (await query(
      `SELECT ts.supplier_slug, s.name, s.categories, ts.sla_tier, ts.activated_at,
              ts.is_active, s.auth_type
         FROM hub_tenant_suppliers ts
         JOIN hub_suppliers s ON s.supplier_slug = ts.supplier_slug
        WHERE ts.tenant_id = $1`,
      [tid]
    )).rows;
    const integrations = await Promise.all(rows.map(async (row) => {
      const lastTest = (await query(
        `SELECT last_run_at, last_run_status
           FROM hub_integration_tests
          WHERE tenant_id = $1 AND supplier_slug = $2
          ORDER BY last_run_at DESC NULLS LAST LIMIT 1`,
        [tid, row.supplier_slug]
      )).rows[0];
      const invCount = (await query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_active)::int AS active
         FROM hub_static_inventory WHERE supplier_slug = $1`,
        [row.supplier_slug]
      )).rows[0];
      return {
        supplier_slug: row.supplier_slug,
        name: row.name,
        categories: row.categories,
        status: row.is_active ? 'UP' : 'DISABLED',
        is_active: row.is_active,
        sla_tier: row.sla_tier,
        operations: ['search', 'book', 'cancel', 'get'],
        last_test_run: lastTest ? {
          status: lastTest.last_run_status || 'UNKNOWN',
          ran_at: lastTest.last_run_at,
          steps_passed: lastTest.last_run_status === 'PASS' ? 6 : 0,
          steps_total: 6,
        } : null,
        credential_rotation_due: null,
        activated_at: row.activated_at,
        inventory_total: invCount?.total || 0,
        inventory_active: invCount?.active || 0,
      };
    }));
    res.json({ integrations });
  });

  p.post('/v1/dashboard/suppliers/:slug/toggle', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const slug = req.params.slug;
    const { enable } = req.body || {};

    const existing = (await query(
      `SELECT is_active FROM hub_tenant_suppliers WHERE tenant_id = $1 AND supplier_slug = $2`,
      [tid, slug]
    )).rows[0];
    if (!existing) return res.status(404).json({ error: 'supplier not found' });

    const newState = enable !== undefined ? !!enable : !existing.is_active;

    await query(
      `UPDATE hub_tenant_suppliers SET is_active = $3 WHERE tenant_id = $1 AND supplier_slug = $2`,
      [tid, slug, newState]
    );

    const invResult = await query(
      `UPDATE hub_static_inventory SET is_active = $2 WHERE supplier_slug = $1 RETURNING id`,
      [slug, newState]
    );

    res.json({
      supplier_slug: slug,
      is_active: newState,
      inventory_updated: invResult.rowCount,
    });
  });

  p.post('/v1/dashboard/suppliers/:slug/test', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const slug = req.params.slug;
    const exists = (await query(
      `SELECT 1 FROM hub_tenant_suppliers WHERE tenant_id = $1 AND supplier_slug = $2`,
      [tid, slug]
    )).rows[0];
    if (!exists) return res.status(404).json({ error: 'supplier not integrated' });

    const manifest = await resolveSupplierManifest(tid, slug);
    if (!manifest) {
      return res.status(400).json({ error: 'no manifest available for this supplier; re-run onboarding wizard' });
    }

    const session_id = randomUUID();
    await query(
      `INSERT INTO agent_sessions(session_id, tenant_id, task_type, status, checkpoint)
       VALUES ($1, $2, 'INTEGRATION_TEST', 'IN_PROGRESS', $3::jsonb)`,
      [session_id, tid, JSON.stringify({ supplier_slug: slug })]
    );

    let report;
    try {
      report = await runSandboxValidation(manifest);
    } catch (e) {
      report = { passed: false, steps: [], failure_report: `VALIDATION_ERROR: ${e.message}` };
    }
    const status = report.passed ? 'PASS' : 'FAIL';

    await query(
      `INSERT INTO hub_integration_tests
         (supplier_slug, tenant_id, search_params, expected_min_count, last_run_at, last_run_status)
       VALUES ($1, $2, $3::jsonb, $4, now(), $5)`,
      [
        slug, tid,
        JSON.stringify(manifest.test_suite?.sandbox_search_params || {}),
        manifest.test_suite?.expected_result_count_min || 1,
        status,
      ]
    );
    await query(
      `UPDATE agent_sessions SET status = $1, checkpoint = $2::jsonb WHERE session_id = $3`,
      [report.passed ? 'COMPLETED' : 'FAILED', JSON.stringify({ supplier_slug: slug, report }), session_id]
    );

    res.json({ session_id, status, report });
  });

  p.get('/v1/dashboard/suppliers/:slug/tests', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const slug = req.params.slug;
    const rows = (await query(
      `SELECT id, last_run_at, last_run_status, search_params, expected_min_count
         FROM hub_integration_tests
        WHERE tenant_id = $1 AND supplier_slug = $2
        ORDER BY last_run_at DESC NULLS LAST
        LIMIT 25`,
      [tid, slug]
    )).rows;
    const sessions = (await query(
      `SELECT session_id, status, checkpoint, created_at
         FROM agent_sessions
        WHERE tenant_id = $1
          AND task_type = 'INTEGRATION_TEST'
          AND checkpoint->>'supplier_slug' = $2
        ORDER BY created_at DESC
        LIMIT 25`,
      [tid, slug]
    )).rows;
    res.json({
      tests: rows.map((r) => {
        const session = sessions.find((s) =>
          s.checkpoint?.report &&
          Math.abs(new Date(s.created_at).getTime() - new Date(r.last_run_at).getTime()) < 60000
        );
        return {
          id: r.id,
          ran_at: r.last_run_at,
          status: r.last_run_status,
          search_params: r.search_params,
          expected_min_count: r.expected_min_count,
          report: session?.checkpoint?.report || null,
          session_id: session?.session_id || null,
        };
      }),
    });
  });

  // ---- Inventory (Section 7B) ----
  p.get('/v1/dashboard/inventory', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const { type, supplier_slug, city, category } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const activeSlugs = (await query(
      `SELECT supplier_slug FROM hub_tenant_suppliers
        WHERE tenant_id = $1 AND is_active = true`,
      [tid]
    )).rows.map((r) => r.supplier_slug);

    if (activeSlugs.length === 0) {
      return res.json({ records: [], total: 0, page, pages: 1, sync_summary: null, sync_status_by_supplier: [] });
    }

    const where = ['supplier_slug = ANY($1)'];
    const params = [activeSlugs];
    if (type)          { params.push(type);          where.push(`type = $${params.length}`); }
    if (supplier_slug) { params.push(supplier_slug); where.push(`supplier_slug = $${params.length}`); }
    if (city)          { params.push(`%${city}%`);   where.push(`city ILIKE $${params.length}`); }
    if (category)      { params.push(category);      where.push(`category = $${params.length}`); }
    const whereSQL = `WHERE ${where.join(' AND ')}`;

    const totalRow = (await query(
      `SELECT COUNT(*)::int AS total FROM hub_static_inventory ${whereSQL}`,
      params
    )).rows[0];
    const offset = (page - 1) * limit;
    const listParams = [...params, limit, offset];
    const records = (await query(
      `SELECT id, supplier_slug, supplier_raw_ref, type, title, city, country,
              latitude, longitude, category, star_rating, duration_minutes,
              is_active, last_synced_at
         FROM hub_static_inventory ${whereSQL}
        ORDER BY last_synced_at DESC NULLS LAST, title ASC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    )).rows;

    const syncStatus = (await query(
      `SELECT supplier_slug,
              COUNT(*) FILTER (WHERE is_active = true)::int AS records_active,
              COUNT(*) FILTER (WHERE is_active = false)::int AS records_inactive,
              MAX(last_synced_at) AS last_synced_at
         FROM hub_static_inventory
        WHERE supplier_slug = ANY($1)
     GROUP BY supplier_slug`,
      [activeSlugs]
    )).rows;

    const lastJob = (await query(
      `SELECT supplier_slug, status, started_at, completed_at, records_upserted,
              records_deactivated, records_errored
         FROM hub_sync_jobs
        WHERE supplier_slug = ANY($1)
        ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [activeSlugs]
    )).rows[0] || null;

    const pages = Math.max(1, Math.ceil(totalRow.total / limit));
    res.json({
      records,
      total: totalRow.total,
      page, pages,
      sync_summary: lastJob ? {
        last_run: lastJob.started_at,
        completed_at: lastJob.completed_at,
        status: lastJob.status,
        supplier_slug: lastJob.supplier_slug,
        records_active: syncStatus.reduce((s, r) => s + r.records_active, 0),
        records_inactive: syncStatus.reduce((s, r) => s + r.records_inactive, 0),
      } : null,
      sync_status_by_supplier: syncStatus,
    });
  });

  p.get('/v1/dashboard/inventory/sync-history', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const activeSlugs = (await query(
      `SELECT supplier_slug FROM hub_tenant_suppliers
        WHERE tenant_id = $1 AND is_active = true`,
      [tid]
    )).rows.map((r) => r.supplier_slug);
    if (activeSlugs.length === 0) return res.json({ jobs: [] });
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const jobs = (await query(
      `SELECT id, supplier_slug, status, records_fetched, records_upserted,
              records_deactivated, records_errored, started_at, completed_at, error_message
         FROM hub_sync_jobs
        WHERE supplier_slug = ANY($1)
        ORDER BY started_at DESC NULLS LAST
        LIMIT $2`,
      [activeSlugs, limit]
    )).rows;
    res.json({ jobs });
  });

  p.get('/v1/dashboard/sync/status', jwtAuth, async (req, res) => {
    try {
      const tid = tenantId(req);
      const activeSlugs = (await query(
        `SELECT supplier_slug FROM hub_tenant_suppliers
          WHERE tenant_id = $1 AND is_active = true`,
        [tid]
      )).rows.map((r) => r.supplier_slug);
      if (activeSlugs.length === 0) return res.json({ by_supplier: {} });
      const { rows } = await query(
        `SELECT DISTINCT ON (supplier_slug)
                supplier_slug, status, records_fetched, records_upserted,
                records_deactivated, records_errored, started_at, completed_at, error_message
           FROM hub_sync_jobs
          WHERE supplier_slug = ANY($1)
          ORDER BY supplier_slug, started_at DESC`,
        [activeSlugs]
      );
      const by_supplier = {};
      for (const r of rows) by_supplier[r.supplier_slug] = r;
      res.json({ by_supplier });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Inventory growth (30-day trend) ----
  p.get('/v1/dashboard/inventory/growth', jwtAuth, async (req, res) => {
    try {
      const tid = tenantId(req);
      const { supplier_slug: filterSlug } = req.query;
      const activeSlugs = (await query(
        `SELECT supplier_slug FROM hub_tenant_suppliers
          WHERE tenant_id = $1 AND is_active = true`,
        [tid]
      )).rows.map((r2) => r2.supplier_slug);
      if (activeSlugs.length === 0) return res.json({ days: [], experience_suppliers: [] });

      const slugs = filterSlug ? [filterSlug].filter((s) => activeSlugs.includes(s)) : activeSlugs;
      if (slugs.length === 0) return res.json({ days: [], experience_suppliers: [] });

      const { rows: baselines } = await query(
        `SELECT type, COUNT(*)::int AS cnt
         FROM hub_static_inventory
         WHERE supplier_slug = ANY($1) AND is_active = true
           AND created_at < now() - interval '30 days'
         GROUP BY type`,
        [slugs]
      );
      const baseByType = {};
      for (const r2 of baselines) baseByType[r2.type] = r2.cnt;

      const { rows: deltas } = await query(
        `SELECT date_trunc('day', created_at)::date AS day,
                type,
                COUNT(*)::int AS added
         FROM hub_static_inventory
         WHERE supplier_slug = ANY($1) AND is_active = true
           AND created_at >= now() - interval '30 days'
         GROUP BY day, type
         ORDER BY day`,
        [slugs]
      );

      const dayMap = new Map();
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dayMap.set(key, { day: key, EXPERIENCE: 0, HOTEL: 0, TRANSFER: 0 });
      }
      for (const r2 of deltas) {
        const key = typeof r2.day === 'string' ? r2.day.slice(0, 10) : new Date(r2.day).toISOString().slice(0, 10);
        if (dayMap.has(key)) dayMap.get(key)[r2.type] = (dayMap.get(key)[r2.type] || 0) + r2.added;
      }

      const days = [];
      const running = { EXPERIENCE: baseByType.EXPERIENCE || 0, HOTEL: baseByType.HOTEL || 0, TRANSFER: baseByType.TRANSFER || 0 };
      for (const entry of dayMap.values()) {
        running.EXPERIENCE += entry.EXPERIENCE;
        running.HOTEL += entry.HOTEL;
        running.TRANSFER += entry.TRANSFER;
        days.push({
          day: entry.day,
          total: running.EXPERIENCE + running.HOTEL + running.TRANSFER,
          experiences: running.EXPERIENCE,
          hotels: running.HOTEL,
          transfers: running.TRANSFER,
        });
      }

      const expSuppliers = (await query(
        `SELECT si.supplier_slug, COUNT(*)::int AS cnt
         FROM hub_static_inventory si
         JOIN hub_tenant_suppliers ts
           ON ts.supplier_slug = si.supplier_slug AND ts.tenant_id = $1 AND ts.is_active = true
         WHERE si.is_active = true AND si.type = 'EXPERIENCE'
         GROUP BY si.supplier_slug
         ORDER BY cnt DESC`,
        [tid]
      )).rows;

      res.json({ days, experience_suppliers: expSuppliers });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Transactions (Layer 7) ----
  p.get('/v1/dashboard/transactions', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const { supplier_slug, operation, status, from_date, to_date } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const where = ['tenant_id = $1'];
    const params = [tid];
    if (supplier_slug) { params.push(supplier_slug); where.push(`supplier_slug = $${params.length}`); }
    if (operation)     { params.push(operation);     where.push(`operation = $${params.length}`); }
    if (status)        { params.push(status);        where.push(`status = $${params.length}`); }
    if (from_date)     { params.push(from_date);     where.push(`created_at >= $${params.length}`); }
    if (to_date)       { params.push(to_date);       where.push(`created_at <= $${params.length}`); }
    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const totalRow = (await query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(ROUND(((COUNT(*) FILTER (WHERE status='SUCCESS'))::numeric
                / NULLIF(COUNT(*),0)::numeric) * 100, 2), 0) AS success_rate_pct,
              COALESCE(AVG(latency_ms),0)::int AS avg_latency_ms
         FROM hub_transactions ${whereSQL}`,
      params
    )).rows[0];
    const offset = (page - 1) * limit;
    const listParams = [...params, limit, offset];
    const rows = (await query(
      `SELECT txn_id, supplier_slug, operation, status, latency_ms, source, created_at,
              request_hash, response_hash, error_message
         FROM hub_transactions ${whereSQL}
        ORDER BY created_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    )).rows;
    const pages = Math.max(1, Math.ceil(totalRow.total / limit));
    res.json({
      transactions: rows,
      total: totalRow.total,
      page,
      pages,
      summary: {
        success_rate_pct: Number(totalRow.success_rate_pct),
        avg_latency_ms: totalRow.avg_latency_ms,
      },
    });
  });

  // ---- Intelligence (Layer 8) ----
  p.get('/v1/dashboard/dedup-config', jwtAuth, async (req, res) => {
    const row = (await query(
      `SELECT id, config_json, label, test_mode, updated_at
         FROM hub_dedup_config
        WHERE tenant_id = $1 AND is_active = true
        ORDER BY updated_at DESC LIMIT 1`,
      [tenantId(req)]
    )).rows[0];
    res.json(row || { config_json: null, test_mode: false });
  });

  p.patch('/v1/dashboard/dedup-config', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const { config_json, test_mode, label } = req.body || {};
    const existing = (await query(
      `SELECT id FROM hub_dedup_config WHERE tenant_id = $1 AND is_active = true
        ORDER BY updated_at DESC LIMIT 1`,
      [tid]
    )).rows[0];
    if (existing) {
      const row = (await query(
        `UPDATE hub_dedup_config
            SET config_json = COALESCE($1::jsonb, config_json),
                test_mode = COALESCE($2, test_mode),
                label = COALESCE($3, label),
                updated_at = now()
          WHERE id = $4
          RETURNING id, config_json, label, test_mode, updated_at`,
        [config_json ? JSON.stringify(config_json) : null, test_mode, label, existing.id]
      )).rows[0];
      return res.json(row);
    }
    const row = (await query(
      `INSERT INTO hub_dedup_config(tenant_id, config_json, label, test_mode)
       VALUES ($1, $2::jsonb, $3, $4)
       RETURNING id, config_json, label, test_mode, updated_at`,
      [tid, JSON.stringify(config_json || {}), label || 'default', !!test_mode]
    )).rows[0];
    res.json(row);
  });

  p.get('/v1/dashboard/dedup-clusters', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const { city, supplier_slug } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const activeSlugs = (await query(
      `SELECT supplier_slug FROM hub_tenant_suppliers
        WHERE tenant_id = $1 AND is_active = true`, [tid]
    )).rows.map(r2 => r2.supplier_slug);
    if (activeSlugs.length === 0)
      return res.json({ clusters: [], total: 0, page, pages: 1, summary: {} });

    const where = ['si.supplier_slug = ANY($1)', 'si.is_active = true', 'si.canonical_id IS NOT NULL'];
    const params = [activeSlugs];
    if (city) { params.push(`%${city}%`); where.push(`si.city ILIKE $${params.length}`); }
    if (supplier_slug) { params.push(supplier_slug); where.push(`si.supplier_slug = $${params.length}`); }
    const whereSQL = where.join(' AND ');

    const summary = (await query(`
      SELECT COUNT(DISTINCT si.canonical_id)::int AS total_clusters,
             COUNT(*)::int AS total_duplicates,
             (SELECT COUNT(*)::int FROM hub_static_inventory
               WHERE supplier_slug = ANY($1) AND is_active = true AND canonical_id IS NULL
                 AND type = 'EXPERIENCE') AS total_unique
      FROM hub_static_inventory si WHERE ${whereSQL}`, params
    )).rows[0];

    const totalClusters = summary.total_clusters;
    const offset = (page - 1) * limit;
    const clusterParams = [...params, limit, offset];
    const clusterIds = (await query(`
      SELECT si.canonical_id, COUNT(*)::int AS dup_count
      FROM hub_static_inventory si WHERE ${whereSQL}
      GROUP BY si.canonical_id
      ORDER BY COUNT(*) DESC
      LIMIT $${clusterParams.length - 1} OFFSET $${clusterParams.length}`,
      clusterParams
    )).rows;

    const clusters = [];
    for (const { canonical_id, dup_count } of clusterIds) {
      const canonical = (await query(
        `SELECT id, title, supplier_slug, city, category, duration_minutes, image_urls,
                description, price_from, price_currency, rating, review_count, latitude, longitude
         FROM hub_static_inventory WHERE id = $1`, [canonical_id]
      )).rows[0];
      const duplicates = (await query(
        `SELECT id, title, supplier_slug, city, category, duration_minutes,
                description, price_from, price_currency, rating, review_count, image_urls, latitude, longitude
         FROM hub_static_inventory WHERE canonical_id = $1 AND is_active = true
         ORDER BY supplier_slug, title`, [canonical_id]
      )).rows;
      clusters.push({ canonical, duplicates, dup_count });
    }

    const cities = (await query(`
      SELECT DISTINCT si.city FROM hub_static_inventory si
      WHERE si.supplier_slug = ANY($1) AND si.is_active = true AND si.canonical_id IS NOT NULL
        AND si.city IS NOT NULL
      ORDER BY si.city`, [activeSlugs]
    )).rows.map(r2 => r2.city);

    res.json({
      clusters,
      total: totalClusters,
      page,
      pages: Math.max(1, Math.ceil(totalClusters / limit)),
      summary: {
        total_clusters: summary.total_clusters,
        total_duplicates: summary.total_duplicates,
        total_unique: summary.total_unique,
      },
      cities,
    });
  });

  // ---- Dedup Review (precision measurement) ----

  p.get('/v1/dashboard/dedup-review/sample', jwtAuth, async (req, res) => {
    try {
      const tid = tenantId(req);
      const sampleSize = Math.min(50, Math.max(5, parseInt(req.query.sample_size, 10) || 50));
      const activeSlugs = (await query(
        `SELECT supplier_slug FROM hub_tenant_suppliers
          WHERE tenant_id = $1 AND is_active = true`, [tid]
      )).rows.map(r2 => r2.supplier_slug);
      if (activeSlugs.length === 0) return res.json({ clusters: [], stats: {} });

      // Sample across cluster size bands for balanced coverage
      const bands = [
        { label: '2', min: 1, max: 2, take: Math.ceil(sampleSize * 0.3) },
        { label: '3-4', min: 3, max: 4, take: Math.ceil(sampleSize * 0.3) },
        { label: '5-7', min: 5, max: 7, take: Math.ceil(sampleSize * 0.2) },
        { label: '8+', min: 8, max: 999, take: Math.ceil(sampleSize * 0.2) },
      ];

      // Exclude already-reviewed clusters
      const reviewed = (await query(
        `SELECT canonical_id FROM hub_dedup_reviews`
      )).rows.map(r2 => r2.canonical_id);

      const clusters = [];
      for (const band of bands) {
        const excludeClause = reviewed.length > 0
          ? `AND sub.canonical_id != ALL($3)` : '';
        const params = [activeSlugs, band.take];
        if (reviewed.length > 0) params.push(reviewed);

        const ids = (await query(`
          SELECT sub.canonical_id, sub.cluster_size FROM (
            SELECT canonical_id, COUNT(*)::int AS cluster_size
            FROM hub_static_inventory
            WHERE supplier_slug = ANY($1) AND is_active = true AND canonical_id IS NOT NULL
            GROUP BY canonical_id
          ) sub
          WHERE sub.cluster_size >= ${band.min} AND sub.cluster_size <= ${band.max}
            ${excludeClause}
          ORDER BY random()
          LIMIT $2
        `, params)).rows;

        for (const { canonical_id, cluster_size } of ids) {
          const canonical = (await query(
            `SELECT id, title, supplier_slug, city, category, duration_minutes, description, image_urls,
                    price_from, price_currency, rating, review_count, raw_content
             FROM hub_static_inventory WHERE id = $1`, [canonical_id]
          )).rows[0];
          const duplicates = (await query(
            `SELECT id, title, supplier_slug, city, category, duration_minutes, description,
                    price_from, price_currency, rating, review_count, raw_content
             FROM hub_static_inventory WHERE canonical_id = $1 AND is_active = true
             ORDER BY supplier_slug, title`, [canonical_id]
          )).rows;
          // Extract useful display hints from raw_content for items without descriptions
          const enrich = (item) => {
            const rc = item.raw_content || {};
            item.modality = rc.modalities?.[0]?.name || null;
            item.pax_range = rc.paxRange || null;
            item.destination_code = rc.destination || null;
            item.supplier_code = rc.code || rc.uuid || rc.external_id || null;
            delete item.raw_content;
            return item;
          };
          enrich(canonical);
          duplicates.forEach(enrich);
          clusters.push({
            canonical,
            duplicates,
            cluster_size,
            band: band.label,
          });
        }
      }

      // Stats: reviewed so far
      const reviewStats = (await query(`
        SELECT verdict, COUNT(*)::int AS count FROM hub_dedup_reviews GROUP BY verdict
      `)).rows;
      const totalReviewed = reviewStats.reduce((s, r2) => s + r2.count, 0);
      const correct = reviewStats.find(r2 => r2.verdict === 'CORRECT')?.count || 0;
      const wrong = reviewStats.find(r2 => r2.verdict === 'WRONG')?.count || 0;
      const partial = reviewStats.find(r2 => r2.verdict === 'PARTIAL')?.count || 0;

      res.json({
        clusters,
        stats: {
          total_reviewed: totalReviewed,
          correct,
          wrong,
          partial,
          precision: totalReviewed > 0 ? ((correct + partial * 0.5) / totalReviewed * 100).toFixed(1) : null,
          remaining: clusters.length,
        },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/dedup-review', jwtAuth, async (req, res) => {
    try {
      const { canonical_id, verdict, wrong_ids, notes, cluster_size } = req.body;
      if (!canonical_id || !verdict) {
        return res.status(400).json({ error: 'canonical_id and verdict required' });
      }
      await query(
        `INSERT INTO hub_dedup_reviews(canonical_id, verdict, wrong_ids, notes, cluster_size)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [canonical_id, verdict, wrong_ids || null, notes || null, cluster_size || null]
      );
      // Return updated stats
      const reviewStats = (await query(`
        SELECT verdict, COUNT(*)::int AS count FROM hub_dedup_reviews GROUP BY verdict
      `)).rows;
      const totalReviewed = reviewStats.reduce((s, r2) => s + r2.count, 0);
      const correct = reviewStats.find(r2 => r2.verdict === 'CORRECT')?.count || 0;
      const wrong = reviewStats.find(r2 => r2.verdict === 'WRONG')?.count || 0;
      const partial = reviewStats.find(r2 => r2.verdict === 'PARTIAL')?.count || 0;
      res.json({
        saved: true,
        stats: {
          total_reviewed: totalReviewed,
          correct,
          wrong,
          partial,
          precision: totalReviewed > 0 ? ((correct + partial * 0.5) / totalReviewed * 100).toFixed(1) : null,
        },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.get('/v1/dashboard/dedup-review/stats', jwtAuth, async (req, res) => {
    try {
      const reviewStats = (await query(`
        SELECT verdict, COUNT(*)::int AS count FROM hub_dedup_reviews GROUP BY verdict
      `)).rows;
      const totalReviewed = reviewStats.reduce((s, r2) => s + r2.count, 0);
      const correct = reviewStats.find(r2 => r2.verdict === 'CORRECT')?.count || 0;
      const wrong = reviewStats.find(r2 => r2.verdict === 'WRONG')?.count || 0;
      const partial = reviewStats.find(r2 => r2.verdict === 'PARTIAL')?.count || 0;

      // Per-band stats
      const byBand = (await query(`
        SELECT cluster_size,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE verdict = 'CORRECT')::int AS correct,
          COUNT(*) FILTER (WHERE verdict = 'WRONG')::int AS wrong,
          COUNT(*) FILTER (WHERE verdict = 'PARTIAL')::int AS partial
        FROM hub_dedup_reviews
        WHERE cluster_size IS NOT NULL
        GROUP BY cluster_size
        ORDER BY cluster_size
      `)).rows;

      res.json({
        total_reviewed: totalReviewed,
        correct, wrong, partial,
        precision: totalReviewed > 0 ? ((correct + partial * 0.5) / totalReviewed * 100).toFixed(1) : null,
        by_cluster_size: byBand,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.get('/v1/dashboard/dedup-log', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const { decision } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const where = ['tenant_id = $1'];
    const params = [tid];
    if (decision) { params.push(decision); where.push(`decision = $${params.length}`); }
    const totalRow = (await query(
      `SELECT COUNT(*)::int AS total FROM hub_dedup_test_log WHERE ${where.join(' AND ')}`,
      params
    )).rows[0];
    const offset = (page - 1) * limit;
    const listParams = [...params, limit, offset];
    const rows = (await query(
      `SELECT id, option_id_a, option_id_b,
              signal_location, signal_name, signal_duration, signal_category,
              composite_score, decision, strategy_applied, agent_reasoning, created_at
         FROM hub_dedup_test_log WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    )).rows;
    res.json({ decisions: rows, total: totalRow.total, page, pages: Math.max(1, Math.ceil(totalRow.total/limit)) });
  });

  p.get('/v1/dashboard/escalations', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const { status } = req.query;
    const where = ['tenant_id = $1'];
    const params = [tid];
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    const rows = (await query(
      `SELECT id, prompt_key, status, trigger_data, created_at, expires_at, resolved_at
         FROM hub_escalations WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC LIMIT 100`,
      params
    )).rows;
    res.json({ escalations: rows });
  });

  p.get('/v1/dashboard/prompts', jwtAuth, async (_req, res) => {
    const rows = (await query(
      `SELECT id, prompt_key, category, trigger_condition, prompt_template,
              escalate_to_human, is_active, version
         FROM hub_prompts ORDER BY category, prompt_key`
    )).rows;
    res.json({ prompts: rows });
  });

  p.patch('/v1/dashboard/prompts/:id', jwtAuth, async (req, res) => {
    const { is_active } = req.body || {};
    const row = (await query(
      `UPDATE hub_prompts SET is_active = COALESCE($1, is_active), updated_at = now()
        WHERE id = $2 RETURNING id, prompt_key, is_active`,
      [typeof is_active === 'boolean' ? is_active : null, req.params.id]
    )).rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  });

  // ---- Settings (Layer 9) ----
  p.get('/v1/dashboard/settings', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const t = (await query(
      `SELECT tenant_id, name, tier, email, notification_email, api_key_preview
         FROM hub_tenants WHERE tenant_id = $1`,
      [tid]
    )).rows[0];
    const webhooks = (await query(
      `SELECT id, event_type, endpoint_url, is_active
         FROM hub_webhooks WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tid]
    )).rows;
    const jwt = req.dashboardTenant || {};
    res.json({
      user_name: jwt.user_name || null,
      role: jwt.role || 'admin',
      tenant_name: t.name,
      tier: t.tier,
      email: jwt.email || t.email,
      notification_email: t.notification_email,
      api_key_preview: t.api_key_preview ? `****${t.api_key_preview}` : null,
      webhooks,
    });
  });

  p.post('/v1/dashboard/settings/rotate-key', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const newKey = randomBytes(24).toString('hex');
    const hash = await bcrypt.hash(newKey, 8);
    const preview = newKey.slice(-4);
    await query(
      `UPDATE hub_tenants SET api_key_hash = $1, api_key_preview = $2 WHERE tenant_id = $3`,
      [hash, preview, tid]
    );
    res.json({ new_api_key: newKey, warning: 'This key is shown only once. Store it securely.' });
  });

  p.post('/v1/dashboard/settings/webhooks', jwtAuth, async (req, res) => {
    const tid = tenantId(req);
    const { event_type, endpoint_url } = req.body || {};
    if (!event_type || !endpoint_url)
      return res.status(400).json({ error: 'event_type and endpoint_url required' });
    const secret = randomBytes(16).toString('hex');
    const secret_hash = createHash('sha256').update(secret).digest('hex');
    const row = (await query(
      `INSERT INTO hub_webhooks(tenant_id, event_type, endpoint_url, secret_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_type, endpoint_url, is_active`,
      [tid, event_type, endpoint_url, secret_hash]
    )).rows[0];
    res.json({ ...row, secret, warning: 'Secret shown once.' });
  });

  p.delete('/v1/dashboard/settings/webhooks/:id', jwtAuth, async (req, res) => {
    const row = await query(
      `DELETE FROM hub_webhooks WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, tenantId(req)]
    );
    if (!row.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: row.rows[0].id });
  });

  p.patch('/v1/dashboard/settings/notification-email', jwtAuth, async (req, res) => {
    const { notification_email } = req.body || {};
    await query(
      `UPDATE hub_tenants SET notification_email = $1 WHERE tenant_id = $2`,
      [notification_email, tenantId(req)]
    );
    res.json({ notification_email });
  });

  // -------- Onboarding (JWT) --------
  p.post('/v1/dashboard/onboard/analyze-name', jwtAuth, async (req, res) => {
    try {
      const { name } = req.body || {};
      if (!name || name.trim().length < 2) return res.status(400).json({ error: 'supplier name required (min 2 chars)' });
      const { context7Resolve, context7Query, cleanContext7Text, CONTEXT7_API_QUERY, analyzeDocs: analyze } = await import('../onboarding/analyzer.js');
      const trimmed = name.trim();

      // Step 1: Context7 for structured API docs (fast, high-quality when available)
      let context7Docs = null;
      let libraryId = null;
      try {
        libraryId = await context7Resolve(trimmed);
        if (libraryId) {
          const raw = await context7Query(libraryId, CONTEXT7_API_QUERY);
          if (raw) context7Docs = cleanContext7Text(raw);
        }
      } catch { /* continue without context7 */ }

      // Step 2: Try the supplier's actual developer docs site
      const docsCandidates = [
        `https://developer.${trimmed.toLowerCase().replace(/\s+/g, '')}.com`,
        `https://docs.${trimmed.toLowerCase().replace(/\s+/g, '')}.com`,
        `https://api.${trimmed.toLowerCase().replace(/\s+/g, '')}.com`,
        `https://${trimmed.toLowerCase().replace(/\s+/g, '')}.readme.io`,
      ];
      let liveDocsUrl = null;
      for (const candidate of docsCandidates) {
        try {
          const r = await axios.get(candidate, { timeout: 5000, validateStatus: s => s < 400, maxRedirects: 3 });
          if (r.status < 400) { liveDocsUrl = candidate; break; }
        } catch { /* next candidate */ }
      }

      // Step 3: Combine sources — context7 as base, live docs to fill gaps
      if (context7Docs && liveDocsUrl) {
        const liveResult = await analyze({ url: liveDocsUrl, context7Text: context7Docs, supplierNameHint: trimmed });
        return res.json({ ...liveResult, context7_library: libraryId, docs_url: liveDocsUrl });
      }
      if (context7Docs) {
        const result = await analyze({ url: `context7://${libraryId}`, context7Text: context7Docs, supplierNameHint: trimmed });
        return res.json({ ...result, context7_library: libraryId });
      }
      if (liveDocsUrl) {
        const result = await analyze({ url: liveDocsUrl, supplierNameHint: trimmed });
        return res.json({ ...result, docs_url: liveDocsUrl });
      }
      res.json({ ok: false, message: `No documentation found for "${trimmed}". You can paste a docs URL manually.` });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/onboard/analyze-docs', jwtAuth, async (req, res) => {
    try {
      const { url } = req.body || {};
      const result = await analyzeDocs({ url });
      res.json(result);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/onboard', jwtAuth, async (req, res) => {
    try {
      const tid = tenantId(req);
      const manifest = req.body?.manifest || req.body || {};
      if (manifest.tenant_config) manifest.tenant_config.tenant_id = tid;
      const v = validateManifest(manifest, { partial: true });
      const r2 = await query(
        `INSERT INTO hub_onboarding_sessions(tenant_id, path, status, manifest_json)
         VALUES ($1, 'API', 'IN_PROGRESS', $2) RETURNING session_id`,
        [tid, manifest]
      );
      res.json({ session_id: r2.rows[0].session_id, validation_hint: v.errors || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/onboard/from-existing/:slug', jwtAuth, async (req, res) => {
    try {
      const tid = tenantId(req);
      const slug = req.params.slug;
      const owned = await query(
        `SELECT 1 FROM hub_tenant_suppliers WHERE tenant_id = $1 AND supplier_slug = $2`,
        [tid, slug]
      );
      if (!owned.rows[0]) return res.status(404).json({ error: 'integration not found for tenant' });
      const prior = await query(
        `SELECT manifest_json FROM hub_onboarding_sessions
         WHERE tenant_id = $1 AND manifest_json->'supplier'->>'slug' = $2
         ORDER BY updated_at DESC LIMIT 1`,
        [tid, slug]
      );
      if (!prior.rows[0]?.manifest_json) {
        return res.status(404).json({ error: 'no prior onboarding session — manifest cannot be reconstructed' });
      }
      const manifest = prior.rows[0].manifest_json;
      if (manifest.tenant_config) manifest.tenant_config.tenant_id = tid;
      const r2 = await query(
        `INSERT INTO hub_onboarding_sessions(tenant_id, path, status, manifest_json)
         VALUES ($1, 'API', 'IN_PROGRESS', $2) RETURNING session_id`,
        [tid, manifest]
      );
      res.json({ session_id: r2.rows[0].session_id, manifest });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.get('/v1/dashboard/onboard/:id', jwtAuth, async (req, res) => {
    try {
      const r2 = await query(
        `SELECT session_id, status, manifest_json AS manifest, validation_report
         FROM hub_onboarding_sessions WHERE session_id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId(req)]
      );
      if (!r2.rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(r2.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.patch('/v1/dashboard/onboard/:id/manifest', jwtAuth, async (req, res) => {
    try {
      const tid = tenantId(req);
      const manifest = req.body || {};
      if (manifest.tenant_config) manifest.tenant_config.tenant_id = tid;
      const r2 = await query(
        `UPDATE hub_onboarding_sessions SET manifest_json = $1, updated_at = now()
         WHERE session_id = $2 AND tenant_id = $3
         RETURNING session_id, manifest_json AS manifest`,
        [manifest, req.params.id, tid]
      );
      if (!r2.rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(r2.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/onboard/:id/auto-map', jwtAuth, async (req, res) => {
    try {
      const r = await query(
        `SELECT manifest_json FROM hub_onboarding_sessions
         WHERE session_id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId(req)]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
      let manifest = r.rows[0].manifest_json;
      // If frontend sent a fresh manifest via PATCH right before, the DB may still have stale data.
      // Accept credentials and type overrides from the request body.
      const credentials = req.body?.credentials || manifest?.auth?.credentials || {};
      let type = manifest?.cts_mapping?.type_value
        || req.body?.type_value
        || (manifest?.supplier?.categories?.length ? manifest.supplier.categories[0] : null);
      if (!type) return res.status(400).json({ error: 'cts_mapping.type_value missing — set CTS type first' });
      if (!manifest.cts_mapping) manifest.cts_mapping = {};
      manifest.cts_mapping.type_value = type;
      const result = await probeAndMatch({
        manifest,
        credentials,
        cts_targets: targetsForType(type),
      });
      if (result.sample) {
        manifest.test_suite = { ...manifest.test_suite, last_probe_sample: result.sample };
        await query(
          `UPDATE hub_onboarding_sessions SET manifest_json=$1, updated_at=now()
           WHERE session_id=$2 AND tenant_id=$3`,
          [manifest, req.params.id, tenantId(req)]
        );
      }
      res.json(result);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/onboard/:id/confirm', jwtAuth, async (req, res) => {
    try {
      const r2 = await query(
        `SELECT manifest_json FROM hub_onboarding_sessions
         WHERE session_id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId(req)]
      );
      if (!r2.rows[0]) return res.status(404).json({ error: 'not found' });
      const v = validateManifest(r2.rows[0].manifest_json);
      if (!v.ok) {
        await query(
          `UPDATE hub_onboarding_sessions SET status='FAILED', validation_report=$1, updated_at=now()
           WHERE session_id=$2`,
          [{ manifest_errors: v.errors }, req.params.id]
        );
        return res.status(400).json({ status: 'FAILED', manifest_errors: v.errors });
      }
      const mfst = r2.rows[0].manifest_json;
      const report = await runSandboxValidation(mfst);
      const status = report.passed ? 'VALIDATED' : 'FAILED';
      if (report.probe_sample || report.passed) {
        mfst.test_suite = {
          ...mfst.test_suite,
          last_probe_sample: report.probe_sample || null,
          last_validation_report: report,
        };
        await query(
          `UPDATE hub_onboarding_sessions SET status=$1, validation_report=$2, manifest_json=$3, updated_at=now()
           WHERE session_id=$4`,
          [status, report, mfst, req.params.id]
        );
      } else {
        await query(
          `UPDATE hub_onboarding_sessions SET status=$1, validation_report=$2, updated_at=now()
           WHERE session_id=$3`,
          [status, report, req.params.id]
        );
      }
      res.json({ status, report });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/onboard/:id/promote', jwtAuth, async (req, res) => {
    try {
      const tid = tenantId(req);
      const r2 = await query(
        `SELECT manifest_json, status FROM hub_onboarding_sessions
         WHERE session_id = $1 AND tenant_id = $2`,
        [req.params.id, tid]
      );
      if (!r2.rows[0]) return res.status(404).json({ error: 'not found' });
      if (r2.rows[0].status !== 'VALIDATED') {
        return res.status(400).json({ error: 'validation not passed' });
      }
      const result = await runProvisioning({ manifest: r2.rows[0].manifest_json, tenantId: tid });
      await query(
        `UPDATE hub_onboarding_sessions SET status='PROMOTED', promoted_at=now(), updated_at=now()
         WHERE session_id=$1`,
        [req.params.id]
      );
      res.json({ status: 'PROMOTED', provisioning: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- Lifecycle tester (per-inventory-row detail/availability/book/cancel) ----
  p.get('/v1/dashboard/lifecycle/suppliers', jwtAuth, (_req, res) => {
    res.json({ supported: supportedSuppliers() });
  });

  p.post('/v1/dashboard/lifecycle/:slug/:step', jwtAuth, async (req, res) => {
    try {
      const tid = tenantId(req);
      const { slug, step } = req.params;
      const { inventory_id, supplier_raw_ref, payload } = req.body || {};

      // Always load the inventory row (when an id is given) so the handler can
      // see raw_content and pick the right supplier-specific id. Some suppliers
      // (e.g. Bridgify) key detail calls off an internal uuid that is stored
      // inside raw_content, not off our stored supplier_raw_ref.
      // hub_static_inventory is shared across tenants — access is gated by
      // hub_tenant_suppliers (the tenant must have the supplier enabled).
      const tsRow = (await query(
        `SELECT 1 FROM hub_tenant_suppliers
          WHERE tenant_id = $1 AND supplier_slug = $2 AND is_active = true`,
        [tid, slug]
      )).rows[0];
      if (!tsRow) return res.status(403).json({ error: `tenant does not have supplier "${slug}" enabled` });

      let rawRef = supplier_raw_ref || null;
      let rawContent = null;
      if (inventory_id) {
        const r2 = await query(
          `SELECT supplier_raw_ref, raw_content FROM hub_static_inventory
            WHERE id = $1 AND supplier_slug = $2`,
          [inventory_id, slug]
        );
        if (!r2.rows[0]) return res.status(404).json({ error: 'inventory row not found for this supplier' });
        rawRef = rawRef || r2.rows[0].supplier_raw_ref;
        rawContent = r2.rows[0].raw_content || null;
      }
      if (!rawRef) return res.status(400).json({ error: 'inventory_id or supplier_raw_ref required' });

      const result = await runLifecycleStep({
        tenantId: tid,
        slug,
        step,
        rawRef,
        rawContent,
        payload: payload || {},
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/sync/trigger', jwtAuth, async (req, res) => {
    try {
      const { supplier } = req.body;
      const tid = tenantId(req);

      const syncMap = {
        bridgify: async (c) => syncBridgifyExperiences({ clientId: c.client_id, clientSecret: c.client_secret, baseUrl: c.base_url || process.env.BRIDGIFY_BASE_URL }),
        'hotelbeds-hotels': async (c) => syncHotelbedsHotels({ apiKey: c.api_key, secretKey: c.secret_key, env: c.env || process.env.HOTELBEDS_ENV || 'sandbox' }),
        'hotelbeds-activities': async (c) => syncHotelbedsExperiences({ apiKey: c.api_key, secretKey: c.secret_key, env: c.env || process.env.HOTELBEDS_ENV || 'sandbox' }),
        'hotelbeds-transfers': async (c) => syncHotelbedsTransfers({ apiKey: c.api_key, secretKey: c.secret_key, env: c.env || process.env.HOTELBEDS_ENV || 'sandbox' }),
        viator: async (c) => syncViatorExperiences({ apiKey: c.api_key, env: c.env || 'sandbox', supplierSlug: 'viator' }),
        'viator-direct': async (c) => syncViatorExperiences({ apiKey: c.api_key, env: c.env || 'sandbox', supplierSlug: 'viator-direct' }),
        ticketmaster: async (c) => syncTicketmasterEvents({ apiKey: c[Object.keys(c).find(k => c[k]) || 'api_key'], supplierSlug: 'ticketmaster' }),
        duffel: async (c) => syncDuffelFlights({ accessToken: c[Object.keys(c).find(k => c[k]) || 'access_token'], supplierSlug: 'duffel' }),
      };

      if (supplier && !syncMap[supplier]) {
        return res.status(400).json({ error: `Unknown supplier: ${supplier}` });
      }

      const targets = supplier ? [supplier] : Object.keys(syncMap);
      res.json({
        status: 'started',
        suppliers: targets,
        message: `Sync started for ${targets.join(', ')} — monitor progress in System > Jobs`,
      });

      for (const slug of targets) {
        runTracked(JOB_TYPES.SYNC, slug, async () => {
          const creds = await getSecret(tid, slug);
          if (!creds) throw new Error(`No credentials for ${slug}`);
          const fn = syncMap[slug];
          return fn(creds);
        }).catch(err => {
          console.error(JSON.stringify({ level: 'error', event: 'sync_failed', supplier: slug, error: err.message }));
        });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/enrich/activities', jwtAuth, async (req, res) => {
    try {
      const tid = req.user?.tenant_id || 't_demo';
      const limit = req.body?.limit || null;
      const creds =
        (await getSecret(tid, 'hotelbeds-activities')) ||
        (await getSecret(tid, 'hotelbeds'));
      if (!creds) return res.status(400).json({ error: 'No hotelbeds credentials configured' });
      res.json({ status: 'started', message: `Enriching HotelBeds activities descriptions in background${limit ? ` (limit: ${limit})` : ''} — check server logs` });
      enrichActivities({
        apiKey: creds.api_key,
        secretKey: creds.secret_key || creds.secret,
        env: creds.env || process.env.HOTELBEDS_ENV || 'sandbox',
        limit,
      }).then(result => {
        console.log(JSON.stringify({ level: 'info', event: 'enrich_activities_finished', ...result }));
      }).catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'enrich_activities_failed', error: err.message }));
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/embeddings/run', jwtAuth, async (req, res) => {
    try {
      const type = req.body?.type || 'EXPERIENCE';
      res.json({ status: 'started', message: `Embedding generation (${type}) running — monitor in Jobs tab` });
      runTracked(JOB_TYPES.EMBEDDINGS, 'embeddings', async (_jid, progress) => {
        return buildEmbeddings({ type, onProgress: progress });
      }).catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'embeddings_failed', error: err.message }));
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/dedup/run', jwtAuth, async (req, res) => {
    try {
      const tid = req.user?.tenant_id || 't_demo';
      res.json({ status: 'started', message: 'Rule-based dedup running — monitor in Jobs tab' });
      runTracked(JOB_TYPES.DEDUP, 'dedup', async (jobId, progress) => {
        return precomputeDedup(tid, { onProgress: progress });
      }).catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'dedup_run_failed', error: err.message }));
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/dedup/llm-judge', jwtAuth, async (req, res) => {
    try {
      const tid = req.user?.tenant_id || 't_demo';
      res.json({ status: 'started', message: 'LLM judge running — monitor in Jobs tab' });
      runTracked(JOB_TYPES.LLM_JUDGE, 'llm-judge', async () => {
        return llmJudgePass(tid);
      }).catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'llm_judge_failed', error: err.message }));
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/dedup/geo-review', jwtAuth, async (req, res) => {
    try {
      res.json({ status: 'started', message: 'Geo review running — splits clusters >50km apart if LLM confirms mismatch' });
      runTracked('geo_review', 'geo-review', async (_jid, progress) => {
        return llmGeoReview({ onProgress: progress });
      }).catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'geo_review_failed', error: err.message }));
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Attractions (POI clustering) ----
  p.get('/v1/dashboard/attractions', jwtAuth, async (req, res) => {
    try {
      const { q, city, category, sort = 'experience_count' } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
      const offset = (page - 1) * limit;

      const where = [];
      const params = [];
      let idx = 1;

      if (q) {
        where.push(`(display_name ILIKE $${idx} OR name ILIKE $${idx})`);
        params.push(`%${q}%`);
        idx++;
      }
      if (city) {
        where.push(`city ILIKE $${idx}`);
        params.push(`%${city}%`);
        idx++;
      }
      if (category) {
        where.push(`category = $${idx}`);
        params.push(category);
        idx++;
      }

      const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const orderMap = {
        experience_count: 'experience_count DESC',
        name: 'display_name ASC',
        city: 'city ASC, experience_count DESC',
      };
      const orderBy = orderMap[sort] || orderMap.experience_count;

      const totalRow = (await query(
        `SELECT COUNT(*)::int AS total FROM hub_attractions ${whereSQL}`, params
      )).rows[0];

      const rows = (await query(
        `SELECT id, name, display_name, city, country, latitude, longitude,
                category, experience_count, image_url, created_at
         FROM hub_attractions ${whereSQL}
         ORDER BY ${orderBy}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      )).rows;

      const cities = (await query(
        `SELECT DISTINCT city FROM hub_attractions ORDER BY city`
      )).rows.map(r2 => r2.city);

      const categories = (await query(
        `SELECT DISTINCT category FROM hub_attractions WHERE category IS NOT NULL ORDER BY category`
      )).rows.map(r2 => r2.category);

      const summary = (await query(
        `SELECT COUNT(*)::int AS total_attractions,
                SUM(experience_count)::int AS total_linked,
                COUNT(DISTINCT city)::int AS total_cities
         FROM hub_attractions`
      )).rows[0];

      res.json({
        attractions: rows,
        total: totalRow.total,
        page, pages: Math.max(1, Math.ceil(totalRow.total / limit)),
        cities, categories,
        summary,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.get('/v1/dashboard/attractions/autocomplete', jwtAuth, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || q.length < 2) return res.json({ suggestions: [] });
      const { rows } = await query(
        `SELECT id, display_name, city, country, experience_count, image_url
         FROM hub_attractions
         WHERE display_name ILIKE $1 OR city ILIKE $1
         ORDER BY
           CASE WHEN LOWER(display_name) = LOWER($2) THEN 0
                WHEN LOWER(display_name) LIKE LOWER($2) || '%' THEN 1
                ELSE 2 END,
           experience_count DESC
         LIMIT 10`,
        [`%${q}%`, q]
      );
      res.json({ suggestions: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.get('/v1/dashboard/attractions/:id', jwtAuth, async (req, res) => {
    try {
      const attraction = (await query(
        `SELECT id, name, display_name, city, country, latitude, longitude,
                category, experience_count, image_url
         FROM hub_attractions WHERE id = $1`,
        [req.params.id]
      )).rows[0];
      if (!attraction) return res.status(404).json({ error: 'attraction not found' });

      const experiences = (await query(
        `SELECT id, supplier_slug, supplier_raw_ref, title, category, duration_minutes,
                price_from, price_currency, rating, review_count,
                image_urls, description
         FROM hub_static_inventory
         WHERE attraction_id = $1 AND is_active = true AND canonical_id IS NULL
         ORDER BY rating DESC NULLS LAST, review_count DESC NULLS LAST`,
        [req.params.id]
      )).rows;

      const suppliers = [...new Set(experiences.map(e => e.supplier_slug))];

      res.json({ attraction, experiences, suppliers });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/attractions/cluster', jwtAuth, async (req, res) => {
    try {
      res.json({ status: 'started', message: 'Attraction clustering running — monitor in Jobs tab' });
      runTracked(JOB_TYPES.ATTRACTION_CLUSTER, 'attraction-cluster', async (jobId, progress) => {
        return clusterAttractions({ onProgress: progress });
      }).catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'attraction_cluster_failed', error: err.message }));
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/attractions/validate', jwtAuth, async (req, res) => {
    try {
      res.json({ status: 'started', message: 'LLM attraction validation running — monitor in Jobs tab' });
      runTracked(JOB_TYPES.ATTRACTION_VALIDATE, 'attraction-validate', async () => {
        return validateAttractions(tenantId(req));
      }).catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'attraction_validate_failed', error: err.message }));
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/attractions/poi-match', jwtAuth, async (req, res) => {
    try {
      res.json({ status: 'started', message: 'POI matching running — migrate clusters → match inventory → refresh counts' });
      runTracked(JOB_TYPES.POI_MATCH, 'poi-matcher', async (_jid, progress) => {
        const migrateResult = await migrateAttractionsToGlobalPois({ onProgress: (pct, d) => progress(Math.round(pct * 0.5), d) });
        const matchResult = await matchInventoryToPois({ onProgress: (pct, d) => progress(50 + Math.round(pct * 0.45), d) });
        await refreshPoiCounts();
        return { migrate: migrateResult, match: matchResult };
      }).catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'poi_match_failed', error: err.message }));
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // List questionable attraction escalations for human review
  p.get('/v1/dashboard/attractions/review', jwtAuth, async (req, res) => {
    try {
      const { rows } = await query(`
        SELECT id, trigger_data, status, created_at
        FROM hub_escalations
        WHERE tenant_id = $1 AND prompt_key = 'attraction.validation.questionable'
        ORDER BY created_at DESC
      `, [tenantId(req)]);
      res.json({ escalations: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Resolve an attraction escalation: keep or dismantle
  p.post('/v1/dashboard/attractions/review/:id', jwtAuth, async (req, res) => {
    try {
      const { action } = req.body || {};
      if (!['keep', 'dismantle'].includes(action))
        return res.status(400).json({ error: 'action must be keep or dismantle' });

      const esc = (await query(
        `SELECT id, trigger_data FROM hub_escalations WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId(req)]
      )).rows[0];
      if (!esc) return res.status(404).json({ error: 'escalation not found' });

      const data = typeof esc.trigger_data === 'string' ? JSON.parse(esc.trigger_data) : esc.trigger_data;

      if (action === 'dismantle') {
        await query(`UPDATE hub_static_inventory SET attraction_id = NULL WHERE attraction_id = $1`, [data.attraction_id]);
        await query(`DELETE FROM hub_attractions WHERE id = $1`, [data.attraction_id]);
      }

      await query(
        `UPDATE hub_escalations SET status = 'RESOLVED', resolution = $1, resolved_at = now() WHERE id = $2`,
        [JSON.stringify({ action }), esc.id]
      );

      res.json({ status: 'resolved', action, attraction: data.name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- Job Monitor ----
  p.get('/v1/dashboard/jobs', jwtAuth, async (req, res) => {
    try {
      const jobs = await getActiveJobs();
      const running = jobs.filter(j => j.status === 'RUNNING');
      res.json({ jobs, running_count: running.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/jobs/:id/cancel', jwtAuth, async (req, res) => {
    try {
      const cancelled = await cancelJob(req.params.id);
      if (!cancelled) return res.status(400).json({ error: 'Job is not running' });
      res.json({ status: 'cancelled', id: req.params.id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  p.post('/v1/dashboard/jobs/:id/restart', jwtAuth, async (req, res) => {
    try {
      const tid = tenantId(req);
      const old = (await query(
        `SELECT id, job_type, supplier_slug, status FROM hub_sync_jobs WHERE id = $1`,
        [req.params.id]
      )).rows[0];
      if (!old) return res.status(404).json({ error: 'job not found' });
      if (old.status === 'RUNNING') return res.status(400).json({ error: 'job is already running' });

      const jobType = old.job_type || 'sync';
      const slug = old.supplier_slug;

      const launcher = {
        dedup: () => runTracked(JOB_TYPES.DEDUP, 'dedup', async (_jid, progress) => {
          return precomputeDedup(tid, { onProgress: progress });
        }),
        llm_judge: () => runTracked(JOB_TYPES.LLM_JUDGE, 'llm-judge', async () => {
          return llmJudgePass(tid);
        }),
        attraction_cluster: () => runTracked(JOB_TYPES.ATTRACTION_CLUSTER, 'attraction-cluster', async (_jid, progress) => {
          return clusterAttractions({ onProgress: progress });
        }),
        attraction_validate: () => runTracked(JOB_TYPES.ATTRACTION_VALIDATE, 'attraction-validate', async () => {
          return validateAttractions(tid);
        }),
        embeddings: () => runTracked(JOB_TYPES.EMBEDDINGS, 'embeddings', async (_jid, progress) => {
          return buildEmbeddings({ onProgress: progress });
        }),
        enrich: () => runTracked(JOB_TYPES.ENRICH, 'enrich', async () => {
          const creds = await getSecret(tid, 'hotelbeds-activities') || await getSecret(tid, 'hotelbeds');
          if (!creds) throw new Error('No hotelbeds credentials configured');
          return enrichActivities({
            apiKey: creds.api_key,
            secretKey: creds.secret_key || creds.secret,
            env: creds.env || process.env.HOTELBEDS_ENV || 'sandbox',
          });
        }),
        taxonomy_sync: () => runTracked(JOB_TYPES.TAXONOMY_SYNC, slug || 'viator', async (_jid, progress) => {
          const creds = await getSecret(tid, 'viator');
          if (!creds?.api_key) throw new Error('No Viator credentials configured');
          return syncViatorTaxonomy({
            apiKey: creds.api_key,
            env: creds.env || 'sandbox',
            maxCities: 50,
            onProgress: progress,
          });
        }),
        poi_match: () => runTracked(JOB_TYPES.POI_MATCH, 'poi-matcher', async (_jid, progress) => {
          const migrateResult = await migrateAttractionsToGlobalPois({ onProgress: (pct, d) => progress(Math.round(pct * 0.5), d) });
          const matchResult = await matchInventoryToPois({ onProgress: (pct, d) => progress(50 + Math.round(pct * 0.45), d) });
          await refreshPoiCounts();
          return { migrate: migrateResult, match: matchResult };
        }),
        sync: () => {
          const syncMap = {
            bridgify: async (c) => syncBridgifyExperiences({ clientId: c.client_id, clientSecret: c.client_secret, baseUrl: c.base_url || process.env.BRIDGIFY_BASE_URL }),
            'hotelbeds-hotels': async (c) => syncHotelbedsHotels({ apiKey: c.api_key, secretKey: c.secret_key, env: c.env || process.env.HOTELBEDS_ENV || 'sandbox' }),
            'hotelbeds-activities': async (c) => syncHotelbedsExperiences({ apiKey: c.api_key, secretKey: c.secret_key, env: c.env || process.env.HOTELBEDS_ENV || 'sandbox' }),
            'hotelbeds-transfers': async (c) => syncHotelbedsTransfers({ apiKey: c.api_key, secretKey: c.secret_key, env: c.env || process.env.HOTELBEDS_ENV || 'sandbox' }),
            viator: async (c) => syncViatorExperiences({ apiKey: c.api_key, env: c.env || 'sandbox', supplierSlug: 'viator' }),
            'viator-direct': async (c) => syncViatorExperiences({ apiKey: c.api_key, env: c.env || 'sandbox', supplierSlug: 'viator-direct' }),
        ticketmaster: async (c) => syncTicketmasterEvents({ apiKey: c[Object.keys(c).find(k => c[k]) || 'api_key'], supplierSlug: 'ticketmaster' }),
        duffel: async (c) => syncDuffelFlights({ accessToken: c[Object.keys(c).find(k => c[k]) || 'access_token'], supplierSlug: 'duffel' }),
          };
          return runTracked(JOB_TYPES.SYNC, slug, async () => {
            const creds = await getSecret(tid, slug);
            if (!creds) throw new Error(`No credentials for ${slug}`);
            const fn = syncMap[slug];
            if (!fn) throw new Error(`Unknown sync supplier: ${slug}`);
            return fn(creds);
          });
        },
      };

      const launch = launcher[jobType];
      if (!launch) return res.status(400).json({ error: `Cannot restart job type: ${jobType}` });

      res.json({ status: 'restarted', job_type: jobType, supplier_slug: slug });
      launch().catch(err => {
        console.error(JSON.stringify({ level: 'error', event: 'job_restart_failed', job_type: jobType, error: err.message }));
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Global POIs ----
  p.get('/v1/dashboard/pois', jwtAuth, async (req, res) => {
    try {
      const { city, limit = 100, offset = 0 } = req.query;
      const where = city ? `WHERE gp.city = $3` : '';
      const params = city ? [Number(limit), Number(offset), city] : [Number(limit), Number(offset)];
      const { rows } = await query(`
        SELECT gp.*,
          (SELECT COUNT(*)::int FROM hub_supplier_pois sp WHERE sp.global_poi_id = gp.id) AS supplier_count
        FROM hub_global_pois gp
        ${where}
        ORDER BY gp.experience_count DESC NULLS LAST
        LIMIT $1 OFFSET $2
      `, params);
      const { rows: [{ count: total }] } = await query(
        `SELECT COUNT(*)::int AS count FROM hub_global_pois ${city ? 'WHERE city = $1' : ''}`,
        city ? [city] : []
      );
      res.json({ pois: rows, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.get('/v1/dashboard/pois/stats', jwtAuth, async (req, res) => {
    try {
      const [overview, byCityTop, bySource, supplierCoverage, categories] = await Promise.all([
        query(`SELECT COUNT(*)::int AS total_pois,
                      COUNT(DISTINCT city)::int AS cities,
                      COUNT(DISTINCT country)::int AS countries,
                      SUM(experience_count)::int AS total_experiences_linked
               FROM hub_global_pois`),
        query(`SELECT city, COUNT(*)::int AS pois, SUM(experience_count)::int AS experiences
               FROM hub_global_pois GROUP BY city ORDER BY pois DESC LIMIT 20`),
        query(`SELECT source, COUNT(*)::int AS count FROM hub_global_pois GROUP BY source`),
        query(`SELECT supplier_slug, COUNT(*)::int AS mapped,
                      COUNT(*) FILTER (WHERE global_poi_id IS NOT NULL)::int AS linked
               FROM hub_supplier_pois GROUP BY supplier_slug`),
        query(`SELECT COUNT(*)::int AS total FROM hub_canonical_categories`),
      ]);
      res.json({
        overview: overview.rows[0],
        top_cities: byCityTop.rows,
        by_source: bySource.rows,
        supplier_coverage: supplierCoverage.rows,
        canonical_categories: categories.rows[0]?.total || 0,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.get('/v1/dashboard/pois/:id', jwtAuth, async (req, res) => {
    try {
      const { rows: [poi] } = await query(`SELECT * FROM hub_global_pois WHERE id = $1`, [req.params.id]);
      if (!poi) return res.status(404).json({ error: 'POI not found' });

      const { rows: supplierPois } = await query(
        `SELECT * FROM hub_supplier_pois WHERE global_poi_id = $1`, [req.params.id]
      );
      const { rows: experiences } = await query(
        `SELECT id, title, supplier_slug, category, rating, review_count, price_from, price_currency, image_urls
         FROM hub_static_inventory
         WHERE global_poi_id = $1 AND is_active = true
         ORDER BY rating DESC NULLS LAST LIMIT 50`,
        [req.params.id]
      );
      res.json({ poi, supplier_pois: supplierPois, experiences });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.get('/v1/dashboard/categories', jwtAuth, async (req, res) => {
    try {
      const { rows: categories } = await query(
        `SELECT cc.*, COUNT(cm.id)::int AS mapping_count
         FROM hub_canonical_categories cc
         LEFT JOIN hub_category_mappings cm ON cm.canonical_cat_id = cc.id
         GROUP BY cc.id ORDER BY cc.level, cc.display`
      );
      const { rows: mappings } = await query(
        `SELECT * FROM hub_category_mappings ORDER BY supplier_slug, supplier_cat_name`
      );
      res.json({ categories, mappings });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- Ranking Config ----
  p.get('/v1/dashboard/ranking-config', jwtAuth, async (req, res) => {
    try {
      const cfg = await loadRankingConfig(tenantId(req));
      res.json({ config: cfg });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.patch('/v1/dashboard/ranking-config', jwtAuth, async (req, res) => {
    try {
      const merged = await saveRankingConfig(tenantId(req), req.body);
      res.json({ config: merged });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- Eval Stats ----
  p.get('/v1/dashboard/eval/stats', jwtAuth, async (req, res) => {
    try {
      const [
        inventoryOverview,
        dataCoverage,
        dedupOverview,
        dedupCategoryMatch,
        dedupSupplierMix,
        dedupClusterSizes,
        dedupPriceSpread,
        dedupGeoSpread,
        attrOverview,
        attrCityConsistency,
        attrCatConsistency,
        attrSizeDistribution,
        attrLargest,
      ] = await Promise.all([
        query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE is_active)::int as active,
               COUNT(DISTINCT supplier_slug)::int as suppliers, COUNT(DISTINCT city)::int as cities
               FROM hub_static_inventory`),
        query(`SELECT COUNT(*)::int as total,
               COUNT(rating)::int as has_rating, COUNT(review_count)::int as has_reviews,
               COUNT(price_from)::int as has_price, COUNT(duration_minutes)::int as has_duration,
               COUNT(description)::int as has_description, COUNT(image_urls)::int as has_images,
               COUNT(embedding)::int as has_embedding
               FROM hub_static_inventory WHERE is_active = true`),
        query(`SELECT COUNT(DISTINCT canonical_id)::int as clusters,
               COUNT(*) FILTER (WHERE canonical_id IS NOT NULL AND canonical_id != id)::int as duplicates_hidden,
               COUNT(*) FILTER (WHERE canonical_id IS NULL)::int as unclustered
               FROM hub_static_inventory WHERE is_active = true`),
        query(`SELECT COUNT(*) FILTER (WHERE a.category = b.category)::int as same_cat,
               COUNT(*) FILTER (WHERE a.category != b.category)::int as diff_cat,
               COUNT(*)::int as total
               FROM hub_static_inventory a JOIN hub_static_inventory b
               ON a.canonical_id = b.canonical_id AND a.id < b.id
               WHERE a.canonical_id IS NOT NULL AND a.is_active AND b.is_active`),
        query(`SELECT COUNT(*) FILTER (WHERE a.supplier_slug = b.supplier_slug)::int as same_supplier,
               COUNT(*) FILTER (WHERE a.supplier_slug != b.supplier_slug)::int as cross_supplier,
               COUNT(*)::int as total
               FROM hub_static_inventory a JOIN hub_static_inventory b
               ON a.canonical_id = b.canonical_id AND a.id < b.id
               WHERE a.canonical_id IS NOT NULL AND a.is_active AND b.is_active`),
        query(`SELECT size, COUNT(*)::int as clusters FROM (
               SELECT canonical_id, COUNT(*)::int as size FROM hub_static_inventory
               WHERE canonical_id IS NOT NULL AND is_active GROUP BY canonical_id) sub
               GROUP BY size ORDER BY size LIMIT 20`),
        query(`SELECT AVG(spread)::int as avg_pct, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY spread)::int as median_pct,
               PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY spread)::int as p90_pct,
               COUNT(*)::int as clusters_with_prices
               FROM (SELECT canonical_id,
               CASE WHEN MIN(price_from)>0 THEN ((MAX(price_from)-MIN(price_from))/MIN(price_from)*100) ELSE NULL END as spread
               FROM hub_static_inventory WHERE canonical_id IS NOT NULL AND is_active AND price_from>0
               GROUP BY canonical_id HAVING COUNT(*)>=2) sub WHERE spread IS NOT NULL`),
        query(`SELECT AVG(d)::int as avg_m, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d)::int as median_m,
               PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d)::int as p90_m,
               PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY d)::int as p99_m
               FROM (SELECT a.canonical_id,
               MAX(6371000*acos(LEAST(1,cos(radians(a.latitude))*cos(radians(b.latitude))*cos(radians(b.longitude)-radians(a.longitude))+sin(radians(a.latitude))*sin(radians(b.latitude))))) as d
               FROM hub_static_inventory a JOIN hub_static_inventory b ON a.canonical_id=b.canonical_id AND a.id<b.id
               WHERE a.canonical_id IS NOT NULL AND a.is_active AND b.is_active AND a.latitude IS NOT NULL AND b.latitude IS NOT NULL
               GROUP BY a.canonical_id) sub`),
        query(`SELECT COUNT(*)::int as total_clusters,
               COUNT(DISTINCT si.id)::int as experiences_linked,
               (SELECT COUNT(*)::int FROM hub_static_inventory WHERE is_active AND type='EXPERIENCE') as total_experiences
               FROM hub_attractions a JOIN hub_static_inventory si ON si.attraction_id=a.id AND si.is_active`),
        query(`SELECT COUNT(*) FILTER (WHERE cc=1)::int as same_city, COUNT(*) FILTER (WHERE cc>1)::int as multi_city
               FROM (SELECT a.id, COUNT(DISTINCT si.city) as cc FROM hub_attractions a
               JOIN hub_static_inventory si ON si.attraction_id=a.id AND si.is_active GROUP BY a.id) sub`),
        query(`SELECT AVG(cc)::numeric(3,1) as avg_categories,
               COUNT(*) FILTER (WHERE cc=1)::int as single_cat, COUNT(*) FILTER (WHERE cc>1)::int as multi_cat
               FROM (SELECT a.id, COUNT(DISTINCT si.category) as cc FROM hub_attractions a
               JOIN hub_static_inventory si ON si.attraction_id=a.id AND si.is_active GROUP BY a.id) sub`),
        query(`SELECT experience_count as size, COUNT(*)::int as clusters FROM hub_attractions
               GROUP BY experience_count ORDER BY experience_count LIMIT 20`),
        query(`SELECT display_name, city, experience_count, unique_product_count FROM hub_attractions
               ORDER BY experience_count DESC LIMIT 10`),
      ]);

      res.json({
        generated_at: new Date().toISOString(),
        inventory: { ...inventoryOverview.rows[0], data_coverage: dataCoverage.rows[0] },
        dedup: {
          ...dedupOverview.rows[0],
          category_match: dedupCategoryMatch.rows[0],
          supplier_mix: dedupSupplierMix.rows[0],
          cluster_sizes: dedupClusterSizes.rows,
          price_spread: dedupPriceSpread.rows[0],
          geo_spread: dedupGeoSpread.rows[0],
        },
        attractions: {
          ...attrOverview.rows[0],
          city_consistency: attrCityConsistency.rows[0],
          category_consistency: attrCatConsistency.rows[0],
          size_distribution: attrSizeDistribution.rows,
          largest_clusters: attrLargest.rows,
        },
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- Gold Dataset ----
  p.get('/v1/dashboard/gold-dataset', jwtAuth, async (req, res) => {
    try {
      const data = await getGoldDataset();
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/gold-dataset/sample', jwtAuth, async (req, res) => {
    try {
      const result = await sampleGoldPairs();
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/gold-dataset/label', jwtAuth, async (req, res) => {
    try {
      res.json({ status: 'started' });
      runTracked('GOLD_LABEL', 'dedup-gold', async (jobId, progress) => {
        return labelGoldPairs({ onProgress: (pct, detail) => progress(pct, JSON.stringify(detail)) });
      }).catch(e => console.error('gold_label_failed', e.message));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/gold-dataset/eval', jwtAuth, async (req, res) => {
    try {
      const result = await evalGoldDataset(req.body || {});
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.delete('/v1/dashboard/gold-dataset', jwtAuth, async (req, res) => {
    try {
      await query(`DELETE FROM hub_dedup_gold_pairs`);
      res.json({ deleted: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.get('/v1/dashboard/jobs/running', jwtAuth, async (req, res) => {
    try {
      const jobs = await getRunningJobs();
      res.json({ jobs, count: jobs.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Category Taxonomy Management ───────────────────────────────

  p.get('/v1/dashboard/categories', jwtAuth, async (req, res) => {
    try {
      const { level, parent_id, search } = req.query;
      const conditions = [];
      const params = [];
      let idx = 1;

      if (level !== undefined && level !== '') {
        conditions.push(`cc.level = $${idx}`);
        params.push(parseInt(level));
        idx++;
      }
      if (parent_id) {
        conditions.push(`cc.parent_id = $${idx}`);
        params.push(parent_id);
        idx++;
      }
      if (search) {
        conditions.push(`(cc.id ILIKE $${idx} OR cc.display ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      const { rows } = await query(`
        SELECT cc.id, cc.display, cc.parent_id, cc.level,
               COUNT(cm.supplier_cat_id)::int AS mapping_count,
               cc.created_at
        FROM hub_canonical_categories cc
        LEFT JOIN hub_category_mappings cm ON cm.canonical_cat_id = cc.id
        ${where}
        GROUP BY cc.id, cc.display, cc.parent_id, cc.level, cc.created_at
        ORDER BY cc.level, cc.display
      `, params);

      res.json({ categories: rows, total: rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── LLM Category Mapper (must be before :id route) ─────────────

  p.get('/v1/dashboard/categories/unmapped', jwtAuth, async (req, res) => {
    try {
      const { supplier_slug } = req.query;
      const unmapped = await getUnmappedCategories(supplier_slug || null);
      res.json({ unmapped, total: unmapped.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/categories/auto-map', jwtAuth, async (req, res) => {
    try {
      const { supplier_slug, dry_run } = req.body || {};
      const result = await autoMapUnmapped(supplier_slug || null, { dryRun: !!dry_run });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.get('/v1/dashboard/categories/:id', jwtAuth, async (req, res) => {
    try {
      const { rows: cats } = await query(
        `SELECT * FROM hub_canonical_categories WHERE id = $1`, [req.params.id]
      );
      if (!cats[0]) return res.status(404).json({ error: 'category not found' });

      const { rows: mappings } = await query(
        `SELECT supplier_slug, supplier_cat_id, supplier_cat_name
         FROM hub_category_mappings WHERE canonical_cat_id = $1
         ORDER BY supplier_slug`, [req.params.id]
      );

      const { rows: children } = await query(
        `SELECT id, display, level FROM hub_canonical_categories WHERE parent_id = $1 ORDER BY display`,
        [req.params.id]
      );

      const { rows: countRow } = await query(`
        SELECT COUNT(*)::int AS product_count
        FROM hub_static_inventory si
        JOIN hub_category_mappings cm ON cm.supplier_slug = si.supplier_slug AND cm.supplier_cat_id = si.category
        WHERE cm.canonical_cat_id = $1 AND si.is_active = true
      `, [req.params.id]);

      res.json({
        ...cats[0],
        mappings,
        children,
        product_count: countRow[0]?.product_count || 0,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/categories', jwtAuth, async (req, res) => {
    try {
      const { id, display, parent_id, level } = req.body;
      if (!id || !display) return res.status(400).json({ error: 'id and display are required' });

      await query(
        `INSERT INTO hub_canonical_categories (id, display, parent_id, level)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET display = EXCLUDED.display, parent_id = EXCLUDED.parent_id, level = EXCLUDED.level`,
        [id, display, parent_id || null, level ?? 0]
      );
      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.put('/v1/dashboard/categories/:id', jwtAuth, async (req, res) => {
    try {
      const { display, parent_id, level } = req.body;
      const { rowCount } = await query(
        `UPDATE hub_canonical_categories SET display = COALESCE($2, display), parent_id = $3, level = COALESCE($4, level)
         WHERE id = $1`,
        [req.params.id, display, parent_id ?? null, level]
      );
      if (!rowCount) return res.status(404).json({ error: 'category not found' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.delete('/v1/dashboard/categories/:id', jwtAuth, async (req, res) => {
    try {
      await query(`DELETE FROM hub_category_mappings WHERE canonical_cat_id = $1`, [req.params.id]);
      await query(`UPDATE hub_canonical_categories SET parent_id = NULL WHERE parent_id = $1`, [req.params.id]);
      const { rowCount } = await query(`DELETE FROM hub_canonical_categories WHERE id = $1`, [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: 'category not found' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Supplier → canonical category mappings
  p.get('/v1/dashboard/category-mappings', jwtAuth, async (req, res) => {
    try {
      const { supplier_slug, canonical_cat_id, search } = req.query;
      const conditions = [];
      const params = [];
      let idx = 1;

      if (supplier_slug) {
        conditions.push(`cm.supplier_slug = $${idx}`);
        params.push(supplier_slug);
        idx++;
      }
      if (canonical_cat_id) {
        conditions.push(`cm.canonical_cat_id = $${idx}`);
        params.push(canonical_cat_id);
        idx++;
      }
      if (search) {
        conditions.push(`(cm.supplier_cat_name ILIKE $${idx} OR cm.canonical_cat_id ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      const { rows } = await query(`
        SELECT cm.supplier_slug, cm.supplier_cat_id, cm.supplier_cat_name,
               cm.canonical_cat_id, cc.display AS canonical_display,
               COUNT(si.id)::int AS product_count
        FROM hub_category_mappings cm
        LEFT JOIN hub_canonical_categories cc ON cc.id = cm.canonical_cat_id
        LEFT JOIN hub_static_inventory si
          ON si.supplier_slug = cm.supplier_slug AND si.category = cm.supplier_cat_id AND si.is_active = true
        ${where}
        GROUP BY cm.supplier_slug, cm.supplier_cat_id, cm.supplier_cat_name, cm.canonical_cat_id, cc.display
        ORDER BY product_count DESC
        LIMIT 500
      `, params);

      res.json({ mappings: rows, total: rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.post('/v1/dashboard/category-mappings', jwtAuth, async (req, res) => {
    try {
      const { supplier_slug, supplier_cat_id, supplier_cat_name, canonical_cat_id } = req.body;
      if (!supplier_slug || !supplier_cat_id || !canonical_cat_id) {
        return res.status(400).json({ error: 'supplier_slug, supplier_cat_id, and canonical_cat_id are required' });
      }
      await query(
        `INSERT INTO hub_category_mappings (supplier_slug, supplier_cat_id, supplier_cat_name, canonical_cat_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (supplier_slug, supplier_cat_id) DO UPDATE SET
           supplier_cat_name = COALESCE(EXCLUDED.supplier_cat_name, hub_category_mappings.supplier_cat_name),
           canonical_cat_id = EXCLUDED.canonical_cat_id`,
        [supplier_slug, supplier_cat_id, supplier_cat_name || null, canonical_cat_id]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  p.delete('/v1/dashboard/category-mappings', jwtAuth, async (req, res) => {
    try {
      const { supplier_slug, supplier_cat_id } = req.body;
      if (!supplier_slug || !supplier_cat_id) {
        return res.status(400).json({ error: 'supplier_slug and supplier_cat_id are required' });
      }
      const { rowCount } = await query(
        `DELETE FROM hub_category_mappings WHERE supplier_slug = $1 AND supplier_cat_id = $2`,
        [supplier_slug, supplier_cat_id]
      );
      res.json({ ok: true, deleted: rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Summary stats for category health
  p.get('/v1/dashboard/category-stats', jwtAuth, async (req, res) => {
    try {
      const [totalCats, totalMappings, unmapped, topLevel] = await Promise.all([
        query('SELECT COUNT(*)::int AS cnt FROM hub_canonical_categories WHERE level >= 0'),
        query('SELECT COUNT(*)::int AS cnt FROM hub_category_mappings'),
        query(`SELECT COUNT(DISTINCT si.category)::int AS cnt
               FROM hub_static_inventory si
               LEFT JOIN hub_category_mappings cm ON cm.supplier_slug = si.supplier_slug AND cm.supplier_cat_id = si.category
               WHERE si.is_active = true AND si.category IS NOT NULL AND cm.canonical_cat_id IS NULL`),
        query('SELECT COUNT(*)::int AS cnt FROM hub_canonical_categories WHERE level = 0'),
      ]);

      res.json({
        canonical_categories: totalCats.rows[0].cnt,
        supplier_mappings: totalMappings.rows[0].cnt,
        unmapped_supplier_categories: unmapped.rows[0].cnt,
        top_level_categories: topLevel.rows[0].cnt,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.use(p);
  return r;
};
