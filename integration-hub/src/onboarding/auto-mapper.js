import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

// ─────────────────────────────────────────────────────────────────────
// Path collection — walks a JSON object, returns every leaf with:
//   { path: "data[].price.amount", sample: 48, type: "number" }
// Array indices are collapsed to `[]` so a list of results contributes
// one path per leaf rather than N paths per element.
// ─────────────────────────────────────────────────────────────────────

export const collectPaths = (root) => {
  const paths = new Map();
  const visit = (node, path) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      if (node.length === 0) return;
      visit(node[0], `${path}[]`);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        visit(v, path ? `${path}.${k}` : k);
      }
      return;
    }
    const typ = typeof node;
    if (!paths.has(path)) paths.set(path, { path, sample: node, type: typ });
  };
  visit(root, '');
  return Array.from(paths.values());
};

// ─────────────────────────────────────────────────────────────────────
// Name similarity — normalized Jaccard over tokens derived from paths.
// `price.amount` → [price, amount]; `priceAmount` → [price, amount];
// `product_name` → [product, name]; `name` → [name]
// ─────────────────────────────────────────────────────────────────────

const tokenize = (s) =>
  String(s || '')
    .replace(/\[\]/g, ' ')
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const SYNONYMS = {
  name: ['title', 'label'],
  title: ['name', 'label'],
  id: ['code', 'ref', 'uid', 'identifier'],
  amount: ['price', 'cost', 'rate', 'total', 'value'],
  price: ['amount', 'cost', 'rate', 'total'],
  currency: ['ccy', 'currencycode'],
  description: ['desc', 'summary', 'about', 'details'],
  image: ['photo', 'picture', 'img', 'thumbnail'],
  images: ['photos', 'pictures', 'gallery', 'thumbnails'],
  location: ['city', 'address', 'destination', 'place'],
  category: ['type', 'kind', 'class'],
  duration: ['length', 'time'],
  rating: ['score', 'stars', 'reviewscore'],
  raw: ['code', 'ref'],
};

const expand = (tokens) => {
  const out = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) syns.forEach((s) => out.add(s));
  }
  return out;
};

const similarity = (a, b) => {
  const ta = expand(tokenize(a));
  const tb = expand(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return inter / union;
};

// Type coherence — does the sample value look compatible with the target type?
const typeCompatible = (sampleType, targetType) => {
  if (!targetType) return true;
  if (targetType === 'string' || targetType === 'iso8601' || targetType === 'enum') return sampleType === 'string';
  if (targetType === 'number' || targetType === 'integer') return sampleType === 'number';
  if (targetType === 'boolean') return sampleType === 'boolean';
  if (targetType.endsWith('[]')) return true; // arrays collapse to leaf — accept
  return true;
};

// ─────────────────────────────────────────────────────────────────────
// Deterministic matcher — for each target, score every collected source
// path and pick the best above a minimum threshold.
// Returns { mappings: [{target, source, sample_value, confidence, via}], unmapped: [...] }
// ─────────────────────────────────────────────────────────────────────

export const deterministicMap = (sample, targets) => {
  const paths = collectPaths(sample);
  const mappings = [];
  const unmapped = [];
  for (const target of targets) {
    let best = null;
    for (const p of paths) {
      // tail of path weighs more than prefix (e.g. `data[].name` → `name` dominates)
      const tail = p.path.split('.').slice(-1)[0].replace(/\[\]/g, '');
      const scoreFull = similarity(p.path, target.path);
      const scoreTail = similarity(tail, target.path.split('.').slice(-1)[0]);
      const score = Math.max(scoreFull, scoreTail * 0.95);
      const compat = typeCompatible(p.type, target.type) ? 1 : 0.4;
      const finalScore = score * compat;
      if (!best || finalScore > best.score) {
        best = { score: finalScore, source: p.path, sample_value: p.sample };
      }
    }
    if (best && best.score >= 0.5) {
      mappings.push({
        target: target.path,
        source: best.source,
        sample_value: best.sample_value,
        confidence: best.score >= 0.75 ? 'HIGH' : 'MED',
        via: 'deterministic',
      });
    } else {
      unmapped.push(target);
    }
  }
  return { mappings, unmapped };
};

// ─────────────────────────────────────────────────────────────────────
// LLM gap-filler — asks Claude for source paths for remaining targets.
// Returns additional mappings; pairs not found come back as null.
// ─────────────────────────────────────────────────────────────────────

let anthropic = null;
const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
};

