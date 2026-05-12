import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createOnboardSession,
  patchOnboardManifest,
  confirmOnboardSession,
  promoteOnboardSession,
  getOnboardSession,
  analyzeDocsUrl,
  analyzeByName,
  autoMapOnboardSession,
} from '../api/dashboard.js';
import {
  CTS_VERSION,
  CTS_TYPES,
  targetsForType,
  requiredTargetsForType,
} from '../constants/cts-targets.js';

const STEPS = [
  { key: 'identity', title: 'Supplier Identity', hint: 'Enter name — we auto-search for API documentation' },
  { key: 'docs', title: 'Documentation', hint: 'Review auto-detected docs or paste a URL manually' },
  { key: 'auth', title: 'Authentication', hint: 'Confirm auth type + credential fields' },
  { key: 'contract', title: 'API Contract', hint: 'Review detected operations' },
  { key: 'mapping', title: 'CTS Mapping', hint: 'Edit proposed field mapping table' },
  { key: 'test', title: 'Test Config', hint: 'Sandbox search params JSON' },
  { key: 'tenant', title: 'Tenant Config', hint: 'SLA tier + preferred categories' },
  { key: 'review', title: 'Review', hint: 'Full manifest summary + confirm' },
  { key: 'validation', title: 'Validation', hint: 'Live 6-step validation' },
];

const emptyManifest = () => ({
  manifest_version: '1.0',
  supplier: {
    name: '',
    slug: '',
    categories: [],
    base_url_sandbox: '',
    base_url_production: '',
    documentation_url: '',
    support_contact: '',
  },
  auth: {
    type: 'API_KEY',
    credential_fields: ['api_key'],
    credentials: {},
    signature_algorithm: null,
    signature_inputs: [],
  },
  operations: {
    search: { method: 'GET', endpoint: '', request_schema: {}, response_schema: {} },
    book:   { method: 'POST', endpoint: '' },
    cancel: { method: 'DELETE', endpoint: '' },
  },
  rate_limit_rpm: 500,
  response_format: 'JSON',
  supports_webhooks: false,
  cts_version: CTS_VERSION,
  cts_mapping: {
    type_value: '',
    field_mappings: [
      { target: 'supplier_raw_ref', source: '', transform: 'toString' },
    ],
    status_mappings: {},
    default_currency: 'USD',
  },
  execution_profile: {
    sync_operations: ['search', 'book'],
    async_operations: [],
    avg_response_time_ms: 800,
  },
  test_suite: {
    sandbox_search_params: {},
    expected_result_count_min: 1,
    test_booking_ref: null,
  },
  tenant_config: {
    tenant_id: '',
    sla_tier: 'ENTERPRISE',
    preferred_for_categories: [],
  },
});

const STEP_DISPLAY = [
  { n: 1, name: 'auth' },
  { n: 2, name: 'search' },
  { n: 3, name: 'normalize' },
  { n: 4, name: 'detail' },
  { n: 5, name: 'book' },
  { n: 6, name: 'cancel' },
];

function TestParamsEditor({ value, onCommit, onInvalid }) {
  const [draft, setDraft] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [err, setErr] = useState(null);
  useEffect(() => {
    setDraft(JSON.stringify(value ?? {}, null, 2));
  }, [value]);
  const commit = (text) => {
    try {
      const parsed = JSON.parse(text);
      setErr(null);
      onCommit(parsed);
    } catch (e) {
      setErr(e.message);
      onInvalid && onInvalid();
    }
  };
  return (
    <div className="text-sm">
      <span className="text-text-secondary">Sandbox search params (JSON)</span>
      <textarea rows={8}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        className="mt-1 block w-full font-mono text-xs rounded-btn border border-border-default px-3 py-2" />
      <div className="flex items-center justify-between mt-2">
        {err ? <span className="text-xs text-red-600">Invalid JSON: {err}</span> : <span className="text-xs text-text-secondary">Edits commit when you click outside the box or press Apply.</span>}
        <button type="button"
          onClick={() => commit(draft)}
          className="text-xs px-2 py-1 rounded-btn border border-border-default hover:bg-page-bg">
          Apply
        </button>
      </div>
    </div>
  );
}

