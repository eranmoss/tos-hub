import axios from 'axios';
import { createHash } from 'crypto';
import { query } from '../db/client.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const STAGES = [
  'IDENTITY', 'AUTH', 'API_CONTRACT', 'CTS_MAPPING',
  'TEST_CONFIG', 'TENANT_CONFIG', 'REVIEW', 'VALIDATE_PROMOTE',
];

const CTS_FIELDS = ['title', 'duration_minutes', 'price.amount', 'price.currency',
  'location.latitude', 'location.longitude', 'category', 'status'];

const fetchDocs = async (url) => {
  const res = await axios.get(url, { timeout: 15000 });
  const body = String(res.data || '');
  const hash = createHash('sha256').update(body).digest('hex');
  const endpoints = [...body.matchAll(/(GET|POST|PUT|DELETE|PATCH)\s+(\/[a-zA-Z0-9_\-\/:.]+)/g)]
    .map(m => ({ method: m[1], endpoint: m[2] }));
  const fields = [...body.matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g)].map(m => m[1]);
  const proposedMappings = [];
  for (const f of fields) {
    for (const cts of CTS_FIELDS) {
      const leaf = cts.split('.').pop();
      if (f.toLowerCase() === leaf.toLowerCase()) {
        proposedMappings.push({ source: f, target: cts, transform: null });
      }
    }
  }
  return { endpoints, fields, proposedMappings, content_hash: hash };
};

export const advanceStage = async ({ sessionId, tenantId, stage, input }) => {
  const session = await query(
    `SELECT manifest_json FROM hub_onboarding_sessions WHERE session_id = $1 AND tenant_id = $2`,
    [sessionId, tenantId]
  );
  if (!session.rows[0]) throw new Error('session not found');
  const manifest = session.rows[0].manifest_json || {};

  if (stage === 'IDENTITY') {
    manifest.supplier = { ...(manifest.supplier || {}), ...input };
    if (input.documentation_url) {
      try {
        const docs = await fetchDocs(input.documentation_url);
        manifest._docs_summary = docs;
        await query(
          `UPDATE hub_onboarding_sessions SET docs_fetched_url = $1, docs_content_hash = $2 WHERE session_id = $3`,
          [input.documentation_url, docs.content_hash, sessionId]
        );
      } catch (e) {
        log('warn', 'docs_fetch_failed', { url: input.documentation_url, error: e.message });
      }
    }
  } else if (stage === 'AUTH') {
    manifest.auth = { ...(manifest.auth || {}), ...input };
  } else if (stage === 'API_CONTRACT') {
    manifest.operations = { ...(manifest.operations || {}), ...input };
  } else if (stage === 'CTS_MAPPING') {
    manifest.cts_mapping = { ...(manifest.cts_mapping || {}), ...input };
  } else if (stage === 'TEST_CONFIG') {
    manifest.test_suite = { ...(manifest.test_suite || {}), ...input };
  } else if (stage === 'TENANT_CONFIG') {
    manifest.tenant_config = { ...(manifest.tenant_config || {}), ...input, tenant_id: tenantId };
  }

  await query(
    `UPDATE hub_onboarding_sessions SET manifest_json = $1, updated_at = now() WHERE session_id = $2`,
    [manifest, sessionId]
  );
  return { stage, manifest };
};

export { STAGES, fetchDocs };
