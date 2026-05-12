import axios from 'axios';
import YAML from 'yaml';
import Anthropic from '@anthropic-ai/sdk';

let _anthropic = null;
const getLLM = () => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
};

const stripHtml = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const LLM_SCHEMA_HINT = `{
  "supplier_name": "string",
  "inferred_category": "HOTEL|EXPERIENCE|TRANSFER|FLIGHT|RAIL|UNKNOWN",
  "base_url_sandbox": "string (full URL)",
  "base_url_production": "string (full URL) or null",
  "auth": {
    "auth_type": "API_KEY|HMAC_SHA256|OAUTH2_CLIENT_CREDENTIALS|OAUTH2_PASSWORD|BEARER|BASIC|UNKNOWN",
    "credential_fields": ["use the supplier's own names, e.g. consumer_key not api_key"],
    "token_url": "string or null",
    "api_key_location": "header|query or null",
    "api_key_name": "the query param or header name the API expects, e.g. apikey or x-api-key",
    "custom_headers": "object of extra headers required on every request, e.g. { \"Duffel-Version\": \"v2\" } or null"
  },
  "operations": {
    "search": { "method": "GET|POST", "endpoint": "/path" },
    "book":   { "method": "POST", "endpoint": "/path" },
    "cancel": { "method": "DELETE|POST", "endpoint": "/path" } | null,
    "detail": { "method": "GET", "endpoint": "/path/{id}" } | null
  },
  "test_suite": {
    "sandbox_search_params": { "key": "value pairs for a test search — use common tourism city like Barcelona or London" }
  },
  "notes": "one sentence summarising any quirks"
}`;

const DEFAULT_TEST_PARAMS = {
  EXPERIENCE: { city_name: 'Barcelona', text_search: 'tour', limit: 5 },
  HOTEL: { destination: 'Barcelona', checkin: '2026-06-01', checkout: '2026-06-03', adults: 2 },
  TRANSFER: { from: 'BCN', to: 'Barcelona', date: '2026-06-01', passengers: 2 },
  FLIGHT: { origin: 'LHR', destination: 'BCN', date: '2026-06-01', adults: 1 },
  RAIL: { origin: 'London', destination: 'Paris', date: '2026-06-01', adults: 1 },
};

// Known travel supplier API definitions — used as rich context when docs
// pages are JS-rendered and yield no scrapeable text.
const KNOWN_SUPPLIERS = [
  {
    pattern: /viator\.com/i,
    context: `VIATOR PARTNER API v2 — known integration profile:
Supplier: Viator (TripAdvisor experiences marketplace)
Category: EXPERIENCE
Base URL sandbox: https://api.sandbox.viator.com/partner
Base URL production: https://api.viator.com/partner
Auth: API_KEY via header "exp-api-key"
Required headers: Accept: application/json;version=2.0, Accept-Language: en

Operations:
- search: POST /products/search — body: { "filtering": { "destination": "732" }, "currency": "USD" }
- detail: GET /products/{productCode}
- availability: POST /availability/check — body: { "productCode": "...", "travelDate": "YYYY-MM-DD", "currency": "USD" }
- book: POST /bookings/book
- cancel: POST /bookings/cancel — body: { "bookingRef": "BR-..." }

Key endpoints (read-only, no auth required on sandbox):
- GET /products/tags — full category taxonomy
- GET /destinations — all destinations with IDs

Entity hierarchy: Product (productCode) → Attraction (attractionId) → Destination (destinationId) → Tag (tagId)
Test search params: { "filtering": { "destination": "732" }, "currency": "USD", "pagination": { "start": 1, "count": 5 } }
Note: destination 732 = Barcelona. API requires currency field on search. Accept header must include version=2.0.`,
  },
  {
    pattern: /bridgify\.(io|com)/i,
    context: `BRIDGIFY API — known integration profile:
Supplier: Bridgify (experience aggregator)
Category: EXPERIENCE
Auth: API_KEY via header "X-Api-Key"
Operations:
- search: GET /experiences/search
- detail: GET /experiences/{id}
- availability: GET /experiences/{id}/availability
- book: POST /bookings
- cancel: DELETE /bookings/{ref}`,
  },
  {
    pattern: /ticketmaster\.com/i,
    context: `TICKETMASTER DISCOVERY API v2 — known integration profile:
Supplier: Ticketmaster (events/concerts/shows marketplace)
Category: EXPERIENCE
Base URL sandbox: https://app.ticketmaster.com/discovery/v2
Base URL production: https://app.ticketmaster.com/discovery/v2
Auth: API_KEY via query parameter "apikey"
Response format: JSON, events nested in _embedded.events[]
Pagination: size param (default 5), page object with totalElements/totalPages/number

Operations:
- search: GET /events.json — params: keyword, countryCode, classificationName, geoPoint, radius, unit, size, startEndDateTime
- detail: GET /events/{id}.json
- No direct booking — Ticketmaster is discovery-only (link to ticketmaster.com for purchase)
- No cancel endpoint

Key endpoints:
- GET /events.json — search events
- GET /events/{id}.json — event detail
- GET /attractions.json — search attractions/artists
- GET /venues.json — search venues
- GET /classifications.json — category taxonomy

Event fields: name, id, url, dates.start.dateTime, priceRanges[].min/max/currency, _embedded.venues[], classifications[], images[]
Test search params: { "keyword": "concert", "countryCode": "US", "size": 5 }
Note: Discovery-only API. No booking/cancel endpoints — events link to ticketmaster.com for purchase. apikey is a query parameter, not a header.`,
  },
  {
    pattern: /duffel\.com/i,
    context: `DUFFEL FLIGHTS API — known integration profile:
Supplier: Duffel (flight aggregator — GDS + LCC connections)
Category: FLIGHT
Base URL sandbox: https://api.duffel.com
Base URL production: https://api.duffel.com
Auth: BEARER — header "Authorization: Bearer duffel_test_xxx" (test) or "Bearer duffel_xxx" (prod)
Required custom headers: Duffel-Version: v2, Accept: application/json, Content-Type: application/json
Response envelope: { "data": { ... } } — all responses wrapped in data key
Offers array at: data.offers[]

Operations:
- search: POST /air/offer_requests — body: { "data": { "passengers": [{"type":"adult"}], "slices": [{"origin":"LHR","destination":"JFK","departure_date":"2026-06-15"}], "cabin_class":"economy" } }
- detail: GET /air/offers/{id}
- book: POST /air/orders — body: { "data": { "selected_offers": ["off_xxx"], "passengers": [...], "payments": [{"type":"balance","amount":"125.00","currency":"gbp"}] } }
- cancel: POST /air/order_cancellations — body: { "data": { "order_id": "ord_xxx" } }

Key quirks:
- Same base URL for test and prod — token prefix (duffel_test_ vs duffel_) determines environment
- Offers expire in 15-30 minutes (check expires_at before booking)
- Order creation can take up to 120s — set HTTP timeout to 130s
- Rate limit: 120 req/60s
- Test mode uses "Duffel Airways" (IATA: ZZ) fake airline
Test search params: { "data": { "passengers": [{"type":"adult"}], "slices": [{"origin":"LHR","destination":"JFK","departure_date":"2026-07-15"}], "cabin_class":"economy" } }
Note: Full booking lifecycle in sandbox. Credential field is "access_token" (Bearer token from dashboard).`,
  },
  {
    pattern: /hotelbeds\.com/i,
    context: `HOTELBEDS API — known integration profile:
Supplier: HotelBeds (hotel + activity + transfer wholesaler)
Categories: HOTEL, EXPERIENCE, TRANSFER
Auth: HMAC_SHA256 — headers X-Api-Key, X-Signature (SHA256 of key+secret+timestamp), X-Timestamp
Hotels: POST /hotel-api/1.2/hotels (search), POST /hotel-api/1.2/checkrates, POST /hotel-api/1.2/bookings
Activities: GET /activity-api/1.0/activities (search), POST /activity-api/1.0/bookings
Transfers: GET /transfer-api/1.0/transfers/availability, POST /transfer-api/1.0/bookings`,
  },
];

