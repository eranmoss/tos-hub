import { useEffect, useMemo, useRef, useState } from 'react';
import { runLifecycleStep } from '../api/lifecycle.js';

const STEPS = ['detail', 'availability', 'book', 'cancel'];

const STEP_LABELS = {
  detail: 'Detail',
  availability: 'Availability',
  book: 'Book',
  cancel: 'Cancel',
};

const STEP_HINT = {
  detail: 'Fetch product detail from supplier. No payload required.',
  availability: 'Query open slots/dates. Payload usually { date_from, date_to }.',
  book: 'Place the booking (or fetch redirect URL for redirect-flow suppliers).',
  cancel: 'Cancel by booking reference. Not all suppliers support API cancel.',
};

const emptyStepState = () => ({
  payload: '{}',
  loading: false,
  result: null,
  error: null,
  latency_ms: null,
  ranAt: null,
});

const safeParse = (s) => {
  try { return { ok: true, value: JSON.parse(s) }; }
  catch (e) { return { ok: false, error: e.message }; }
};

const tryPrettyPrint = (s) => {
  const r = safeParse(s);
  if (!r.ok) return s;
  return JSON.stringify(r.value, null, 2);
};

export default function LifecycleDrawer({ open, row, onClose }) {
  const [steps, setSteps] = useState(() => ({
    detail: emptyStepState(),
    availability: emptyStepState(),
    book: emptyStepState(),
    cancel: emptyStepState(),
  }));
  const [expanded, setExpanded] = useState({
    detail: true,
    availability: false,
    book: false,
    cancel: false,
  });
  const [runAllState, setRunAllState] = useState({ running: false, stoppedAt: null });
  const runAllAbort = useRef({ stop: false });

  useEffect(() => {
    if (open && row) {
      setSteps({
        detail: emptyStepState(),
        availability: emptyStepState(),
        book: emptyStepState(),
        cancel: emptyStepState(),
      });
      setExpanded({ detail: true, availability: false, book: false, cancel: false });
      setRunAllState({ running: false, stoppedAt: null });
      runAllAbort.current.stop = false;
    }
  }, [open, row?.id]);

  const slug = row?.supplier_slug;
  const rawRef = row?.supplier_raw_ref;
  const isHotelbeds = slug?.startsWith('hotelbeds');

  const runOne = async (step) => {
    if (!row) return null;
    const parsed = safeParse(steps[step].payload);
    if (!parsed.ok) {
      setSteps((s) => ({ ...s, [step]: { ...s[step], error: `Invalid JSON: ${parsed.error}`, result: null } }));
      return null;
    }
    setSteps((s) => ({ ...s, [step]: { ...s[step], loading: true, error: null, result: null } }));
    try {
      const res = await runLifecycleStep(slug, step, {
        inventory_id: row.id,
        supplier_raw_ref: rawRef,
        payload: parsed.value,
      });
      setSteps((s) => ({
        ...s,
        [step]: {
          ...s[step],
          loading: false,
          result: res,
          error: res?.ok ? null : (res?.error || 'step returned error'),
          latency_ms: res?.latency_ms ?? null,
          ranAt: new Date().toISOString(),
        },
      }));
      if (res?.ok && res?.next_payload_hint) {
        const nextIdx = STEPS.indexOf(step) + 1;
        const next = STEPS[nextIdx];
        if (next) {
          setSteps((s) => ({
            ...s,
            [next]: { ...s[next], payload: JSON.stringify(res.next_payload_hint, null, 2) },
          }));
          setExpanded((e) => ({ ...e, [next]: true }));
        }
      }
      return res;
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'request failed';
      setSteps((s) => ({
        ...s,
        [step]: { ...s[step], loading: false, error: msg, result: null },
      }));
      return null;
    }
  };

  const runAll = async () => {
    setRunAllState({ running: true, stoppedAt: null });
    runAllAbort.current.stop = false;
    for (const step of STEPS) {
      if (runAllAbort.current.stop) break;
      setExpanded((e) => ({ ...e, [step]: true }));
      const res = await runOne(step);
      if (!res?.ok) {
        setRunAllState({ running: false, stoppedAt: step });
        return;
      }
    }
    setRunAllState({ running: false, stoppedAt: null });
  };

  const stopRunAll = () => {
    runAllAbort.current.stop = true;
  };

  if (!open || !row) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[640px] h-full bg-card-bg shadow-2xl flex flex-col">
        <div className="flex items-start justify-between p-4 border-b border-border-default">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary truncate">{row.title || 'Test Lifecycle'}</div>
            <div className="text-xs text-text-secondary mt-1 space-x-2">
              <span className="inline-block px-2 py-0.5 rounded bg-page-bg">{slug}</span>
              <span>type: <span className="font-medium">{row.type}</span></span>
            </div>
            <div className="text-xs text-text-secondary mt-1 font-mono space-y-0.5">
              <div>inventory_id: <span className="text-text-primary">{row.id}</span></div>
              <div>supplier_raw_ref: <span className="text-text-primary">{rawRef}</span></div>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="text-text-secondary hover:text-text-primary text-xl leading-none ml-4">×</button>
        </div>

        {isHotelbeds && (
          <div className="bg-warning/10 border-b border-warning/30 p-3 text-xs text-[color:var(--warning)]">
            ⚠ HotelBeds sandbox bookings may appear in your HotelBeds portal. Cancel before closing drawer.
          </div>
        )}

        <div className="p-3 border-b border-border-default flex items-center gap-2">
          <button type="button" onClick={runAll} disabled={runAllState.running}
            className="rounded-btn bg-accent text-white text-xs px-3 py-2 disabled:opacity-50">
            {runAllState.running ? 'Running all…' : '▶ Run all steps'}
          </button>
          {runAllState.running && (
            <button type="button" onClick={stopRunAll}
              className="rounded-btn border border-border-default text-xs px-3 py-2">Stop</button>
          )}
          {runAllState.stoppedAt && (
            <span className="text-xs text-danger">Stopped at "{runAllState.stoppedAt}" — see error below</span>
          )}
          <span className="text-xs text-text-secondary ml-auto">Manual click-through available below</span>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-3">
          {STEPS.map((step) => (
            <StepBlock
              key={step}
              step={step}
              state={steps[step]}
              expanded={expanded[step]}
              onToggle={() => setExpanded((e) => ({ ...e, [step]: !e[step] }))}
              onChangePayload={(v) => setSteps((s) => ({ ...s, [step]: { ...s[step], payload: v } }))}
              onPretty={() => setSteps((s) => ({ ...s, [step]: { ...s[step], payload: tryPrettyPrint(s[step].payload) } }))}
              onRun={() => runOne(step)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StepBlock({ step, state, expanded, onToggle, onChangePayload, onPretty, onRun }) {
  const statusPill = useMemo(() => {
    if (state.loading) return <span className="text-xs px-2 py-0.5 rounded bg-warning/20 text-[color:var(--warning)]">running…</span>;
    if (state.error) return <span className="text-xs px-2 py-0.5 rounded bg-danger/20 text-danger">error</span>;
    if (state.result?.ok) return <span className="text-xs px-2 py-0.5 rounded bg-success/20 text-success">ok · {state.latency_ms}ms</span>;
    if (state.result && !state.result.ok) return <span className="text-xs px-2 py-0.5 rounded bg-danger/20 text-danger">not ok</span>;
    return <span className="text-xs px-2 py-0.5 rounded bg-page-bg text-text-secondary">idle</span>;
  }, [state]);

  return (
    <div className="border border-border-default rounded-card bg-card-bg">
      <button type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        onClick={onToggle}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-text-secondary">{expanded ? '▾' : '▸'}</span>
          <span className="text-sm font-semibold text-text-primary">{STEP_LABELS[step]}</span>
          {statusPill}
        </div>
        <span className="text-xs text-text-secondary truncate max-w-[50%]">{STEP_HINT[step]}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border-default">
          <div>
            <div className="flex items-center justify-between mt-2 mb-1">
              <label className="text-xs text-text-secondary">Payload (JSON)</label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onPretty}
                  className="text-xs text-accent hover:underline">Format</button>
                <button type="button" onClick={onRun} disabled={state.loading}
                  className="rounded-btn bg-accent text-white text-xs px-3 py-1 disabled:opacity-50">
                  {state.loading ? 'Running…' : '▶ Run'}
                </button>
              </div>
            </div>
            <textarea
              value={state.payload}
              onChange={(e) => onChangePayload(e.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full rounded-btn border border-border-default px-2 py-1 font-mono text-xs" />
          </div>
          {state.error && (
            <div className="text-xs text-danger bg-danger/10 rounded px-2 py-1">{state.error}</div>
          )}
          {state.result && (
            <div>
              <div className="text-xs text-text-secondary mb-1">Response</div>
              <pre className="text-xs bg-page-bg rounded p-2 overflow-auto max-h-64">
{JSON.stringify(state.result, null, 2)}
              </pre>
              {state.result?.data?.order_webpage && (
                <a href={state.result.data.order_webpage} target="_blank" rel="noreferrer"
                   className="inline-block mt-2 text-xs text-accent hover:underline">
                  Open checkout page ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