export const llmGapFill = async (sample, unmappedTargets, knowledgeContext = null) => {
  const client = getClient();
  if (!client || unmappedTargets.length === 0) return [];
  const targetSpec = unmappedTargets.map((t) => ({
    target: t.path,
    type: t.type,
    hint: t.hint || null,
    enum: t.enum || null,
  }));
  const ctxBlock = knowledgeContext ? `\nREFERENCE KNOWLEDGE (from past integrations — use as hints, not gospel):\n${knowledgeContext}\n` : '';
  const prompt = `You are a travel data integration expert. Given a sample response from a supplier API and a list of Canonical Travel Schema (CTS) targets, return the source path in the supplier response for each target.${ctxBlock}

Use JSONPath-style paths with [] for arrays (e.g. "data[].name", "products[].price.amount"). If a target is not present in the response, return null for that target.

RESPOND WITH A JSON OBJECT ONLY. No prose, no code fences.

Schema of response:
{
  "mappings": [
    { "target": "<cts target path>", "source": "<supplier path or null>" }
  ]
}

Sample supplier response:
\`\`\`json
${JSON.stringify(sample, null, 2).slice(0, 6000)}
\`\`\`

CTS targets to map:
\`\`\`json
${JSON.stringify(targetSpec, null, 2)}
\`\`\``;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content?.[0]?.text || '';
  let parsed;
  try {
    const clean = text.replace(/```(?:json)?/g, '').trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    log('warn', 'llm_parse_failed', { text: text.slice(0, 300) });
    return [];
  }
  const out = [];
  for (const m of parsed.mappings || []) {
    if (!m.source) continue;
    out.push({
      target: m.target,
      source: m.source,
      sample_value: resolveSampleValue(sample, m.source),
      confidence: 'LOW',
      via: 'llm',
    });
  }
  return out;
};

// Resolve a `a.b[].c` path against a sample for preview values.
const resolveSampleValue = (root, path) => {
  const parts = path.split('.');
  let cur = root;
  for (const part of parts) {
    if (cur == null) return null;
    const arrMatch = part.match(/^(.*?)\[\]$/);
    const key = arrMatch ? arrMatch[1] : part;
    if (key) cur = cur[key];
    if (arrMatch) cur = Array.isArray(cur) && cur.length ? cur[0] : null;
  }
  return cur;
};

// ─────────────────────────────────────────────────────────────────────
// Sandbox probe — authenticates and calls the supplier's search op with
// sandbox_search_params. Supports API_KEY, BEARER, BASIC, and
// OAUTH2_CLIENT_CREDENTIALS. HMAC variants require supplier-specific
// signing and return a clear "unsupported" error.
// ─────────────────────────────────────────────────────────────────────

const acquireToken = async (manifest, credentials) => {
  const tokenUrl = manifest.auth.token_url;
  if (!tokenUrl) throw new Error('token_url missing on manifest.auth');
  const res = await axios.post(
    tokenUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.client_id || '',
      client_secret: credentials.client_secret || '',
      ...(manifest.auth.scopes?.length ? { scope: manifest.auth.scopes.join(' ') } : {}),
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
      validateStatus: (s) => s >= 200 && s < 500,
    }
  );
  if (res.status >= 400) throw new Error(`token exchange failed: ${res.status}`);
  return res.data?.access_token || res.data?.token;
};

export const probe = async ({ manifest, credentials }) => {
  const authType = manifest.auth.type;
  const search = manifest.operations?.search;
  if (!search) throw new Error('operations.search missing on manifest');

  const base = manifest.supplier.base_url_sandbox || manifest.supplier.base_url_production;
  const url = `${String(base).replace(/\/+$/, '')}${search.endpoint}`;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const params = {};

  // Apply supplier-specific custom headers (e.g. Viator requires Accept version + Accept-Language)
  if (manifest.auth.custom_headers && typeof manifest.auth.custom_headers === 'object') {
    Object.assign(headers, manifest.auth.custom_headers);
  }

  if (authType === 'API_KEY') {
    const loc = manifest.auth.api_key_location || 'header';
    const name = manifest.auth.api_key_name || 'x-api-key';
    const val = credentials[Object.keys(credentials).find(k => credentials[k]) || 'api_key'] || '';
    if (loc === 'header') headers[name] = val;
    else if (loc === 'query' || loc === 'query_param') params[name] = val;
  } else if (authType === 'BEARER') {
    const token = credentials[Object.keys(credentials).find(k => credentials[k]) || 'bearer_token'] || '';
    headers.Authorization = `Bearer ${token}`;
  } else if (authType === 'BASIC') {
    const token = Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else if (authType === 'OAUTH2_CLIENT_CREDENTIALS') {
    const tok = await acquireToken(manifest, credentials);
    headers.Authorization = `Bearer ${tok}`;
  } else if (authType === 'HMAC_SHA256' || authType === 'UNKNOWN') {
    throw new Error(`auto-probe does not support ${authType} — use the manual mapping step`);
  } else {
    throw new Error(`unsupported auth type: ${authType}`);
  }

  const body = manifest.test_suite?.sandbox_search_params || {};
  const method = (search.method || 'POST').toUpperCase();
  if (method === 'GET' || method === 'DELETE') Object.assign(params, body);
  const res = await axios.request({
    url,
    method,
    headers,
    params,
    data: (method === 'GET' || method === 'DELETE') ? undefined : body,
    timeout: 20000,
    validateStatus: (s) => s >= 200 && s < 500,
  });
  if (res.status >= 400) {
    throw new Error(`sandbox probe returned ${res.status}: ${typeof res.data === 'string' ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200)}`);
  }
  return res.data;
};

// ─────────────────────────────────────────────────────────────────────
// Orchestrator — probe + deterministic + LLM. Caller passes cts_targets
// filtered to the selected type; we don't filter here.
// ─────────────────────────────────────────────────────────────────────

export const probeAndMatch = async ({ manifest, credentials, cts_targets }) => {
  const sample = await probe({ manifest, credentials });
  const { mappings: det, unmapped } = deterministicMap(sample, cts_targets);
  // Load category + similar-vendor knowledge to ground the LLM gap-fill.
  let knowledgeContext = null;
  try {
    const { loadCategoryKnowledge } = await import('../knowledge/category-knowledge.js');
    const { findSimilarVendors } = await import('../knowledge/vendor-knowledge.js');
    const category = manifest.cts_mapping?.type_value;
    const cat = await loadCategoryKnowledge(category);
    const similar = await findSimilarVendors({
      category,
      authType: manifest.auth?.type,
      excludeSlug: manifest.supplier?.slug,
      limit: 2,
    });
    const parts = [];
    if (cat?.knowledge_md) parts.push(`CATEGORY (${category}):\n${cat.knowledge_md.slice(0, 1500)}`);
    for (const s of similar) {
      parts.push(`SIMILAR VENDOR (${s.supplier_slug}):\n${JSON.stringify(s.knowledge_json, null, 2).slice(0, 800)}`);
    }
    if (parts.length) knowledgeContext = parts.join('\n\n');
  } catch (e) {
    log('warn', 'knowledge_load_failed', { error: e.message });
  }
  let llm = [];
  try {
    llm = await llmGapFill(sample, unmapped, knowledgeContext);
  } catch (e) {
    log('warn', 'llm_gapfill_failed', { error: e.message });
  }
  const filledTargets = new Set(llm.map((m) => m.target));
  const stillUnmapped = unmapped.filter((t) => !filledTargets.has(t.path)).map((t) => t.path);
  return {
    sample,
    mappings: [...det, ...llm],
    unmapped: stillUnmapped,
    counts: { deterministic: det.length, llm: llm.length, unmapped: stillUnmapped.length },
  };
};