export default function OnboardingWizard({ onClose, onProvisioned, existingSession = null }) {
  const [step, setStep] = useState(existingSession ? 7 : 0); // jump to Review when re-onboarding
  const [manifest, setManifest] = useState(() => existingSession?.manifest || emptyManifest());
  const [sessionId, setSessionId] = useState(existingSession?.session_id || null);
  const [status, setStatus] = useState(existingSession ? 'IN_PROGRESS' : 'DRAFT'); // DRAFT | IN_PROGRESS | VALIDATING | VALIDATED | FAILED | PROMOTED
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [docsUrl, setDocsUrl] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [autoMap, setAutoMap] = useState(null); // { sample, mappings, unmapped, counts }
  const [autoMapBusy, setAutoMapBusy] = useState(false);
  const [autoMapError, setAutoMapError] = useState(null);
  const pollTimer = useRef(null);

  // Built-in adapters in the hub — if the supplier matches one of these,
  // the onboarded slug MUST be the canonical value so sync workers,
  // inventory adapters, and credential storage all line up.
  const KNOWN_ADAPTERS = [
    { slug: 'bridgify',             match: /bridg/i },
    { slug: 'hotelbeds-hotels',     match: /hotelbeds.*hotel|hotel.*hotelbeds/i },
    { slug: 'hotelbeds-activities', match: /hotelbeds.*(activ|experience|attraction)/i },
    { slug: 'hotelbeds-transfers',  match: /hotelbeds.*transfer/i },
  ];
  const canonicalSlugFor = (name, hostHint = '') => {
    const hay = `${name || ''} ${hostHint}`;
    const hit = KNOWN_ADAPTERS.find((k) => k.match.test(hay));
    return hit?.slug || null;
  };

  const applyAnalysis = (a) => {
    if (!a || !a.ok) return;
    const canonical = canonicalSlugFor(a.supplier_name, a.base_url_sandbox || a.base_url_production || '');
    const derived = (a.supplier_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new-supplier';
    const slug = canonical || derived;
    if (canonical) {
      console.info(`[onboarding] supplier matches built-in adapter — forcing slug "${canonical}" (LLM suggested "${derived}")`);
    }
    const credential_fields = a.auth?.credential_fields || [];
    const credentials = Object.fromEntries(credential_fields.map((f) => [f, '']));
    const category = a.inferred_category && a.inferred_category !== 'UNKNOWN' ? a.inferred_category : null;
    setManifest((m) => ({
      ...m,
      supplier: {
        ...m.supplier,
        name: a.supplier_name || m.supplier.name,
        slug,
        categories: category ? [category] : m.supplier.categories,
        base_url_sandbox: a.base_url_sandbox || m.supplier.base_url_sandbox,
        base_url_production: a.base_url_production || m.supplier.base_url_production,
        documentation_url: docsUrl || a.source_url || m.supplier.documentation_url,
      },
      cts_mapping: {
        ...m.cts_mapping,
        type_value: category || m.cts_mapping.type_value,
        field_mappings: m.cts_mapping.field_mappings,
      },
      tenant_config: {
        ...m.tenant_config,
        preferred_for_categories: category ? [category] : m.tenant_config.preferred_for_categories,
      },
      auth: {
        type: a.auth?.auth_type || m.auth.type,
        credential_fields,
        credentials,
        token_url: a.auth?.token_url || null,
        scopes: a.auth?.scopes || [],
        api_key_location: a.auth?.api_key_location,
        api_key_name: a.auth?.api_key_name,
        custom_headers: a.auth?.custom_headers || m.auth.custom_headers || null,
      },
      operations: {
        ...m.operations,
        ...(a.operations?.search ? { search: a.operations.search } : {}),
        ...(a.operations?.detail ? { detail: a.operations.detail } : {}),
        ...(a.operations?.book ? { book: a.operations.book } : {}),
        ...(a.operations?.cancel ? { cancel: a.operations.cancel } : {}),
        ...(a.operations?.availability ? { availability: a.operations.availability } : {}),
      },
      ...(a.test_suite?.sandbox_search_params && Object.keys(a.test_suite.sandbox_search_params).length
        ? { test_suite: { ...m.test_suite, sandbox_search_params: a.test_suite.sandbox_search_params } }
        : {}),
    }));
  };

  const runAutoMap = async () => {
    if (!sessionId) {
      setAutoMapError('Session not yet created — advance past a previous step first.');
      return;
    }
    setAutoMapBusy(true); setAutoMapError(null); setAutoMap(null);
    try {
      await patchOnboardManifest(sessionId, manifest);
      const r = await autoMapOnboardSession(sessionId, {
        credentials: manifest.auth.credentials || {},
        type_value: manifest.cts_mapping.type_value || manifest.supplier.categories?.[0] || '',
      });
      setAutoMap(r);
    } catch (e) {
      setAutoMapError(e?.response?.data?.error || e.message);
    } finally { setAutoMapBusy(false); }
  };

  const acceptAutoMap = () => {
    if (!autoMap) return;
    const existing = manifest.cts_mapping.field_mappings || [];
    const merged = [...existing];
    for (const m of autoMap.mappings) {
      const idx = merged.findIndex((x) => x.target === m.target);
      const row = { target: m.target, source: m.source, transform: null };
      if (idx >= 0) merged[idx] = row; else merged.push(row);
    }
    patchField('cts_mapping.field_mappings', merged);
    setAutoMap(null);
  };

  const runAnalyze = async () => {
    setBusy(true); setError(null); setAnalysis(null);
    try {
      const r = await analyzeDocsUrl(docsUrl);
      setAnalysis(r);
      if (r.ok) applyAnalysis(r);
      else setError(r.message || 'Could not analyze documentation');
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally { setBusy(false); }
  };

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  const current = STEPS[step];

  const patchField = (path, value) => {
    setManifest((m) => {
      const keys = path.split('.');
      const next = { ...m };
      let cursor = next;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        const existing = cursor[k];
        cursor[k] = Array.isArray(existing) ? [...existing] : { ...(existing || {}) };
        cursor = cursor[k];
      }
      cursor[keys[keys.length - 1]] = value;
      return next;
    });
    setReport((r) => (r?.manifest_errors ? { ...r, manifest_errors: null } : r));
  };

  const savePartial = async () => {
    if (!sessionId) return;
    try { await patchOnboardManifest(sessionId, manifest); } catch (e) { /* swallow; final confirm will fail loudly */ }
  };

  const [nameLookupDone, setNameLookupDone] = useState(false);

  const runNameLookup = async () => {
    const name = manifest.supplier.name?.trim();
    if (!name || name.length < 2) return;
    setBusy(true); setError(null); setAnalysis(null);
    try {
      const r = await analyzeByName(name);
      setAnalysis(r);
      if (r.ok) applyAnalysis(r);
      setNameLookupDone(true);
    } catch (e) {
      setNameLookupDone(true);
    } finally { setBusy(false); }
  };

  const goNext = async () => {
    if (current.key === 'identity' && !nameLookupDone) {
      await runNameLookup();
      setStep((s) => s + 1);
      return;
    }
    if (current.key === 'identity') {
      setStep((s) => s + 1);
      return;
    }
    if (current.key === 'docs') {
      setStep((s) => s + 1);
      return;
    }
    if (!sessionId) {
      setBusy(true); setError(null);
      try {
        const r = await createOnboardSession(manifest);
        setSessionId(r.session_id);
        setStatus('IN_PROGRESS');
      } catch (e) {
        setError(e?.response?.data?.error || e.message);
        setBusy(false); return;
      }
      setBusy(false);
    } else {
      savePartial();
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const runConfirm = async () => {
    setBusy(true); setError(null); setReport(null); setStatus('VALIDATING');
    setStep(STEPS.length - 1);
    try {
      await patchOnboardManifest(sessionId, manifest);
      const pollAndDecide = async () => {
        try {
          const s = await getOnboardSession(sessionId);
          if (s.validation_report) setReport(s.validation_report);
          if (s.status === 'VALIDATED' || s.status === 'FAILED' || s.status === 'PROMOTED') {
            if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
            setStatus(s.status);
            if (s.status === 'VALIDATED') {
              try {
                const pr = await promoteOnboardSession(sessionId);
                setStatus('PROMOTED');
                if (onProvisioned) onProvisioned(pr);
              } catch (e) {
                setError(e?.response?.data?.error || e.message);
                setStatus('FAILED');
              }
            }
            setBusy(false);
          }
        } catch { /* keep polling */ }
      };
      try {
        const c = await confirmOnboardSession(sessionId);
        if (c.report) setReport(c.report);
        setStatus(c.status);
        if (c.status === 'VALIDATED') {
          const pr = await promoteOnboardSession(sessionId);
          setStatus('PROMOTED');
          if (onProvisioned) onProvisioned(pr);
          setBusy(false);
          return;
        }
        if (c.status === 'FAILED') { setBusy(false); return; }
      } catch (e) {
        // Fall back to polling (long-running validation)
        const body = e?.response?.data;
        if (body?.status === 'FAILED') {
          setReport({ manifest_errors: body.manifest_errors });
          setStatus('FAILED');
          setBusy(false);
          return;
        }
      }
      pollTimer.current = setInterval(pollAndDecide, 3000);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
      setStatus('FAILED');
      setBusy(false);
    }
  };

  const fixAndRetry = () => {
    setStatus('IN_PROGRESS');
    setReport(null);
    setError(null);
    setStep(4); // CTS Mapping
  };

  // Target-first mapping: one row per applicable CTS target from /CTS_SPEC.md.
  // User supplies the source path for each target. Unknown/custom targets can
  // be added at the bottom.
  const getSourceFor = (targetPath) => {
    const row = (manifest.cts_mapping.field_mappings || []).find((m) => m.target === targetPath);
    return row?.source || '';
  };
  const getTransformFor = (targetPath) => {
    const row = (manifest.cts_mapping.field_mappings || []).find((m) => m.target === targetPath);
    return row?.transform || '';
  };
  const setMapping = (targetPath, source, transform) => {
    const arr = [...(manifest.cts_mapping.field_mappings || [])];
    const idx = arr.findIndex((m) => m.target === targetPath);
    const cleanSource = (source || '').trim();
    const cleanTransform = (transform || '').trim();
    if (!cleanSource && !cleanTransform) {
      if (idx >= 0) arr.splice(idx, 1);
    } else if (idx >= 0) {
      arr[idx] = { ...arr[idx], source: cleanSource, transform: cleanTransform || null };
    } else {
      arr.push({ target: targetPath, source: cleanSource, transform: cleanTransform || null });
    }
    patchField('cts_mapping.field_mappings', arr);
  };

  const renderTargetRow = (target) => {
    const source = getSourceFor(target.path);
    const transform = getTransformFor(target.path);
    const missing = target.required && !source;
    const err = fieldError('cts_mapping.field_mappings');
    const rowCls = missing ? 'bg-danger/5 border-danger/40' : err && !source ? 'border-warning/40' : 'border-border-default';
    return (
      <div key={target.path} className={`grid grid-cols-[1.3fr_1.5fr_110px] gap-2 items-start border rounded-btn px-2 py-2 ${rowCls}`}>
        <div className="min-w-0">
          <div className="font-mono text-xs text-primary truncate" title={target.path}>{target.path}</div>
          <div className="text-[10px] text-text-secondary flex gap-1 mt-0.5">
            <span className="uppercase">{target.type}</span>
            {target.required && <span className="text-danger font-medium">required</span>}
            {!target.required && <span>optional</span>}
            {target.applies_to !== '*' && <span className="text-accent">{target.applies_to.join(',')}</span>}
          </div>
          {target.hint && <div className="text-[10px] text-text-secondary italic mt-0.5">{target.hint}</div>}
          {target.enum && <div className="text-[10px] text-text-secondary mt-0.5">values: {target.enum.join(' · ')}</div>}
        </div>
        <input
          value={source}
          placeholder="supplier source path (e.g. data[].id)"
          onChange={(e) => setMapping(target.path, e.target.value, transform)}
          className="border border-border-default rounded-btn px-2 py-1 font-mono text-xs"
        />
        <input
          value={transform}
          placeholder="transform"
          onChange={(e) => setMapping(target.path, source, e.target.value)}
          className="border border-border-default rounded-btn px-2 py-1 font-mono text-xs"
        />
      </div>
    );
  };

  const renderCustomRows = () => {
    const knownTargets = new Set(targetsForType(manifest.cts_mapping.type_value).map((t) => t.path));
    const customs = (manifest.cts_mapping.field_mappings || []).filter((m) => !knownTargets.has(m.target));
    if (customs.length === 0) return null;
    return (
      <div className="space-y-2 pt-2 border-t border-border-default">
        <div className="text-xs uppercase text-text-secondary">Custom / unknown targets</div>
        {customs.map((m, i) => (
          <div key={`c-${i}`} className="grid grid-cols-[1fr_1fr_110px_28px] gap-2">
            <input value={m.target} placeholder="target path"
              onChange={(e) => {
                const arr = [...manifest.cts_mapping.field_mappings];
                const globalIdx = arr.findIndex((x) => x.target === m.target);
                arr[globalIdx] = { ...arr[globalIdx], target: e.target.value };
                patchField('cts_mapping.field_mappings', arr);
              }}
              className="border border-border-default rounded-btn px-2 py-1 font-mono text-xs" />
            <input value={m.source} placeholder="source path"
              onChange={(e) => {
                const arr = [...manifest.cts_mapping.field_mappings];
                const globalIdx = arr.findIndex((x) => x.target === m.target);
                arr[globalIdx] = { ...arr[globalIdx], source: e.target.value };
                patchField('cts_mapping.field_mappings', arr);
              }}
              className="border border-border-default rounded-btn px-2 py-1 font-mono text-xs" />
            <input value={m.transform || ''} placeholder="transform"
              onChange={(e) => {
                const arr = [...manifest.cts_mapping.field_mappings];
                const globalIdx = arr.findIndex((x) => x.target === m.target);
                arr[globalIdx] = { ...arr[globalIdx], transform: e.target.value || null };
                patchField('cts_mapping.field_mappings', arr);
              }}
              className="border border-border-default rounded-btn px-2 py-1 font-mono text-xs" />
            <button type="button" className="text-danger"
              onClick={() => {
                const arr = manifest.cts_mapping.field_mappings.filter((x) => x.target !== m.target);
                patchField('cts_mapping.field_mappings', arr);
              }}>×</button>
          </div>
        ))}
      </div>
    );
  };

  const fieldError = (pathPrefix, idx) => {
    const errs = report?.manifest_errors;
    if (!Array.isArray(errs)) return null;
    return errs.find((e) => Array.isArray(e.path) && e.path.join('.').startsWith(pathPrefix) && (idx == null || e.path.includes(idx)));
  };

  return (
    <>
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-40">
      <div className="bg-card-bg rounded-card shadow-md w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-border-default flex items-center justify-between">
          <div>
            <div className="text-xs text-text-secondary">Step {step + 1} of {STEPS.length}</div>
            <h3 className="text-lg font-semibold text-primary">{current.title}</h3>
            <div className="text-xs text-text-secondary">{current.hint}</div>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-danger text-lg leading-none">×</button>
        </div>

        <div className="p-5">
          <div className="flex items-center mb-4 gap-1" data-testid="wizard-progress">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-2 flex-1 rounded-full ${i <= step ? 'bg-accent' : 'bg-border-default'}`} />
            ))}
          </div>

          {error && <div className="mb-3 text-sm text-danger">{error}</div>}

          {current.key === 'identity' && (
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-text-secondary">Supplier name</span>
                <input value={manifest.supplier.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    patchField('supplier.name', name);
                    if (!manifest.supplier.slug || manifest.supplier.slug === manifest.supplier.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) {
                      patchField('supplier.slug', name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
                    }
                  }}
                  placeholder="e.g. Ticketmaster, StubHub, GetYourGuide"
                  className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2" />
              </label>
              <label className="block">
                <span className="text-text-secondary">Slug (auto-generated)</span>
                <input value={manifest.supplier.slug}
                  onChange={(e) => patchField('supplier.slug', e.target.value)}
                  className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2 font-mono text-xs" />
              </label>
              <div className="text-xs text-text-secondary bg-page-bg rounded-btn px-3 py-2">
                When you click Next, we'll automatically search for API documentation matching this supplier name. No docs URL needed.
              </div>
              {busy && (
                <div className="flex items-center gap-2 text-sm text-accent">
                  <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  Searching for {manifest.supplier.name} API documentation...
                </div>
              )}
            </div>
          )}

          {current.key === 'docs' && (
            <div className="space-y-3 text-sm">
              {analysis && analysis.ok && (
                <div className="border border-emerald-200 rounded-btn p-3 space-y-2 bg-emerald-50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-emerald-800">Auto-detected from documentation</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      analysis.confidence === 'HIGH' ? 'bg-success text-white' :
                      analysis.confidence === 'MEDIUM' ? 'bg-warning text-white' : 'bg-danger text-white'
                    }`}>{analysis.confidence} confidence</span>
                  </div>
                  <div className="text-xs text-text-secondary">
                    Source: {analysis.mode?.replace('CONTEXT7_', 'AUTO_')}{analysis.context7_library ? ` (${analysis.context7_library})` : ''}
                    {analysis.paths_found > 0 && <> · {analysis.paths_found} paths</>}
                    {analysis.inferred_category && analysis.inferred_category !== 'UNKNOWN' && (
                      <> · Category: <span className="font-mono text-accent">{analysis.inferred_category}</span></>
                    )}
                  </div>
                  <div className="text-xs"><span className="text-text-secondary">Base URL:</span> <span className="font-mono">{manifest.supplier.base_url_sandbox}</span></div>
                  <div className="text-xs"><span className="text-text-secondary">Auth:</span> <span className="font-mono">{analysis.auth?.auth_type}</span></div>
                  {analysis.auth?.token_url && (
                    <div className="text-xs"><span className="text-text-secondary">Token URL:</span> <span className="font-mono">{analysis.auth.token_url}</span></div>
                  )}
                  <div className="text-xs">
                    <span className="text-text-secondary">Credentials needed:</span>{' '}
                    {analysis.auth?.credential_fields?.length
                      ? analysis.auth.credential_fields.map((f) => <span key={f} className="inline-block font-mono bg-white border border-border-default rounded px-1.5 mr-1">{f}</span>)
                      : <span className="text-text-secondary">none detected</span>}
                  </div>
                  <div className="text-xs">
                    <span className="text-text-secondary">Operations detected:</span>{' '}
                    {Object.keys(analysis.operations || {}).length
                      ? Object.keys(analysis.operations).join(', ')
                      : <span className="text-text-secondary">none</span>}
                  </div>
                  {analysis.llm_notes && <div className="text-xs text-text-secondary italic">{analysis.llm_notes}</div>}
                  {analysis.missing?.length > 0 && (
                    <div className="text-xs text-warning">Missing: {analysis.missing.join(', ')} — fill in later steps.</div>
                  )}
                  <div className="text-xs text-text-secondary border-t border-emerald-200 pt-2 mt-1">
                    These are auto-detected defaults. You can change auth type, credentials, and operations in the next steps.
                  </div>
                </div>
              )}

              {analysis && !analysis.ok && (
                <div className="text-xs text-amber-600 bg-amber-50 rounded-btn px-3 py-2">
                  {analysis.message || 'No docs found automatically.'} Paste a docs URL below or skip and fill the wizard manually.
                </div>
              )}

              {!analysis && (
                <div className="text-xs text-text-secondary bg-page-bg rounded-btn px-3 py-2">
                  No documentation was found automatically. Paste a docs URL below, or skip and fill manually.
                </div>
              )}

              {(!analysis || !analysis.ok) && (
                <>
                  <label className="block">
                    <span className="text-text-secondary">Supplier docs or OpenAPI spec URL</span>
                    <input
                      value={docsUrl}
                      onChange={(e) => setDocsUrl(e.target.value)}
                      placeholder="https://developer.supplier.com or openapi.yaml link"
                      className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={runAnalyze}
                    disabled={busy || !docsUrl}
                    className="rounded-btn bg-accent text-white px-4 py-2 text-sm disabled:opacity-50"
                  >{busy ? 'Analyzing…' : 'Analyze'}</button>
                </>
              )}

              {analysis?.ok && (
                <details className="text-xs">
                  <summary className="text-text-secondary cursor-pointer hover:text-accent">Re-analyze with a different docs URL</summary>
                  <div className="mt-2 space-y-2">
                    <input
                      value={docsUrl}
                      onChange={(e) => setDocsUrl(e.target.value)}
                      placeholder="https://developer.supplier.com or openapi.yaml link"
                      className="block w-full rounded-btn border border-border-default px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={runAnalyze}
                      disabled={busy || !docsUrl}
                      className="rounded-btn bg-accent text-white px-3 py-1.5 text-xs disabled:opacity-50"
                    >{busy ? 'Analyzing…' : 'Re-analyze'}</button>
                  </div>
                </details>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border-default">
                <label className="block">
                  <span className="text-text-secondary text-xs">Sandbox base URL</span>
                  <input value={manifest.supplier.base_url_sandbox}
                    onChange={(e) => patchField('supplier.base_url_sandbox', e.target.value.trim())}
                    className="mt-1 block w-full rounded-btn border border-border-default px-2 py-1.5 text-xs font-mono" />
                </label>
                <label className="block">
                  <span className="text-text-secondary text-xs">Production base URL</span>
                  <input value={manifest.supplier.base_url_production}
                    onChange={(e) => patchField('supplier.base_url_production', e.target.value.trim())}
                    className="mt-1 block w-full rounded-btn border border-border-default px-2 py-1.5 text-xs font-mono" />
                </label>
              </div>
            </div>
          )}

          {current.key === 'auth' && (
            <div className="space-y-3 text-sm">
              {analysis?.ok && analysis.auth?.auth_type && (
                <div className="text-xs bg-accent/10 text-accent rounded-btn px-3 py-2">
                  Auto-detected: <span className="font-mono">{analysis.auth.auth_type}</span>
                  {analysis.auth.token_url && <> · token URL: <span className="font-mono">{analysis.auth.token_url}</span></>}
                </div>
              )}
              {manifest.auth.type === 'API_KEY' && manifest.auth.credential_fields.length === 1 && (
                <div className="text-xs bg-amber-50 text-amber-700 rounded-btn px-3 py-2">
                  If your supplier portal gave you both a <strong>key</strong> and a <strong>secret</strong> (e.g. Consumer Key + Consumer Secret), switch to <strong>OAUTH2_CLIENT_CREDENTIALS</strong> or <strong>HMAC_SHA256</strong> above. You can also rename credential fields below to match your portal.
                </div>
              )}
              <label className="block">
                <span className="text-text-secondary">Auth type</span>
                <select value={manifest.auth.type}
                  onChange={(e) => {
                    const t = e.target.value;
                    const fieldsByType = {
                      API_KEY: ['api_key'],
                      HMAC_SHA256: ['api_key', 'secret_key'],
                      OAUTH2_CLIENT_CREDENTIALS: ['client_id', 'client_secret'],
                      OAUTH2_PASSWORD: ['client_id', 'client_secret', 'username', 'password'],
                      BEARER: ['bearer_token'],
                      BASIC: ['username', 'password'],
                      UNKNOWN: ['api_key'],
                    };
                    const prev = manifest.auth.type;
                    patchField('auth.type', t);
                    const defaultPrev = fieldsByType[prev] || [];
                    const currentFields = manifest.auth.credential_fields || [];
                    const userEdited = JSON.stringify(currentFields) !== JSON.stringify(defaultPrev);
                    const newFields = userEdited ? currentFields : (fieldsByType[t] || ['api_key']);
                    patchField('auth.credential_fields', newFields);
                    patchField('auth.credentials', Object.fromEntries(newFields.map(f => [f, manifest.auth.credentials?.[f] || ''])));
                    if (t === 'HMAC_SHA256') {
                      patchField('auth.signature_algorithm', 'SHA256');
                      patchField('auth.signature_inputs', ['api_key', 'secret_key', 'timestamp']);
                    } else {
                      patchField('auth.signature_algorithm', null);
                      patchField('auth.signature_inputs', []);
                    }
                  }}
                  className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2">
                  {['API_KEY', 'HMAC_SHA256', 'OAUTH2_CLIENT_CREDENTIALS', 'OAUTH2_PASSWORD', 'BEARER', 'BASIC', 'UNKNOWN'].map((t) =>
                    <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              {manifest.auth.type === 'API_KEY' && (
                <>
                  <label className="block">
                    <span className="text-text-secondary">API key location</span>
                    <select value={manifest.auth.api_key_location || 'header'}
                      onChange={(e) => patchField('auth.api_key_location', e.target.value)}
                      className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2 text-xs">
                      <option value="header">Header</option>
                      <option value="query">Query parameter</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-text-secondary">API key name</span>
                    <input value={manifest.auth.api_key_name || ''}
                      onChange={(e) => patchField('auth.api_key_name', e.target.value.trim())}
                      placeholder={manifest.auth.api_key_location === 'query' ? 'apikey' : 'X-Api-Key'}
                      className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2 font-mono text-xs" />
                  </label>
                </>
              )}
              {(manifest.auth.type === 'OAUTH2_CLIENT_CREDENTIALS' || manifest.auth.type === 'OAUTH2_PASSWORD') && (
                <label className="block">
                  <span className="text-text-secondary">Token URL</span>
                  <input value={manifest.auth.token_url || ''}
                    onChange={(e) => patchField('auth.token_url', e.target.value.trim())}
                    placeholder="https://api.supplier.com/oauth/token"
                    className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2 font-mono text-xs" />
                </label>
              )}
              {manifest.auth.type === 'HMAC_SHA256' && (
                <label className="block">
                  <span className="text-text-secondary">Signature inputs (comma-separated)</span>
                  <input value={(manifest.auth.signature_inputs || []).join(', ')}
                    onChange={(e) => patchField('auth.signature_inputs', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="api_key, secret_key, timestamp"
                    className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2 font-mono text-xs" />
                </label>
              )}
              <label className="block">
                <span className="text-text-secondary">Custom headers (JSON, optional)</span>
                <input
                  value={manifest.auth.custom_headers ? JSON.stringify(manifest.auth.custom_headers) : ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (!v) { patchField('auth.custom_headers', null); return; }
                    try { patchField('auth.custom_headers', JSON.parse(v)); } catch {}
                  }}
                  placeholder='{"Duffel-Version":"v2"}'
                  className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2 font-mono text-xs" />
                <span className="text-[10px] text-text-secondary">Extra headers sent on every request (e.g. API version headers)</span>
              </label>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Credentials</span>
                  <button type="button"
                    onClick={() => {
                      const name = window.prompt('Credential field name (e.g. consumer_key):');
                      if (!name?.trim()) return;
                      const fields = [...manifest.auth.credential_fields, name.trim()];
                      patchField('auth.credential_fields', fields);
                    }}
                    className="text-xs text-accent hover:underline">+ Add field</button>
                </div>
                {manifest.auth.credential_fields.map((field, idx) => (
                  <div key={field} className="flex gap-2 items-end">
                    <label className="flex-1 block">
                      <div className="flex items-center gap-1">
                        <input
                          value={field}
                          onChange={(e) => {
                            const newName = e.target.value.trim();
                            if (!newName) return;
                            const fields = [...manifest.auth.credential_fields];
                            const oldName = fields[idx];
                            fields[idx] = newName;
                            patchField('auth.credential_fields', fields);
                            const creds = { ...(manifest.auth.credentials || {}) };
                            if (creds[oldName] !== undefined) {
                              creds[newName] = creds[oldName];
                              delete creds[oldName];
                              patchField('auth.credentials', creds);
                            }
                          }}
                          className="text-xs text-text-secondary font-mono bg-transparent border-b border-dashed border-border-default focus:border-accent outline-none w-full"
                        />
                      </div>
                      <input
                        type="password"
                        autoComplete="off"
                        value={manifest.auth.credentials?.[field] || ''}
                        onChange={(e) => patchField(`auth.credentials.${field}`, e.target.value.trim())}
                        placeholder={`enter ${field}`}
                        className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2 font-mono text-xs"
                      />
                    </label>
                    {manifest.auth.credential_fields.length > 1 && (
                      <button type="button"
                        onClick={() => {
                          const fields = manifest.auth.credential_fields.filter((_, i) => i !== idx);
                          patchField('auth.credential_fields', fields);
                          const creds = { ...(manifest.auth.credentials || {}) };
                          delete creds[field];
                          patchField('auth.credentials', creds);
                        }}
                        className="text-danger text-sm mb-2 hover:text-red-700">×</button>
                    )}
                  </div>
                ))}
                <div className="text-xs text-text-secondary">
                  Field names are editable — click to rename (e.g. consumer_key instead of client_id). Stored encrypted in the hub on promote.
                </div>
              </div>
            </div>
          )}

          {current.key === 'contract' && (
            <div className="text-sm space-y-3">
              <div className="text-xs text-text-secondary">
                Edit each operation's HTTP method + endpoint path. The sandbox validator hits <span className="font-mono">search</span> first to verify auth.
              </div>
              {Object.entries(manifest.operations).map(([op, def]) => (
                <div key={op} className="border border-border-default rounded-btn p-3 space-y-2">
                  <div className="font-medium">{op}</div>
                  <div className="flex gap-2">
                    <select
                      value={def.method || 'GET'}
                      onChange={(e) => patchField(`operations.${op}.method`, e.target.value)}
                      className="rounded-btn border border-border-default px-2 py-1 text-xs font-mono"
                    >
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input
                      value={def.endpoint || ''}
                      onChange={(e) => patchField(`operations.${op}.endpoint`, e.target.value)}
                      placeholder="/v1/path/to/endpoint"
                      className="flex-1 rounded-btn border border-border-default px-2 py-1 text-xs font-mono"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {current.key === 'mapping' && (() => {
            const type = manifest.cts_mapping.type_value;
            const applicable = targetsForType(type);
            const required = requiredTargetsForType(type);
            const filled = required.filter((t) => getSourceFor(t.path)).length;
            return (
              <div className="space-y-3">
                <div className="text-xs bg-accent/10 text-accent rounded-btn px-3 py-2">
                  Map supplier fields to the <span className="font-mono">Canonical Travel Schema</span> (CTS {CTS_VERSION}).
                  The target column is fixed — you supply the source path in your supplier's response.
                  {analysis?.ok && analysis.inferred_category && analysis.inferred_category !== 'UNKNOWN' && (
                    <> Detected type from docs: <span className="font-mono">{analysis.inferred_category}</span>.</>
                  )}
                </div>

                <label className="block text-sm">
                  <span className="text-text-secondary">CTS type</span>
                  <select
                    value={type}
                    onChange={(e) => {
                      const v = e.target.value;
                      setManifest((m) => ({
                        ...m,
                        supplier: { ...m.supplier, categories: [v] },
                        cts_mapping: { ...m.cts_mapping, type_value: v },
                        tenant_config: { ...m.tenant_config, preferred_for_categories: [v] },
                      }));
                    }}
                    className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2"
                  >
                    {CTS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>

                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="text-text-secondary">Required fields mapped: </span>
                    <span className={filled === required.length ? 'text-success font-medium' : 'text-warning font-medium'}>
                      {filled} / {required.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-text-secondary">{applicable.length} applicable CTS targets</span>
                    <button type="button"
                      onClick={runAutoMap}
                      disabled={autoMapBusy}
                      className="rounded-btn bg-accent text-white px-3 py-1 text-xs disabled:opacity-50">
                      {autoMapBusy ? 'Probing sandbox…' : '✨ Auto-map from sandbox'}
                    </button>
                  </div>
                </div>
                {autoMapError && (
                  <div className="text-xs text-danger bg-danger/5 rounded-btn px-3 py-2">{autoMapError}</div>
                )}

                <div className="space-y-1.5">
                  {applicable.map((t) => renderTargetRow(t))}
                </div>

                {renderCustomRows()}

                <button type="button" className="text-accent text-xs"
                  onClick={() => patchField('cts_mapping.field_mappings', [
                    ...(manifest.cts_mapping.field_mappings || []),
                    { target: '', source: '', transform: null },
                  ])}>+ add custom target</button>

                {report?.manifest_errors && (
                  <div className="text-xs text-danger">
                    {report.manifest_errors.length} mapping issue(s) flagged — see highlighted rows.
                  </div>
                )}
              </div>
            );
          })()}

          {current.key === 'test' && (
            <TestParamsEditor
              value={manifest.test_suite.sandbox_search_params}
              onCommit={(parsed) => {
                patchField('test_suite.sandbox_search_params', parsed);
                setError(null);
              }}
              onInvalid={() => setError('Invalid JSON')}
            />
          )}

          {current.key === 'tenant' && (
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-text-secondary">SLA tier</span>
                <select value={manifest.tenant_config.sla_tier}
                  onChange={(e) => patchField('tenant_config.sla_tier', e.target.value)}
                  className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2">
                  {['ENTERPRISE', 'GROWTH', 'STARTER'].map((t) =>
                    <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <div>
                <span className="text-text-secondary">Preferred categories</span>
                <div className="text-xs text-text-secondary mt-1">
                  {manifest.tenant_config.preferred_for_categories.join(', ') || 'none'}
                </div>
              </div>
            </div>
          )}

          {current.key === 'review' && (
            <div className="text-sm">
              <p className="text-text-secondary mb-2">Review the full manifest. Confirm to start sandbox validation against the supplier.</p>
              <pre className="text-xs bg-page-bg p-3 rounded-btn overflow-auto max-h-64">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            </div>
          )}

          {current.key === 'validation' && (
            <div className="text-sm space-y-3" data-testid="validation-panel">
              <div className="text-text-secondary">
                Status:{' '}
                <span className={
                  status === 'PROMOTED' ? 'text-success font-medium' :
                  status === 'FAILED' ? 'text-danger font-medium' :
                  status === 'VALIDATED' ? 'text-success font-medium' :
                  'text-warning font-medium'
                }>{status}</span>
              </div>
              <div className="space-y-1">
                {STEP_DISPLAY.map((sd) => {
                  const r = report?.steps?.find((s) => s.name === sd.name);
                  const skipped = r?.marked_skipped || r?.marked_untested;
                  const state = !r ? 'pending' : skipped ? 'skip' : r.ok ? 'ok' : 'fail';
                  const icon = state === 'ok' ? '✓' : state === 'fail' ? '✗' : state === 'skip' ? '–' : '…';
                  const cls = state === 'ok' ? 'text-success' : state === 'fail' ? 'text-danger' : 'text-text-secondary';
                  return (
                    <div key={sd.name} className="flex justify-between items-center border border-border-default rounded-btn px-3 py-1.5">
                      <span><span className={`mr-2 font-mono ${cls}`}>{icon}</span>Step {sd.n}: {sd.name}</span>
                      {r?.error && <span className="text-xs text-danger">{r.error}</span>}
                      {r?.marked_untested && <span className="text-xs text-text-secondary">untested</span>}
                      {r?.marked_skipped && <span className="text-xs text-text-secondary" title={r.reason}>skipped</span>}
                      {r?.marked_optional && !r?.marked_skipped && <span className="text-xs text-text-secondary">optional</span>}
                    </div>
                  );
                })}
              </div>
              {report?.failure_report && (
                <div className="text-xs text-danger bg-danger/5 p-2 rounded-btn">{report.failure_report}</div>
              )}
              {report?.auth_debug && (
                <details className="text-xs bg-gray-50 border border-border-default rounded-btn p-2 mt-1">
                  <summary className="cursor-pointer text-text-secondary font-medium">Auth diagnostic</summary>
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-text-secondary">{JSON.stringify(report.auth_debug, null, 2)}</pre>
                </details>
              )}
              {report?.manifest_errors && (
                <div className="text-xs text-danger bg-danger/5 p-2 rounded-btn">
                  Manifest invalid: {report.manifest_errors.map((e) => e.path?.join('.') + ': ' + e.message).join('; ')}
                </div>
              )}
              {status === 'PROMOTED' && (
                <div className="text-success text-sm">Integration provisioned. You can close this wizard.</div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border-default flex justify-between items-center">
          <button type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || busy || status === 'VALIDATING'}
            className="text-sm text-text-secondary disabled:opacity-40">← Back</button>

          {current.key === 'review' && status !== 'VALIDATING' && status !== 'PROMOTED' && (
            <button type="button" onClick={runConfirm} disabled={busy}
              className="rounded-btn bg-accent text-white px-4 py-2 text-sm disabled:opacity-50">
              Confirm & Validate
            </button>
          )}

          {current.key === 'validation' && status === 'FAILED' && (
            <button type="button" onClick={fixAndRetry}
              className="rounded-btn bg-warning text-white px-4 py-2 text-sm">
              Fix &amp; Retry
            </button>
          )}

          {current.key === 'validation' && status === 'PROMOTED' && (
            <button type="button" onClick={onClose}
              className="rounded-btn bg-success text-white px-4 py-2 text-sm">Finish</button>
          )}

          {current.key !== 'review' && current.key !== 'validation' && (
            <button type="button" onClick={goNext} disabled={busy}
              className="rounded-btn bg-accent text-white px-4 py-2 text-sm disabled:opacity-50">
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
    {autoMap && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50">
        <div className="bg-card-bg rounded-card shadow-md w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="p-5 border-b border-border-default flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">Auto-map preview</div>
              <div className="text-xs text-text-secondary mt-0.5">
                {autoMap.counts.deterministic} deterministic · {autoMap.counts.llm} LLM · {autoMap.counts.unmapped} unmapped
              </div>
            </div>
            <button type="button" onClick={() => setAutoMap(null)}
              className="text-text-secondary text-sm hover:text-text-primary">✕</button>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <div className="text-xs font-semibold text-text-secondary mb-2">Proposed mappings</div>
              <div className="border border-border-default rounded-btn overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-page-bg">
                    <tr>
                      <th className="text-left p-2 font-medium">CTS target</th>
                      <th className="text-left p-2 font-medium">Source path</th>
                      <th className="text-left p-2 font-medium">Confidence</th>
                      <th className="text-left p-2 font-medium">Via</th>
                      <th className="text-left p-2 font-medium">Sample</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoMap.mappings.length === 0 && (
                      <tr><td colSpan={5} className="p-3 text-center text-text-secondary">No mappings proposed.</td></tr>
                    )}
                    {autoMap.mappings.map((m, i) => (
                      <tr key={i} className="border-t border-border-default">
                        <td className="p-2 font-mono">{m.target}</td>
                        <td className="p-2 font-mono text-text-secondary">{m.source}</td>
                        <td className="p-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            m.confidence === 'HIGH' ? 'bg-success/10 text-success' :
                            m.confidence === 'MED' ? 'bg-warning/10 text-warning' :
                            'bg-border-default text-text-secondary'}`}>{m.confidence}</span>
                        </td>
                        <td className="p-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            m.via === 'llm' ? 'bg-accent/10 text-accent' : 'bg-teal/10 text-teal'}`}>{m.via}</span>
                        </td>
                        <td className="p-2 font-mono text-text-secondary truncate max-w-[200px]">
                          {m.sample_value !== undefined && m.sample_value !== null
                            ? (typeof m.sample_value === 'object' ? JSON.stringify(m.sample_value) : String(m.sample_value))
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {autoMap.unmapped && autoMap.unmapped.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-text-secondary mb-2">Unmapped targets ({autoMap.unmapped.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {autoMap.unmapped.map((t, i) => (
                    <span key={i} className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
                      t.required ? 'bg-danger/10 text-danger' : 'bg-border-default text-text-secondary'}`}>
                      {t.path}{t.required ? ' *' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {autoMap.sample && (
              <details>
                <summary className="text-xs font-semibold text-text-secondary cursor-pointer">Sample response</summary>
                <pre className="mt-2 text-[10px] bg-page-bg p-2 rounded-btn overflow-auto max-h-64">{JSON.stringify(autoMap.sample, null, 2)}</pre>
              </details>
            )}
          </div>
          <div className="p-5 border-t border-border-default flex items-center justify-end gap-2">
            <button type="button" onClick={() => setAutoMap(null)}
              className="text-sm text-text-secondary px-3 py-2">Cancel</button>
            <button type="button" onClick={acceptAutoMap} disabled={autoMap.mappings.length === 0}
              className="rounded-btn bg-accent text-white px-4 py-2 text-sm disabled:opacity-50">
              Accept {autoMap.mappings.length} mapping{autoMap.mappings.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
