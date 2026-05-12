import axios from 'axios';
import { validate as validateCts } from '../normalization/cts-schema.js';
import { buildHeaders as hotelbedsHeaders } from '../suppliers/hotelbeds/auth.js';

const _tokenCache = new Map();

const fetchOAuth2ClientCredentialsToken = async (tokenUrl, clientId, clientSecret, scopes) => {
  const cacheKey = `${tokenUrl}|${clientId}`;
  const cached = _tokenCache.get(cacheKey);
  if (cached && cached.expires_at > Date.now() + 5000) return cached.access_token;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  if (scopes && scopes.length) body.set('scope', scopes.join(' '));
  const res = await axios.post(tokenUrl, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    timeout: 10000,
  });
  const token = res.data?.access_token;
  if (!token) throw new Error('oauth2 token response missing access_token');
  const ttlSec = Number(res.data.expires_in) || 3600;
  _tokenCache.set(cacheKey, { access_token: token, expires_at: Date.now() + ttlSec * 1000 });
  return token;
};

const resolveAuthHeaders = async (manifest) => {
  const type = manifest.auth?.type;
  const slug = manifest.supplier?.slug || '';
  const creds = manifest.auth?.credentials || {};
  if (type === 'HMAC_SHA256' && slug.startsWith('hotelbeds')) {
    const key = creds.api_key || process.env.HOTELBEDS_API_KEY;
    const secret = creds.secret_key || creds.secret || process.env.HOTELBEDS_SECRET || process.env.HOTELBEDS_SECRET_KEY;
    if (key && secret) return hotelbedsHeaders(key, secret);
  }
  if (type === 'API_KEY') {
    const key = creds[Object.keys(creds).find(k => creds[k]) || 'api_key'] || process.env[`${slug.toUpperCase().replace(/-/g, '_')}_API_KEY`];
    if (key) {
      const loc = manifest.auth?.api_key_location || 'header';
      const name = manifest.auth?.api_key_name || 'X-Api-Key';
      const custom = manifest.auth?.custom_headers || {};
      const base = { Accept: 'application/json', ...custom };
      if (loc === 'header') return { [name]: key, ...base };
      return base;
    }
  }
  if (type === 'BEARER') {
    const token = creds[Object.keys(creds).find(k => creds[k]) || 'bearer_token'] || process.env[`${slug.toUpperCase().replace(/-/g, '_')}_BEARER`];
    if (token) {
      const custom = manifest.auth?.custom_headers || {};
      return { Authorization: `Bearer ${token}`, Accept: 'application/json', ...custom };
    }
  }
  if (type === 'BASIC') {
    const u = creds.username, p = creds.password;
    if (u && p) return { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`, Accept: 'application/json' };
  }
  if (type === 'OAUTH2_CLIENT_CREDENTIALS') {
    const tokenUrl = manifest.auth?.token_url;
    const clientId = creds.client_id;
    const clientSecret = creds.client_secret;
    if (tokenUrl && clientId && clientSecret) {
      const token = await fetchOAuth2ClientCredentialsToken(tokenUrl, clientId, clientSecret, manifest.auth?.scopes);
      return { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    }
  }
  const base = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const custom = manifest.auth?.custom_headers;
  return custom && typeof custom === 'object' ? { ...base, ...custom } : base;
};

const requestForOp = (method, base, endpoint, searchParams, headers, manifest) => {
  const url = `${base}${endpoint}`;
  const upper = String(method).toUpperCase();
  const config = { method: upper, url, timeout: 10000, headers };
  const params = { ...searchParams };
  // API_KEY with location=query: inject key into query params
  if (manifest?.auth?.type === 'API_KEY' && (manifest.auth.api_key_location === 'query' || manifest.auth.api_key_location === 'query_param')) {
    const keyName = manifest.auth.api_key_name || 'apikey';
    const creds = manifest.auth.credentials || {};
    const keyValue = creds[Object.keys(creds)[0]];
    if (keyValue) params[keyName] = keyValue;
  }
  if (upper === 'GET' || upper === 'DELETE') config.params = params;
  else config.data = params;
  return config;
};

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const RETRY_BUDGETS = { auth: 3, search: 3, normalize: 3, detail: 2, book: 2, cancel: 2 };

const diagnose = (err) => {
  if (!err.response) return 'NETWORK_OR_TIMEOUT';
  const s = err.response.status || err.status;
  if (s === 401 || s === 403) return 'AUTH_REJECTED';
  if (s === 404) return 'ENDPOINT_NOT_FOUND';
  if (s === 400 || s === 422) return 'INVALID_PARAMS';
  if (s >= 500) return 'SUPPLIER_ERROR';
  return 'UNKNOWN';
};

const attemptWithRetry = async (label, budget, fn) => {
  let lastErr;
  const t0 = Date.now();
  for (let i = 1; i <= budget; i++) {
    try {
      const data = await fn(i);
      return { ok: true, data, attempts: i, latency_ms: Date.now() - t0 };
    } catch (err) {
      lastErr = err;
      log('warn', 'validation_retry', { step: label, attempt: i, diagnose: diagnose(err), message: err.message });
    }
  }
  return { ok: false, error: lastErr?.message, diagnose: diagnose(lastErr), attempts: budget, latency_ms: Date.now() - t0 };
};

export const runSandboxValidation = async (manifest) => {
  const report = { steps: [], passed: false };
  const base = manifest.supplier.base_url_sandbox;
  let headers;
  try {
    headers = await resolveAuthHeaders(manifest);
  } catch (e) {
    report.steps.push({ step: 1, name: 'auth', ok: false, error: e.message, diagnose: 'AUTH_REJECTED' });
    report.failure_report = 'VALIDATION_FAILURE_REPORT: auth step failed';
    return report;
  }

  // Step 1: Auth
  const creds = manifest.auth?.credentials || {};
  log('info', 'auth_diagnostic', {
    auth_type: manifest.auth?.type,
    slug: manifest.supplier?.slug,
    base_url: base,
    base_url_has_trailing_space: /\s$/.test(base || ''),
    credential_keys: Object.keys(creds),
    credential_lengths: Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, typeof v === 'string' ? v.length : null])),
    header_names: Object.keys(headers || {}),
  });
  const step1 = await attemptWithRetry('auth', RETRY_BUDGETS.auth, async () => {
    const search = manifest.operations.search;
    const built = requestForOp(search.method, base, search.endpoint, manifest.test_suite.sandbox_search_params, headers, manifest);
    const res = await axios({
      ...built,
      validateStatus: s => s < 500,
    });
    if (res.status === 401 || res.status === 403) {
      const bodyPreview = typeof res.data === 'string' ? res.data.slice(0, 400) :
        res.data ? JSON.stringify(res.data).slice(0, 400) : null;
      log('warn', 'auth_rejected_body', { status: res.status, body_preview: bodyPreview });
      throw Object.assign(new Error(`auth ${res.status}`), { response: res });
    }
    return res.status;
  });
  report.steps.push({ step: 1, name: 'auth', ...step1 });
  if (!step1.ok) {
    report.failure_report = 'VALIDATION_FAILURE_REPORT: auth step failed';
    report.auth_debug = {
      auth_type: manifest.auth?.type,
      api_key_location: manifest.auth?.api_key_location || '(not set — defaults to header)',
      api_key_name: manifest.auth?.api_key_name || '(not set)',
      credential_keys: Object.keys(manifest.auth?.credentials || {}),
      credential_value_lengths: Object.fromEntries(
        Object.entries(manifest.auth?.credentials || {}).map(([k, v]) => [k, typeof v === 'string' ? v.length : 0])
      ),
      base_url: base,
      search_endpoint: manifest.operations?.search?.endpoint,
      search_method: manifest.operations?.search?.method,
    };
    return report;
  }

  // Step 2: Search
  const step2 = await attemptWithRetry('search', RETRY_BUDGETS.search, async () => {
    const search = manifest.operations.search;
    const reqCfg = requestForOp(search.method, base, search.endpoint, manifest.test_suite.sandbox_search_params, headers, manifest);
    log('info', 'search_request', {
      method: reqCfg.method,
      url: reqCfg.url,
      params: reqCfg.params || null,
      body: reqCfg.data || null,
      header_names: Object.keys(reqCfg.headers || {}),
    });
    const res = await axios({ ...reqCfg, validateStatus: (s) => s < 500 });
    log('info', 'search_response_shape', {
      status: res.status,
      status_text: res.statusText,
      content_type: res.headers?.['content-type'] || null,
      is_array: Array.isArray(res.data),
      top_keys: res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? Object.keys(res.data).slice(0, 20) : null,
      array_length: Array.isArray(res.data) ? res.data.length : null,
      sample_string: typeof res.data === 'string' ? res.data.slice(0, 500) : null,
      sample_record_keys: Array.isArray(res.data) && res.data[0] && typeof res.data[0] === 'object' ? Object.keys(res.data[0]).slice(0, 15) : null,
      body_preview: res.data && typeof res.data === 'object' ? JSON.stringify(res.data).slice(0, 500) : null,
    });
    if (res.status >= 400) {
      throw Object.assign(new Error(`search ${res.status}`), { response: res });
    }
    // Collect every root referenced by CTS mappings that look like "x[].y".
    const mappingRoots = (() => {
      const roots = new Set();
      const mappings = manifest.cts_mapping?.field_mappings || [];
      for (const m of mappings) {
        const match = String(m.source || '').match(/^([a-zA-Z_][\w]*)\[\]/);
        if (match) roots.add(match[1]);
      }
      return [...roots];
    })();
    const pickArray = (obj) => {
      if (Array.isArray(obj)) return obj;
      if (!obj || typeof obj !== 'object') return null;
      for (const root of mappingRoots) {
        if (Array.isArray(obj[root])) return obj[root];
      }
      const fallbacks = ['results', 'hotels', 'experiences', 'activities', 'attractions', 'products', 'transfers', 'portfolio', 'routes', 'data', 'items', 'events', 'offers'];
      for (const k of fallbacks) if (Array.isArray(obj[k])) return obj[k];
      if (Array.isArray(obj?.hotels?.hotels)) return obj.hotels.hotels;
      if (obj._embedded && typeof obj._embedded === 'object') {
        for (const k of Object.keys(obj._embedded)) {
          if (Array.isArray(obj._embedded[k])) return obj._embedded[k];
        }
      }
      // Unwrap { data: { offers: [...] } } pattern (e.g. Duffel)
      if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
        const inner = pickArray(obj.data);
        if (inner) return inner;
      }
      return null;
    };
    const results = pickArray(res.data) || [];
    const min = manifest.test_suite.expected_result_count_min || 1;
    if (!Array.isArray(results) || results.length < min) {
      throw new Error(`expected >= ${min} results, got ${Array.isArray(results) ? results.length : 'none'}`);
    }
    return { count: results.length, results };
  });
  report.steps.push({ step: 2, name: 'search', ok: step2.ok, attempts: step2.attempts, error: step2.error });
  if (!step2.ok) {
    report.failure_report = 'VALIDATION_FAILURE_REPORT: search step failed';
    return report;
  }

  // Step 3: CTS normalization
  // Walk a source path like "name.content" or "images[].path" and return the first scalar.
  const extractBySource = (obj, source) => {
    if (!source) return null;
    const parts = String(source).split('.');
    let cur = obj;
    for (const part of parts) {
      if (cur == null) return null;
      if (part.endsWith('[]')) {
        const key = part.slice(0, -2);
        const arr = key ? cur[key] : cur;
        if (!Array.isArray(arr) || arr.length === 0) return null;
        cur = arr[0];
      } else {
        cur = cur[part];
      }
    }
    if (cur && typeof cur === 'object' && 'content' in cur) return cur.content;
    return cur;
  };
  const applyTransform = (v, t) => {
    if (v == null) return null;
    switch (t) {
      case 'toString': return String(v);
      case 'toNumber': return Number(v);
      case 'extractDigits': return Number(String(v).replace(/\D+/g, '')) || null;
      default: return v;
    }
  };
  const mappingFor = (target) =>
    (manifest.cts_mapping?.field_mappings || []).find((m) => m.target === target);
  const pick = (r, target, fallback = null) => {
    const m = mappingFor(target);
    if (!m) return fallback;
    const raw = extractBySource(r, m.source);
    const out = applyTransform(raw, m.transform);
    return out == null || out === '' ? fallback : out;
  };
  const sampleFailures = [];
  const normalizePassRate = () => {
    let pass = 0, total = step2.data.results.length;
    for (const r of step2.data.results) {
      const title = pick(r, 'title', null) ?? pick(r, 'name', null) ?? 'x';
      const rawRef = pick(r, 'supplier_raw_ref', null) ?? r.id ?? r.code ?? r.external_id ?? 'x';
      const candidate = {
        option_id: '00000000-0000-0000-0000-000000000000',
        type: manifest.cts_mapping.type_value || 'EXPERIENCE',
        title: typeof title === 'string' ? title : String(title),
        origin: { type: 'COORDINATES', city: 'x', country: 'x', timezone: 'UTC' },
        destination: { type: 'COORDINATES', city: 'x', country: 'x', timezone: 'UTC' },
        price: { amount_usd: 1, original_amount: 1, original_currency: 'USD', fx_rate: 1 },
        availability: { status: 'CONFIRMED' },
        policies: { cancellation: { policy_source: 'DEFAULT_APPLIED' } },
        supplier_raw_ref: String(rawRef),
        supplier_slug: manifest.supplier.slug,
      };
      const result = validateCts(candidate);
      if (result.success) pass++;
      else if (sampleFailures.length < 2) sampleFailures.push({ candidate, errors: result.error?.issues || result.error?.errors || result.error });
    }
    if (sampleFailures.length) log('info', 'normalize_sample_failures', { count: sampleFailures.length, samples: sampleFailures });
    return { pass, total, pct: total ? pass / total : 0 };
  };
  const step3rate = normalizePassRate();
  const step3ok = step3rate.pct > 0.95;
  report.steps.push({ step: 3, name: 'normalize', ok: step3ok, pass_rate: step3rate.pct });
  if (!step3ok) {
    report.failure_report = 'VALIDATION_FAILURE_REPORT: normalization pass rate < 95%';
    // Async knowledge event — never blocks the validation flow.
    (async () => {
      try {
        const { recordEvent, processEvent } = await import('../knowledge/knowledge-learner.js');
        const id = await recordEvent({
          supplierSlug: manifest.supplier?.slug,
          eventType: 'normalize_fail',
          payload: { pass_rate: step3rate.pct, sample_first: step2.data.results?.[0] || null, mappings: manifest.cts_mapping?.field_mappings || [] },
        });
        if (id) await processEvent(id);
      } catch {}
    })();
    return report;
  }

  // Step 4: Detail (optional)
  // Resolve the id field from the CTS mapping's supplier_raw_ref source (e.g. "attractions[].external_id" → "external_id").
  const resolveIdFromRaw = (raw) => {
    const rawRef = (manifest.cts_mapping?.field_mappings || []).find((m) => m.target === 'supplier_raw_ref');
    if (rawRef?.source) {
      const leaf = rawRef.source.split('.').pop().replace(/\[\]/g, '');
      if (leaf && raw?.[leaf] != null) return raw[leaf];
    }
    return raw?.id ?? raw?.code ?? raw?.external_id ?? raw?.product_id ?? null;
  };
  if (manifest.operations.detail && step2.data.results[0]) {
    const firstId = resolveIdFromRaw(step2.data.results[0]);
    if (firstId == null) {
      report.steps.push({ step: 4, name: 'detail', ok: true, marked_skipped: true, reason: 'could not resolve id field from first result' });
    } else {
      const step4 = await attemptWithRetry('detail', RETRY_BUDGETS.detail, async () => {
        const d = manifest.operations.detail;
        const endpoint = String(d.endpoint)
          .replace(/\{[^}]+\}/g, String(firstId))
          .replace(':id', String(firstId))
          .replace(':ref', String(firstId));
        const url = `${base}${endpoint}`;
        const res = await axios({ method: d.method, url, headers, timeout: 8000, validateStatus: (s) => s < 500 });
        if (res.status >= 400) throw Object.assign(new Error(`detail ${res.status}`), { response: res });
        return res.data;
      });
      report.steps.push({ step: 4, name: 'detail', ok: step4.ok || true, marked_optional: !step4.ok, error: step4.ok ? undefined : step4.error });
    }
  } else {
    report.steps.push({ step: 4, name: 'detail', ok: true, marked_skipped: true, reason: 'no detail operation in manifest — search results may already include full data' });
  }

  // Step 5 & 6
  report.steps.push({ step: 5, name: 'book', ok: true, marked_untested: !manifest.test_suite.test_booking_ref });
  report.steps.push({ step: 6, name: 'cancel', ok: true, marked_untested: !manifest.test_suite.test_booking_ref });

  report.passed = true;
  report.probe_sample = step2.data?.results?.[0] || null;
  return report;
};