const getKnownSupplierContext = (url) => {
  for (const s of KNOWN_SUPPLIERS) {
    if (s.pattern.test(url)) return s.context;
  }
  return null;
};

const CONTEXT7_BASE = 'https://context7.com/api';

const deriveSupplierName = (url) => {
  try {
    const host = new URL(url).hostname;
    const parts = host.replace(/^(docs|api|www|developer|developers)\./, '').split('.');
    return parts[0];
  } catch { return null; }
};

const context7Resolve = async (supplierName) => {
  if (!supplierName) return null;
  try {
    const apiKey = process.env.CONTEXT7_API_KEY;
    const headers = { Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await axios.get(`${CONTEXT7_BASE}/v2/libs/search`, {
      params: { libraryName: supplierName, query: `${supplierName} REST API integration` },
      timeout: 8000,
      headers,
    });
    const libs = res.data?.results || res.data || [];
    if (!Array.isArray(libs) || !libs.length) return null;
    const best = libs.find(l =>
      (l.title || l.name || '').toLowerCase().includes(supplierName.toLowerCase())
    ) || libs[0];
    return best.id || best.libraryId || null;
  } catch { return null; }
};

const context7Query = async (libraryId, query) => {
  if (!libraryId) return null;
  try {
    const apiKey = process.env.CONTEXT7_API_KEY;
    const headers = { Accept: 'text/plain' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await axios.get(`${CONTEXT7_BASE}/v2/context`, {
      params: { libraryId, query },
      timeout: 15000,
      headers,
    });
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return text && text.length > 100 ? text.slice(0, 16000) : null;
  } catch { return null; }
};

const cleanContext7Text = (raw) => {
  if (!raw || raw.length < 200) return raw;
  let text = raw;
  // Strip duplicate code examples — keep only cURL blocks, remove JS/Java/Node/Perl/Python/PHP/Ruby variants
  text = text.replace(/```(?:JavaScript|Java|Node\.js|Perl|Python|PHP|Ruby)\n[\s\S]*?```/g, '');
  // Collapse runs of blank lines
  text = text.replace(/\n{4,}/g, '\n\n');
  // Extract base URLs from code examples before they're lost
  const urlMatches = [...new Set(
    (raw.match(/https?:\/\/[a-z0-9.-]+(?:\/[a-z0-9._\-/{}]*)?/gi) || [])
      .filter(u => /api|discovery|mfx|commerce|v[12]/.test(u))
      .map(u => u.replace(/[?#].*$/, '').replace(/\/+$/, ''))
  )];
  if (urlMatches.length) {
    text = `BASE URLs found in documentation:\n${urlMatches.join('\n')}\n\n${text}`;
  }
  return text;
};

const CONTEXT7_API_QUERY = 'REST API base URL, authentication method, API key header or query parameter, search endpoint, detail endpoint, booking endpoint, cancel endpoint, response JSON schema, pagination';

const fetchContext7Docs = async (url) => {
  const name = deriveSupplierName(url);
  if (!name) return null;
  console.log(JSON.stringify({ level: 'info', event: 'context7_resolve', supplier: name }));
  const libraryId = await context7Resolve(name);
  if (!libraryId) {
    console.log(JSON.stringify({ level: 'debug', event: 'context7_no_match', supplier: name }));
    return null;
  }
  console.log(JSON.stringify({ level: 'info', event: 'context7_query', libraryId }));
  const docs = await context7Query(libraryId, CONTEXT7_API_QUERY);
  if (docs) {
    console.log(JSON.stringify({ level: 'info', event: 'context7_docs_found', libraryId, length: docs.length }));
  }
  return docs ? cleanContext7Text(docs) : null;
};

const loadGenericKnowledgeContext = async (category) => {
  try {
    const { loadCategoryKnowledge } = await import('../knowledge/category-knowledge.js');
    const categories = category ? [category] : ['HOTEL', 'EXPERIENCE', 'TRANSFER'];
    const parts = [];
    for (const c of categories) {
      const k = await loadCategoryKnowledge(c);
      if (k?.knowledge_md) parts.push(`CATEGORY (${c}):\n${k.knowledge_md.slice(0, 1200)}`);
    }
    return parts.join('\n\n') || null;
  } catch { return null; }
};

const llmAnalyze = async ({ url, rawText, partial, knowledgeContext }) => {
  const client = getLLM();
  if (!client) { console.log(JSON.stringify({ level: 'debug', event: 'llm_no_client' })); return null; }
  const context = String(rawText || '').slice(0, 18000);
  if (context.trim().length < 200) { console.log(JSON.stringify({ level: 'debug', event: 'llm_text_too_short', len: context.trim().length })); return null; }
  const knowledgeBlock = knowledgeContext
    ? `\nREFERENCE KNOWLEDGE (from prior integrations — hints, not gospel):\n${knowledgeContext}\n`
    : '';
  const prompt = `You are a travel API integration expert. Read the supplier documentation below and extract the fields needed to configure an integration.

RESPOND WITH JSON ONLY. No prose, no code fences.

Schema:
${LLM_SCHEMA_HINT}

Rules:
- Use values you can justify from the text. Use null for anything not stated.
- Never invent endpoints or auth types. If unsure, set the field to null or "UNKNOWN".
- credential_fields MUST use the supplier's own terminology from their docs/portal. If the supplier calls their API key "Consumer Key" or "Customer Key", use "consumer_key" — never normalize to a generic "api_key".
- Only classify as OAUTH2 or HMAC if the docs explicitly describe an OAuth token flow or HMAC signature generation. A supplier portal showing both a key and a secret does not imply OAuth — the secret may be for SDKs only.
- credential_fields should list only the credentials the REST API actually requires based on the documentation.

${knowledgeBlock}${partial ? `Deterministic analysis was partial. You are filling gaps. Known so far:\n${JSON.stringify(partial, null, 2)}\n\n` : ''}Supplier docs URL: ${url}

Docs text:
\`\`\`
${context}
\`\`\``;

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content?.[0]?.text || '';
    const clean = text.replace(/```(?:json)?/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return { _error: e.message };
  }
};

const OPENAPI_CANDIDATE_PATHS = ['openapi.yaml', 'openapi.json', 'swagger.yaml', 'swagger.json', 'api-docs.json',
  'api/openapi.json', 'api/swagger.json', 'v1/openapi.json', 'v2/openapi.json', 'docs/openapi.json', 'docs/swagger.json'];

const isLikelyOpenApi = (obj) => obj && typeof obj === 'object' && (obj.openapi || obj.swagger);

const parseMaybe = (text, contentType = '') => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed);
    }
    return YAML.parse(trimmed);
  } catch {
    try { return JSON.parse(trimmed); } catch {
      try { return YAML.parse(trimmed); } catch { return null; }
    }
  }
};

const fetchUrl = async (url) => {
  const res = await axios.get(url, {
    timeout: 15000,
    validateStatus: (s) => s >= 200 && s < 500,
    responseType: 'text',
    transformResponse: [(d) => d],
    headers: { 'User-Agent': 'TOS-IntegrationHub-Analyzer/1.0', 'Accept': 'application/json, application/yaml, text/yaml, text/plain, */*' },
  });
  return { status: res.status, data: typeof res.data === 'string' ? res.data : JSON.stringify(res.data || ''), contentType: res.headers['content-type'] || '' };
};

const resolveOpenApiUrl = async (rawUrl) => {
  const attempts = [];
  const direct = await fetchUrl(rawUrl);
  attempts.push({ url: rawUrl, status: direct.status });
  if (direct.status === 200) {
    const parsed = parseMaybe(direct.data, direct.contentType);
    if (isLikelyOpenApi(parsed)) return { spec: parsed, source_url: rawUrl, attempts, html: direct.data };
  }
  const base = rawUrl.replace(/\/+$/, '');
  for (const path of OPENAPI_CANDIDATE_PATHS) {
    const candidate = `${base}/${path}`;
    const r = await fetchUrl(candidate).catch(() => null);
    if (r) attempts.push({ url: candidate, status: r.status });
    if (r && r.status === 200) {
      const parsed = parseMaybe(r.data, r.contentType);
      if (isLikelyOpenApi(parsed)) return { spec: parsed, source_url: candidate, attempts, html: direct.data };
    }
  }
  return { spec: null, source_url: null, attempts, html: direct.data };
};

const detectAuth = (spec) => {
  const schemes = spec.components?.securitySchemes || spec.securityDefinitions || {};
  for (const [name, scheme] of Object.entries(schemes)) {
    if (scheme.type === 'oauth2') {
      const flows = scheme.flows || {};
      if (flows.clientCredentials) {
        return {
          auth_type: 'OAUTH2_CLIENT_CREDENTIALS',
          token_url: flows.clientCredentials.tokenUrl,
          scopes: Object.keys(flows.clientCredentials.scopes || {}),
          credential_fields: ['client_id', 'client_secret'],
          scheme_name: name,
        };
      }
      if (flows.password) {
        return {
          auth_type: 'OAUTH2_PASSWORD',
          token_url: flows.password.tokenUrl,
          credential_fields: ['client_id', 'client_secret', 'username', 'password'],
          scheme_name: name,
        };
      }
    }
    if (scheme.type === 'apiKey') {
      return {
        auth_type: 'API_KEY',
        credential_fields: ['api_key'],
        api_key_location: scheme.in,
        api_key_name: scheme.name,
        scheme_name: name,
      };
    }
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      return { auth_type: 'BEARER', credential_fields: ['bearer_token'], scheme_name: name };
    }
    if (scheme.type === 'http' && scheme.scheme === 'basic') {
      return { auth_type: 'BASIC', credential_fields: ['username', 'password'], scheme_name: name };
    }
  }
  return { auth_type: 'UNKNOWN', credential_fields: [] };
};

const classifyOperation = (path, method, op) => {
  const m = (method || '').toLowerCase();
  const p = (path || '').toLowerCase();
  const summary = ((op?.summary || '') + ' ' + (op?.operationId || '') + ' ' + (op?.description || '')).toLowerCase();
  const tags = (op?.tags || []).map((t) => String(t).toLowerCase());
  const hay = `${p} ${summary} ${tags.join(' ')}`;
  if (/auth|token|oauth/.test(hay) && m === 'post' && /token/.test(p)) return null;
  if (m === 'delete' && /book|reservation|order/.test(hay)) return 'cancel';
  if (m === 'post' && /book|reservation|order|checkout/.test(hay)) return 'book';
  if ((m === 'get' || m === 'post') && /search|list|availability|products|attractions|hotels|experiences/.test(hay)) {
    if (/availability/.test(hay)) return 'availability';
    if (!/\{.*?\}/.test(p)) return 'search';
    return 'detail';
  }
  if (m === 'get' && /\{.*?\}/.test(p) && /(product|attraction|hotel|experience|booking)/.test(hay)) return 'detail';
  return null;
};

const extractOperations = (spec) => {
  const paths = spec.paths || {};
  const ops = {};
  for (const [p, item] of Object.entries(paths)) {
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
      if (!item[method]) continue;
      const kind = classifyOperation(p, method, item[method]);
      if (!kind) continue;
      if (!ops[kind]) ops[kind] = { method: method.toUpperCase(), endpoint: p };
    }
  }
  return ops;
};

const inferCategory = (spec, url) => {
  const paths = Object.keys(spec.paths || {}).join(' ').toLowerCase();
  const tags = (spec.tags || []).map((t) => (t.name || '') + ' ' + (t.description || '')).join(' ').toLowerCase();
  const title = (spec.info?.title || '').toLowerCase();
  const hay = `${paths} ${tags} ${title} ${url.toLowerCase()}`;
  if (/experience|activit|attraction|tour|excursion|ticket|product/.test(hay)) return 'EXPERIENCE';
  if (/hotel|accommodation|lodging|room|property/.test(hay)) return 'HOTEL';
  if (/transfer|shuttle|pickup|chauffeur/.test(hay)) return 'TRANSFER';
  if (/flight|airline|itinerary|segment|airport/.test(hay)) return 'FLIGHT';
  if (/rail|train|journey/.test(hay)) return 'RAIL';
  return 'UNKNOWN';
};

const deriveName = (spec, url) => {
  if (spec.info?.title) return spec.info.title;
  try { return new URL(url).hostname.replace(/^(docs|api|www)\./, '').split('.')[0]; }
  catch { return 'unknown'; }
};

// Derive API base URL from a docs/marketing URL by stripping docs-like
// path segments and subdomains.  e.g.:
//   https://docs.bridgify.io/api#/       → https://api.bridgify.io
//   https://bridgify.readme.io/reference  → https://api.bridgify.io
//   https://api.supplier.com/docs         → https://api.supplier.com
const deriveApiBase = (docsUrl) => {
  try {
    const u = new URL(docsUrl);
    const host = u.hostname;
    // If hostname starts with 'docs.' or is on readme.io, try 'api.' variant
    const parts = host.split('.');
    const bases = [];
    if (parts[0] === 'docs' || parts[0] === 'developer' || parts[0] === 'developers') {
      bases.push(`${u.protocol}//api.${parts.slice(1).join('.')}`);
    }
    if (host.includes('readme.io')) {
      const brand = parts[0]; // e.g. 'bridgify' from bridgify.readme.io
      bases.push(`https://api.${brand}.io`, `https://api.${brand}.com`);
    }
    // Also try the docs host itself with /api prefix
    bases.push(`${u.protocol}//${host}`);
    return bases;
  } catch { return []; }
};

// Probe common API endpoints to discover structure. Similar to the TOS
// datasource_discovery.py `inspect_api()` approach: hit likely endpoints,
// check for auth hints in 401/403 responses, and if we get 200 inspect
// the response structure.
//
// Uses GET for read endpoints and also probes POST/DELETE on booking paths
// so the LLM can see which methods are supported.
const PROBE_PATHS = [
  // Read endpoints (GET)
  { path: '/', method: 'GET', role: 'root' },
  { path: '/attractions/products/', method: 'GET', role: 'search' },
  { path: '/products/', method: 'GET', role: 'search' },
  { path: '/experiences/', method: 'GET', role: 'search' },
  { path: '/experiences/search', method: 'GET', role: 'search' },
  { path: '/hotels/', method: 'GET', role: 'search' },
  { path: '/activities/', method: 'GET', role: 'search' },
  { path: '/activities', method: 'GET', role: 'search' },
  { path: '/search/', method: 'GET', role: 'search' },
  { path: '/api/v1/', method: 'GET', role: 'api_root' },
  { path: '/v1/', method: 'GET', role: 'api_root' },
  // Booking endpoints (POST) — 401/405 both confirm the endpoint exists
  { path: '/bookings/', method: 'POST', role: 'book' },
  { path: '/bookings', method: 'POST', role: 'book' },
  { path: '/orders/', method: 'POST', role: 'book' },
  { path: '/reservations/', method: 'POST', role: 'book' },
  { path: '/booking/', method: 'POST', role: 'book' },
  // Cancel endpoints (DELETE)
  { path: '/bookings/', method: 'DELETE', role: 'cancel' },
  { path: '/bookings', method: 'DELETE', role: 'cancel' },
  { path: '/orders/', method: 'DELETE', role: 'cancel' },
  { path: '/reservations/', method: 'DELETE', role: 'cancel' },
  // Availability (GET)
  { path: '/availability/', method: 'GET', role: 'availability' },
  { path: '/attractions/products/availability/', method: 'GET', role: 'availability' },
  // Auth / token endpoints
  { path: '/accounts/token/', method: 'POST', role: 'token' },
  { path: '/oauth/token', method: 'POST', role: 'token' },
  { path: '/auth/token', method: 'POST', role: 'token' },
  { path: '/token', method: 'POST', role: 'token' },
];

const probeApiEndpoints = async (docsUrl) => {
  const bases = deriveApiBase(docsUrl);
  const results = { bases_tried: [], endpoints: [], auth_hints: [] };
  for (const base of bases) {
    results.bases_tried.push(base);
    for (const { path, method, role } of PROBE_PATHS) {
      try {
        const fullUrl = `${base.replace(/\/+$/, '')}${path}`;
        const res = await axios.request({
          url: fullUrl,
          method,
          timeout: 5000,
          validateStatus: () => true,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          data: method !== 'GET' ? {} : undefined,
          maxRedirects: 2,
        });
        // 405 Method Not Allowed still confirms the path exists
        const entry = { base, path, method, role, status: res.status, exists: res.status !== 404 };
        if (res.status === 200 || res.status === 201) {
          const ct = res.headers['content-type'] || '';
          if (ct.includes('json') || ct.includes('text')) {
            const body = typeof res.data === 'string' ? res.data.slice(0, 500) : JSON.stringify(res.data).slice(0, 500);
            entry.response_preview = body;
            entry.is_json = ct.includes('json');
          }
        }
        if (res.status === 401 || res.status === 403) {
          const wwwAuth = res.headers['www-authenticate'] || '';
          const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
          if (/bearer/i.test(wwwAuth) || /bearer/i.test(body)) results.auth_hints.push('BEARER');
          if (/oauth/i.test(body) || /token/i.test(body) || /credentials/i.test(body)) results.auth_hints.push('OAUTH2');
          if (/api.key/i.test(body) || /x-api-key/i.test(body)) results.auth_hints.push('API_KEY');
          entry.auth_hint = true;
          entry.error_body = body.slice(0, 300);
        }
        if (res.status === 405) {
          entry.method_not_allowed = true;
        }
        results.endpoints.push(entry);
      } catch { /* timeout or network error — skip */ }
    }
    // If we got any non-404 responses from this base, don't try others
    if (results.endpoints.some((e) => e.base === base && e.status !== 404)) break;
  }
  return results;
};

const buildProbeContext = (probeResults) => {
  if (!probeResults.endpoints.length) return '';
  const lines = ['LIVE API PROBE RESULTS (from hitting the actual API):'];
  lines.push(`Bases tried: ${probeResults.bases_tried.join(', ')}`);
  // Group by existence — show discovered endpoints prominently
  const found = probeResults.endpoints.filter((e) => e.exists);
  const notFound = probeResults.endpoints.filter((e) => !e.exists);
  if (found.length) {
    lines.push('\nDISCOVERED ENDPOINTS (responded with non-404):');
    for (const ep of found) {
      let line = `  ${ep.method} ${ep.base}${ep.path} → HTTP ${ep.status} [role: ${ep.role}]`;
      if (ep.auth_hint) line += ' [AUTH REQUIRED - needs credentials]';
      if (ep.method_not_allowed) line += ' [405 METHOD NOT ALLOWED - path exists but wrong HTTP method]';
      if (ep.response_preview) line += `\n    Response: ${ep.response_preview.slice(0, 300)}`;
      lines.push(line);
    }
  }
  // Booking/cancel endpoints often return 404 without auth (hidden endpoints).
  // Flag these separately so the LLM knows they likely exist.
  const hiddenCandidates = notFound.filter((e) => ['book', 'cancel'].includes(e.role));
  const trueNotFound = notFound.filter((e) => !['book', 'cancel'].includes(e.role));
  if (hiddenCandidates.length) {
    lines.push('\nBOOKING/CANCEL PATHS (returned 404 — common: many APIs hide these without auth):');
    for (const ep of hiddenCandidates) {
      lines.push(`  ${ep.method} ${ep.base}${ep.path} → 404 [role: ${ep.role}] — likely exists but requires authentication`);
    }
  }
  if (trueNotFound.length) {
    lines.push(`\nNot found (404): ${trueNotFound.map((e) => `${e.method} ${e.path}`).join(', ')}`);
  }
  // Surface 401 error bodies — these often reveal the real auth mechanism
  const authEndpoints = found.filter((e) => e.error_body);
  if (authEndpoints.length) {
    lines.push('\nAUTH ERROR RESPONSES (raw 401/403 bodies — use these to determine the actual auth type):');
    for (const ep of authEndpoints) {
      lines.push(`  ${ep.method} ${ep.base}${ep.path}: ${ep.error_body}`);
    }
  }
  if (probeResults.auth_hints.length) {
    const hints = [...new Set(probeResults.auth_hints)];
    lines.push(`\nAuth signals detected: ${hints.join(', ')}`);
    if (hints.includes('OAUTH2')) {
      lines.push('IMPORTANT: The API gateway returned OAuth-related error codes (e.g. oauth.v2.*). This means the API uses an OAuth gateway even if the docs say "apikey". The credential the user needs is likely called "Consumer Key" or "Client Key" in the supplier portal.');
    }
  }
  // Help the LLM infer booking endpoints from discovered search endpoints
  const searchEndpoints = found.filter((e) => e.role === 'search');
  if (searchEndpoints.length && !found.some((e) => e.role === 'book')) {
    lines.push('\nIMPORTANT: A search endpoint was found but no booking endpoint responded.');
    lines.push('Travel APIs almost always have a booking endpoint. Common patterns:');
    lines.push('  - If search is GET /attractions/products/ → book is usually POST /bookings/ and cancel is DELETE /bookings/{ref}/');
    lines.push('  - If search is GET /hotels/ → book is POST /bookings/ and cancel is DELETE /bookings/{ref}/');
    lines.push('  - If search is GET /activities → book is POST /bookings and cancel is DELETE /bookings/{ref}');
    lines.push('  - Booking endpoints typically return 404 without auth credentials.');
    lines.push('Use the booking/cancel paths listed above if they match these patterns.');
  }
  lines.push('\nUse the DISCOVERED ENDPOINTS and BOOKING/CANCEL PATHS above to fill in the operations object. Match endpoint paths and HTTP methods to search/book/cancel/detail roles.');
  return lines.join('\n');
};

export { context7Resolve, context7Query, fetchContext7Docs, cleanContext7Text, CONTEXT7_API_QUERY };

const buildContext7Result = (llm, url, supplierNameHint) => {
  const category = llm.inferred_category || 'UNKNOWN';
  const testParams = llm.test_suite?.sandbox_search_params || DEFAULT_TEST_PARAMS[category] || { query: 'test', limit: 5 };
  const sandboxUrl = llm.base_url_sandbox || llm.base_url_production || null;
  const prodUrl = llm.base_url_production || llm.base_url_sandbox || null;
  const missing = [];
  if (!sandboxUrl) missing.push('base_url_sandbox');
  if (!llm.auth || llm.auth.auth_type === 'UNKNOWN') missing.push('auth');
  if (!llm.operations?.search) missing.push('operations.search');
  if (!llm.operations?.book) missing.push('operations.book');
  return {
    ok: true, mode: 'CONTEXT7_LLM', source_url: url,
    supplier_name: llm.supplier_name || supplierNameHint || 'unknown',
    inferred_category: category,
    base_url_sandbox: sandboxUrl,
    base_url_production: prodUrl,
    auth: llm.auth || { auth_type: 'UNKNOWN', credential_fields: [] },
    operations: llm.operations || {},
    test_suite: { sandbox_search_params: testParams },
    spec_version: null, paths_found: 0,
    confidence: missing.length === 0 ? 'HIGH' : missing.length <= 2 ? 'MEDIUM' : 'LOW',
    missing,
    llm_notes: llm.notes || null,
    source: { base_url_sandbox: 'context7+llm', auth: 'context7+llm', operations: 'context7+llm', inferred_category: 'llm' },
  };
};

const buildOpenApiResult = (spec, source_url, url, attempts, html) => {
  const auth = detectAuth(spec);
  const server = spec.servers?.[0]?.url || '';
  const operations = extractOperations(spec);
  const detectedCategory = inferCategory(spec, url);
  const missing = [];
  if (!server) missing.push('base_url');
  if (auth.auth_type === 'UNKNOWN') missing.push('auth_type');
  if (!operations.search) missing.push('operations.search');
  if (!operations.book) missing.push('operations.book');
  const absoluteTokenUrl = auth.token_url
    ? (auth.token_url.startsWith('http') ? auth.token_url : `${server.replace(/\/+$/, '')}${auth.token_url}`)
    : null;
  return {
    ok: true, mode: 'OPENAPI', source_url,
    supplier_name: deriveName(spec, url),
    inferred_category: detectedCategory,
    base_url_sandbox: server, base_url_production: server,
    auth: { ...auth, token_url: absoluteTokenUrl },
    operations,
    test_suite: { sandbox_search_params: DEFAULT_TEST_PARAMS[detectedCategory] || { query: 'test', limit: 5 } },
    spec_version: spec.openapi || spec.swagger,
    paths_found: Object.keys(spec.paths || {}).length,
    confidence: missing.length === 0 ? 'HIGH' : missing.length <= 2 ? 'MEDIUM' : 'LOW',
    missing,
    source: {
      base_url_sandbox: server ? 'deterministic' : null,
      auth: auth.auth_type !== 'UNKNOWN' ? 'deterministic' : null,
      operations: Object.keys(operations).length ? 'deterministic' : null,
      inferred_category: 'deterministic',
    },
  };
};

const mergeLlmIntoResult = (result, llm) => {
  result.mode = result.mode === 'OPENAPI' ? 'OPENAPI_LLM' : `${result.mode}_LLM`;
  result.llm_notes = llm.notes || null;
  if (!result.base_url_sandbox && (llm.base_url_sandbox || llm.base_url_production)) {
    result.base_url_sandbox = llm.base_url_sandbox || llm.base_url_production;
    result.base_url_production = llm.base_url_production || llm.base_url_sandbox;
    result.source.base_url_sandbox = 'llm';
  }
  if (result.auth?.auth_type === 'UNKNOWN' && llm.auth?.auth_type && llm.auth.auth_type !== 'UNKNOWN') {
    result.auth = { ...llm.auth };
    result.source.auth = 'llm';
  }
  for (const kind of ['search', 'book', 'cancel', 'detail', 'availability']) {
    if (!result.operations[kind] && llm.operations?.[kind]?.endpoint) {
      result.operations[kind] = llm.operations[kind];
      result.source.operations = result.source.operations === 'deterministic' ? 'mixed' : 'llm';
    }
  }
  const stillMissing = [];
  if (!result.base_url_sandbox) stillMissing.push('base_url');
  if (result.auth?.auth_type === 'UNKNOWN') stillMissing.push('auth_type');
  if (!result.operations.search) stillMissing.push('operations.search');
  if (!result.operations.book) stillMissing.push('operations.book');
  result.missing = stillMissing;
  result.confidence = stillMissing.length === 0 ? 'MEDIUM' : 'LOW';
};

export const analyzeDocs = async ({ url, context7Text = null, supplierNameHint = null }) => {
  // Context7-only path (no live URL available)
  if (context7Text && url?.startsWith('context7://')) {
    const knowledgeContext = await loadGenericKnowledgeContext(null);
    const combinedText = `CONTEXT7 DOCUMENTATION (high-quality, current):
IMPORTANT: Look for full base URLs in code examples (e.g. https://api.example.com/v2). The base_url_sandbox is the root URL before endpoint paths. If multiple base URLs exist, pick the primary REST API one.
Supplier name hint: ${supplierNameHint || 'unknown'}

${context7Text}`;
    console.log(JSON.stringify({ level: 'info', event: 'analyzer_context7_direct', len: context7Text.length, supplier: supplierNameHint }));
    const llm = await llmAnalyze({ url, rawText: combinedText, knowledgeContext });
    if (!llm || llm._error) {
      return { ok: false, mode: 'CONTEXT7_UNAVAILABLE', message: llm?._error || 'LLM could not extract integration definition from Context7 docs', attempts: [] };
    }
    return buildContext7Result(llm, url, supplierNameHint);
  }

  // Combined path: Context7 docs + live supplier docs URL
  if (context7Text && url && /^https?:\/\//i.test(url)) {
    console.log(JSON.stringify({ level: 'info', event: 'analyzer_combined', context7Len: context7Text.length, url, supplier: supplierNameHint }));
    const { spec, source_url, attempts, html } = await resolveOpenApiUrl(url);
    const liveText = spec ? JSON.stringify(spec.info || {}).slice(0, 3000) : stripHtml(html).slice(0, 6000);
    let probeContext = '';
    if (!spec) {
      try {
        const probeResults = await probeApiEndpoints(url);
        probeContext = buildProbeContext(probeResults);
      } catch { /* continue */ }
    }
    const knowledgeContext = await loadGenericKnowledgeContext(null);
    const combinedText = `CONTEXT7 DOCUMENTATION (structured API reference):
${context7Text.slice(0, 12000)}

---
LIVE SUPPLIER DOCUMENTATION (from ${url}):
${liveText}
${probeContext ? `\n${probeContext}` : ''}

IMPORTANT: Cross-reference both sources. The live docs may have auth details (OAuth, consumer keys) not in Context7. Use the supplier's own credential terminology.
Supplier name hint: ${supplierNameHint || 'unknown'}`;
    const llm = await llmAnalyze({ url, rawText: combinedText, knowledgeContext });
    if (spec && !llm?._error) {
      const detResult = buildOpenApiResult(spec, source_url, url, attempts, html);
      if (llm) mergeLlmIntoResult(detResult, llm);
      return detResult;
    }
    if (llm && !llm._error) {
      const result = buildContext7Result(llm, url, supplierNameHint);
      result.mode = 'COMBINED_LLM';
      result.source = { base_url_sandbox: 'combined+llm', auth: 'combined+llm', operations: 'combined+llm', inferred_category: 'llm' };
      return result;
    }
    // Fall through to standard URL-only analysis
  }

  if (!url || !/^https?:\/\//i.test(url)) throw new Error('valid http(s) url required');
  const { spec, source_url, attempts, html } = await resolveOpenApiUrl(url);

  if (!spec) {
    const cleaned = stripHtml(html);
    const textTooThin = cleaned.trim().length < 500;

    // Check if we recognise this supplier from the URL
    const knownContext = getKnownSupplierContext(url);

    // Try Context7 for rich API docs when we don't have a known supplier profile
    let context7Docs = null;
    if (!knownContext) {
      try { context7Docs = await fetchContext7Docs(url); } catch { /* continue without */ }
    }

    let probeContext = '';
    if (textTooThin && !knownContext && !context7Docs) {
      try {
        const probeResults = await probeApiEndpoints(url);
        probeContext = buildProbeContext(probeResults);
      } catch { /* probe failed — continue with what we have */ }
    }

    const combinedText = knownContext
      ? `${knownContext}\n\n---\nRaw docs text (may be JS-rendered noise):\n${cleaned.slice(0, 4000)}`
      : context7Docs
        ? `CONTEXT7 DOCUMENTATION (high-quality, current):\n${context7Docs}\n\n---\nRaw docs text:\n${cleaned.slice(0, 4000)}`
        : (textTooThin && probeContext ? `${cleaned}\n\n${probeContext}` : cleaned);

    const knowledgeContext = await loadGenericKnowledgeContext(null);
    console.log(JSON.stringify({ level: 'debug', event: 'analyzer_llm_input', textLen: combinedText.length, hasKnown: !!knownContext, hasContext7: !!context7Docs, hasProbe: !!probeContext }));
    const llm = await llmAnalyze({ url, rawText: combinedText, knowledgeContext });
    console.log(JSON.stringify({ level: 'debug', event: 'analyzer_llm_result', llm: llm ? Object.keys(llm) : null, base_url: llm?.base_url_sandbox || null, error: llm?._error || null }));
    if (!llm || llm._error || !llm.base_url_sandbox) {
      return {
        ok: false,
        mode: 'HTML_FALLBACK_UNAVAILABLE',
        message: llm?._error
          ? `LLM fallback failed: ${llm._error}`
          : 'Could not locate an OpenAPI/Swagger spec, and LLM fallback could not extract an integration definition. Paste a direct openapi.yaml/openapi.json link, or fill the wizard manually.',
        attempts,
      };
    }
    const category = llm.inferred_category || 'UNKNOWN';
    const testParams = llm.test_suite?.sandbox_search_params
      || DEFAULT_TEST_PARAMS[category]
      || { query: 'test', limit: 5 };
    return {
      ok: true,
      mode: knownContext ? 'KNOWN_SUPPLIER_LLM' : context7Docs ? 'CONTEXT7_LLM' : (textTooThin && probeContext ? 'API_PROBE_LLM' : 'LLM_HTML'),
      source_url: url,
      supplier_name: llm.supplier_name || deriveName({}, url),
      inferred_category: category,
      base_url_sandbox: llm.base_url_sandbox,
      base_url_production: llm.base_url_production || llm.base_url_sandbox,
      auth: llm.auth || { auth_type: 'UNKNOWN', credential_fields: [] },
      operations: llm.operations || {},
      test_suite: { sandbox_search_params: testParams },
      spec_version: null,
      paths_found: 0,
      confidence: knownContext ? 'HIGH' : context7Docs ? 'HIGH' : (probeContext ? 'MEDIUM' : 'LOW'),
      missing: [],
      llm_notes: llm.notes || null,
      source: { base_url_sandbox: context7Docs ? 'context7+llm' : 'llm', auth: context7Docs ? 'context7+llm' : 'llm', operations: context7Docs ? 'context7+llm' : 'llm', inferred_category: 'llm' },
    };
  }

  const result = buildOpenApiResult(spec, source_url, url, attempts, html);

  // LLM gap-fill when deterministic analysis is missing required pieces.
  if (result.missing.length > 0) {
    const knowledgeContext = await loadGenericKnowledgeContext(result.inferred_category);
    const llm = await llmAnalyze({ url, rawText: stripHtml(html) || JSON.stringify(spec.info || {}), partial: result, knowledgeContext });
    if (llm && !llm._error) {
      mergeLlmIntoResult(result, llm);
    }
  }

  return result;
};
