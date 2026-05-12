// Walks all 19 endpoints against a running server.
// Usage:
//   npm start                                          # in another terminal
//   TENANT_ID=demo API_KEY=... WEBHOOK_SECRET=... node scripts/smoke_test.js

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'demo';
const API_KEY = process.env.API_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin-dev-key';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || 'internal-dev-token';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

if (!API_KEY) {
  console.error('Set API_KEY env var (run scripts/seed_demo_tenant.js first)');
  process.exit(1);
}

const C = { reset: '\x1b[0m', g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', dim: '\x1b[2m' };

let pass = 0, fail = 0, soft = 0;

const hit = async (label, opts) => {
  const { method = 'GET', path, headers = {}, body, expect = [200], soft: isSoft = false } = opts;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    const ok = expect.includes(res.status);
    const tag = ok ? `${C.g}PASS${C.reset}` : (isSoft ? `${C.y}SOFT${C.reset}` : `${C.r}FAIL${C.reset}`);
    if (ok) pass++; else if (isSoft) soft++; else fail++;
    console.log(`${tag} ${method.padEnd(6)} ${path.padEnd(50)} → ${res.status}  ${C.dim}${label}${C.reset}`);
    if (!ok) console.log(`     ${C.dim}${JSON.stringify(json).slice(0, 200)}${C.reset}`);
    return { status: res.status, json };
  } catch (e) {
    fail++;
    console.log(`${C.r}ERR ${C.reset} ${method.padEnd(6)} ${path.padEnd(50)} → ${e.message}`);
    return { status: 0, json: null };
  }
};

const main = async () => {
  console.log(`\n${C.dim}Smoke test against ${BASE}, tenant=${TENANT_ID}${C.reset}\n`);

  // ---- Health + auth ----
  await hit('health', { path: '/health' });
  await hit('auth: missing key → 401', { path: '/v1/integrations', expect: [401] });
  await hit('auth: bad key → 401', { path: '/v1/integrations', headers: { 'X-Api-Key': 'wrong' }, expect: [401] });

  const auth = { 'X-Api-Key': API_KEY };

  // ---- Listing endpoints (should always work) ----
  await hit('list integrations', { path: '/v1/integrations', headers: auth });
  await hit('list tools', { path: '/v1/tools', headers: auth });

  // ---- Search/book/cancel: soft (no real supplier creds) ----
  await hit('search (no creds → 500 expected)', {
    method: 'POST', path: '/v1/search', headers: auth,
    body: { destination: 'Barcelona' }, expect: [200, 500], soft: true,
  });
  await hit('book (soft)', {
    method: 'POST', path: '/v1/book', headers: auth,
    body: { supplier: 'bridgify', args: {} }, expect: [200, 500], soft: true,
  });
  await hit('cancel (soft)', {
    method: 'POST', path: '/v1/cancel', headers: auth,
    body: { supplier: 'bridgify', ref: 'fake' }, expect: [200, 500], soft: true,
  });
  await hit('booking get (soft)', {
    method: 'GET', path: '/v1/booking/fake-id?supplier=bridgify', headers: auth,
    expect: [200, 500], soft: true,
  });

  // ---- Onboarding ----
  const manifest = {
    manifest_version: '1.0',
    supplier: {
      name: 'Smoke Supplier', slug: 'smoke-supplier', categories: ['EXPERIENCE'],
      base_url_sandbox: 'https://sandbox.smoke.test',
      base_url_production: 'https://api.smoke.test',
    },
    auth: { type: 'API_KEY', credential_fields: ['api_key'] },
    operations: {
      search: { method: 'GET', endpoint: '/exp' },
      book:   { method: 'POST', endpoint: '/book' },
    },
    rate_limit_rpm: 60,
    cts_mapping: {
      type_value: 'EXPERIENCE',
      field_mappings: [{ source: 'title', target: 'title', transform: null }],
    },
    test_suite: { sandbox_search_params: { city: 'Paris' }, expected_result_count_min: 1 },
    tenant_config: { tenant_id: TENANT_ID, sla_tier: 'GROWTH' },
  };

  const onboard = await hit('onboard start', {
    method: 'POST', path: '/v1/integrations/onboard', headers: auth,
    body: { manifest },
  });
  const sid = onboard.json?.session_id;

  if (sid) {
    await hit('onboard get', { path: `/v1/integrations/onboard/${sid}`, headers: auth });
    await hit('onboard patch manifest', {
      method: 'PATCH', path: `/v1/integrations/onboard/${sid}/manifest`, headers: auth,
      body: manifest,
    });
    await hit('onboard confirm (sandbox call will fail → 200 with passed=false)', {
      method: 'POST', path: `/v1/integrations/onboard/${sid}/confirm`, headers: auth,
      expect: [200], soft: true,
    });
    await hit('onboard promote (will 400 unless validated)', {
      method: 'POST', path: `/v1/integrations/onboard/${sid}/promote`, headers: auth,
      expect: [200, 400], soft: true,
    });
  }

  await hit('deactivate integration', {
    method: 'DELETE', path: '/v1/integrations/smoke-supplier', headers: auth,
  });

  // ---- Sessions / tools ----
  await hit('session 404', {
    path: '/v1/session/00000000-0000-0000-0000-000000000000', headers: auth, expect: [404],
  });
  await hit('tool dispatch 404', {
    method: 'POST', path: '/v1/tools/no-such-contract', headers: auth, expect: [404],
  });

  // ---- Webhook ----
  if (WEBHOOK_SECRET) {
    await hit('webhook (signed)', {
      method: 'POST', path: '/v1/webhook/demo-partner',
      headers: { 'X-Webhook-Secret': WEBHOOK_SECRET },
      body: { event: 'ping' },
    });
  } else {
    console.log(`${C.y}SKIP${C.reset} webhook (set WEBHOOK_SECRET to test)`);
  }
  await hit('webhook (bad secret → 401)', {
    method: 'POST', path: '/v1/webhook/demo-partner',
    headers: { 'X-Webhook-Secret': 'wrong' }, body: {}, expect: [401],
  });

  // ---- Internal ----
  await hit('agent callback (bad token → 401)', {
    method: 'POST', path: '/v1/agent/callback', body: {}, expect: [401],
  });
  await hit('agent callback (signed)', {
    method: 'POST', path: '/v1/agent/callback',
    headers: { 'X-Internal-Token': INTERNAL_TOKEN },
    body: { session_id: '00000000-0000-0000-0000-000000000000', result: { ok: true } },
  });

  // ---- Admin ----
  await hit('admin dedup log (bad → 401)', {
    path: `/v1/admin/dedup/test-log/${TENANT_ID}`, expect: [401],
  });
  await hit('admin dedup log', {
    path: `/v1/admin/dedup/test-log/${TENANT_ID}`,
    headers: { 'X-Admin-Key': ADMIN_KEY },
  });
  const promptKey = `smoke.test.${Date.now()}`;
  await hit('admin upsert prompt', {
    method: 'POST', path: '/v1/admin/prompts',
    headers: { 'X-Admin-Key': ADMIN_KEY },
    body: {
      prompt_key: promptKey, category: 'INVENTORY',
      trigger_condition: 'context.x === 1',
      prompt_template: 'smoke', escalate_to_human: false,
    },
  });
  await hit('admin resolve missing escalation → 404', {
    method: 'POST',
    path: '/v1/admin/escalation/00000000-0000-0000-0000-000000000000/resolve',
    headers: { 'X-Admin-Key': ADMIN_KEY },
    body: { resolution: { note: 'noop' }, resolved_by: 'smoke' },
    expect: [404],
  });

  console.log(`\n${C.g}${pass} pass${C.reset}  ${C.y}${soft} soft${C.reset}  ${C.r}${fail} fail${C.reset}\n`);
  process.exit(fail ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
