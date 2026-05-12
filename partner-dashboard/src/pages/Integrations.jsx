import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIntegrations } from '../hooks/useIntegrations.js';
import { usePageContext } from '../agent/usePageContext.js';
import { runSupplierTest, getSupplierTests, reonboardFromExisting, triggerSync, getSyncStatus, autoMapCategories, toggleSupplier } from '../api/dashboard.js';
import OnboardingWizard from '../components/OnboardingWizard.jsx';

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : '—');
const fmtAgo = (s) => {
  if (!s) return '—';
  const ms = Date.now() - new Date(s).getTime();
  const hr = Math.round(ms / (1000 * 60 * 60));
  return hr < 1 ? 'just now' : `${hr}h ago`;
};

export default function Integrations() {
  const { data, loading, error, refetch } = useIntegrations();
  const { register } = usePageContext();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [reonboardSession, setReonboardSession] = useState(null);
  const [busySlug, setBusySlug] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [toast, setToast] = useState(null);
  const [lastReport, setLastReport] = useState(null);
  const [testHistory, setTestHistory] = useState(null);
  const [expandedTestId, setExpandedTestId] = useState(null);
  const [syncingSlug, setSyncingSlug] = useState(null);
  const [syncStatus, setSyncStatus] = useState({});
  const [pollFast, setPollFast] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const poll = () => {
      getSyncStatus()
        .then((r) => {
          if (cancelled) return;
          setSyncStatus(r.by_supplier || {});
          const hasRunning = Object.values(r.by_supplier || {}).some((s) => s.status === 'RUNNING');
          if (hasRunning) setPollFast(true);
          else setPollFast(false);
          timer = setTimeout(poll, hasRunning ? 3000 : 60000);
        })
        .catch(() => { if (!cancelled) { timer = setTimeout(poll, 60000); } });
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!pollFast) return;
    const id = setInterval(() => {
      getSyncStatus()
        .then((r) => {
          setSyncStatus(r.by_supplier || {});
          const hasRunning = Object.values(r.by_supplier || {}).some((s) => s.status === 'RUNNING');
          if (!hasRunning) setPollFast(false);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [pollFast]);

  useEffect(() => {
    if (detailItem && !detailItem.__report) {
      setTestHistory(null);
      getSupplierTests(detailItem.supplier_slug)
        .then((r) => setTestHistory(r.tests))
        .catch(() => setTestHistory([]));
    }
  }, [detailItem]);

  useEffect(() => {
    if (data) register('integrations', { integrations: data.integrations });
  }, [data, register]);

  const reonboard = async (slug) => {
    setBusySlug(slug);
    setToast(null);
    try {
      const r = await reonboardFromExisting(slug);
      setReonboardSession({ session_id: r.session_id, manifest: r.manifest });
      setWizardOpen(true);
    } catch (e) {
      setToast({ kind: 'err', text: `${slug}: ${e?.response?.data?.error || e.message}` });
    } finally { setBusySlug(null); }
  };

  const runTest = async (slug) => {
    setBusySlug(slug);
    setToast(null);
    try {
      const r = await runSupplierTest(slug);
      const steps = r.report?.steps || [];
      const passed = steps.filter((s) => s.ok).length;
      const total = steps.length || 6;
      const failMsg = r.report?.failure_report ? ` — ${r.report.failure_report}` : '';
      setLastReport({ slug, ...r });
      setToast({
        kind: r.status === 'PASS' ? 'ok' : 'err',
        text: `${slug}: ${r.status} ${passed}/${total}${failMsg}`,
        clickable: true,
      });
      await refetch();
    } catch (e) {
      setToast({ kind: 'err', text: `${slug}: ${e?.response?.data?.error || e.message}` });
    } finally { setBusySlug(null); }
  };

  if (loading) return <div className="p-8 text-text-secondary">Loading…</div>;
  if (error) return <div className="p-8 text-danger">{error}</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-medium text-text-secondary">
          {data?.integrations?.length || 0} active integrations
        </h2>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="rounded-btn bg-accent text-white px-4 py-2 text-sm"
        >
          + Add Integration
        </button>
      </div>

      {toast && (
        <div className={`text-sm rounded-btn px-3 py-2 ${
          toast.kind === 'ok' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
        }`}>
          {toast.text}
          {toast.clickable && lastReport && (
            <button type="button" onClick={() => setDetailItem({ __report: true })}
              className="ml-2 underline opacity-80 hover:opacity-100">view report</button>
          )}
          {toast.showJobs && (
            <button type="button" onClick={() => navigate('/dashboard/system-log')}
              className="ml-2 underline opacity-80 hover:opacity-100">View in System Log</button>
          )}
          <button type="button" onClick={() => setToast(null)} className="float-right text-xs opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {detailItem?.__report && lastReport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-40"
             onClick={() => setDetailItem(null)}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-card-bg rounded-card shadow-md w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-border-default flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-primary">Validation report — {lastReport.slug}</h3>
                <div className="text-xs text-text-secondary">
                  Session {lastReport.session_id?.slice(0, 8)}… · Status{' '}
                  <span className={lastReport.status === 'PASS' ? 'text-success' : 'text-danger'}>{lastReport.status}</span>
                </div>
              </div>
              <button onClick={() => setDetailItem(null)} className="text-text-secondary hover:text-danger text-lg leading-none">×</button>
            </div>
            <div className="p-5 space-y-2 text-sm">
              {(lastReport.report?.steps || []).map((s) => (
                <div key={s.name} className="border border-border-default rounded-btn px-3 py-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      <span className={`mr-2 font-mono ${s.ok ? 'text-success' : 'text-danger'}`}>
                        {s.ok ? '✓' : '✗'}
                      </span>
                      Step {s.step}: {s.name}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      {s.marked_untested && 'skipped — no test_booking_ref configured '}
                      {s.marked_optional && 'optional — supplier had no detail response '}
                      {s.attempts != null && `attempts: ${s.attempts}`}
                      {s.pass_rate != null && ` · normalize pass rate: ${(s.pass_rate * 100).toFixed(0)}%`}
                      {s.error && <span className="text-danger"> · {s.error}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-text-secondary whitespace-nowrap">
                    {s.latency_ms != null ? `${s.latency_ms} ms` : (s.marked_untested || s.marked_optional ? 'no call' : '')}
                  </div>
                </div>
              ))}
              <details className="text-xs mt-3">
                <summary className="cursor-pointer text-text-secondary">Raw report JSON</summary>
                <pre className="bg-page-bg p-3 rounded-btn overflow-auto max-h-64 mt-2">
                  {JSON.stringify(lastReport.report, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data?.integrations?.map((i) => (
          <div key={i.supplier_slug} className="bg-card-bg rounded-card border border-border-default p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-text-primary">{i.name}</div>
                <div className="text-xs text-text-secondary">
                  {(i.categories || []).join(', ')}
                </div>
              </div>
              <div className="flex gap-2 items-center">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  i.is_active !== false
                    ? 'bg-success/10 text-success'
                    : 'bg-gray-200 text-gray-500'
                }`}>
                  {i.is_active !== false ? 'Active' : 'Disabled'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-teal/10 text-teal font-medium">
                  {i.sla_tier}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const newState = i.is_active === false;
                    toggleSupplier(i.supplier_slug, newState)
                      .then((r) => {
                        setToast({ kind: 'ok', text: `${i.supplier_slug}: ${r.is_active ? 'enabled' : 'disabled'} — ${r.inventory_updated.toLocaleString()} inventory records updated` });
                        refetch();
                      })
                      .catch((e) => setToast({ kind: 'err', text: e?.response?.data?.error || e.message }));
                  }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    i.is_active !== false
                      ? 'border-red-300 text-red-500 hover:bg-red-50'
                      : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                  }`}
                >
                  {i.is_active !== false ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-text-secondary">
              <span>Operations: {i.operations.join(' · ')}</span>
              {i.inventory_total > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-gray-100 font-medium">
                  {(i.inventory_active || 0).toLocaleString()} / {(i.inventory_total || 0).toLocaleString()} items
                </span>
              )}
            </div>
            <div className="mt-2 text-xs">
              Last test: {i.last_test_run ? (
                <>
                  <span className={i.last_test_run.status === 'PASS' ? 'text-success' : 'text-danger'}>
                    {i.last_test_run.status}
                  </span>
                  {' '} — {i.last_test_run.steps_passed}/{i.last_test_run.steps_total} ·
                  {' '}{fmtAgo(i.last_test_run.ran_at)}
                </>
              ) : '—'}
            </div>
            <div className="mt-1 text-xs text-text-secondary">
              Credential rotation: {fmtDate(i.credential_rotation_due)}
            </div>
            {(() => {
              const ss = syncStatus[i.supplier_slug];
              if (!ss) return (
                <div className="mt-2 text-xs flex items-center gap-2 bg-page-bg rounded-btn px-2.5 py-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-text-secondary" />
                  <span className="text-text-secondary">No sync recorded</span>
                </div>
              );
              const isRunning = ss.status === 'RUNNING';
              const dotCls = ss.status === 'COMPLETE' ? 'bg-success' : ss.status === 'FAILED' ? 'bg-danger' : 'bg-warning';
              const elapsed = isRunning && ss.started_at
                ? (() => { const s = Math.round((Date.now() - new Date(ss.started_at).getTime()) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`; })()
                : null;
              return (
                <div className={`mt-2 text-xs flex items-center gap-2 rounded-btn px-2.5 py-1.5 ${
                  isRunning ? 'bg-primary/5 border border-primary/20' : 'bg-page-bg'
                }`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${dotCls} ${isRunning ? 'animate-pulse' : ''}`} />
                  <span className="font-medium">{ss.status}</span>
                  {isRunning && (
                    <span className="text-text-secondary">
                      {ss.records_fetched > 0
                        ? `${ss.records_fetched.toLocaleString()} fetched · ${(ss.records_upserted || 0).toLocaleString()} upserted`
                        : 'starting…'}
                      {elapsed && ` · ${elapsed}`}
                      {ss.records_errored > 0 && <span className="text-danger"> · {ss.records_errored} errors</span>}
                    </span>
                  )}
                  {ss.status === 'COMPLETE' && (
                    <span className="text-text-secondary">
                      {(ss.records_upserted || 0).toLocaleString()} upserted
                      {ss.records_deactivated > 0 && ` · ${ss.records_deactivated.toLocaleString()} deactivated`}
                      {ss.records_errored > 0 && <span className="text-danger"> · {ss.records_errored} errors</span>}
                      {' · '}{fmtAgo(ss.completed_at)}
                    </span>
                  )}
                  {ss.status === 'FAILED' && (
                    <span className="text-danger truncate max-w-[300px]" title={ss.error_message || 'Unknown error'}>
                      {ss.error_message || 'Unknown error'}{elapsed && ` · after ${elapsed}`}
                    </span>
                  )}
                </div>
              );
            })()}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const slug = i.supplier_slug;
                  setSyncingSlug(slug);
                  setToast(null);
                  setSyncStatus((prev) => ({
                    ...prev,
                    [slug]: { ...prev[slug], status: 'RUNNING', records_fetched: 0, records_upserted: 0, started_at: new Date().toISOString(), completed_at: null, error_message: null },
                  }));
                  setPollFast(true);
                  triggerSync(slug)
                    .then((r) => {
                      setToast({ kind: 'ok', text: `${slug}: ${r.message}`, showJobs: true });
                    })
                    .catch((e) => {
                      setSyncStatus((prev) => ({ ...prev, [slug]: { ...prev[slug], status: 'FAILED', error_message: e?.response?.data?.error || e.message } }));
                      setToast({ kind: 'err', text: `${slug}: ${e?.response?.data?.error || e.message}` });
                    })
                    .finally(() => setSyncingSlug(null));
                }}
                disabled={syncingSlug === i.supplier_slug || syncStatus[i.supplier_slug]?.status === 'RUNNING'}
                className="rounded-btn bg-primary text-white px-3 py-1 text-xs hover:opacity-90 disabled:opacity-60"
              >
                {syncStatus[i.supplier_slug]?.status === 'RUNNING' ? 'Syncing…' : '⟳ Sync'}
              </button>
              <button
                type="button"
                onClick={() => runTest(i.supplier_slug)}
                disabled={busySlug === i.supplier_slug}
                className="rounded-btn border border-border-default px-3 py-1 text-xs hover:border-accent disabled:opacity-60"
              >
                {busySlug === i.supplier_slug ? 'Running…' : 'Run Tests'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setToast(null);
                  autoMapCategories({ supplier_slug: i.supplier_slug })
                    .then((r) => setToast({ kind: 'ok', text: `${i.supplier_slug}: mapped ${r.mapped} categories, ${r.created} new, ${r.skipped} flags skipped` }))
                    .catch((e) => setToast({ kind: 'err', text: `Taxonomy: ${e?.response?.data?.error || e.message}` }));
                }}
                className="rounded-btn border border-amber-400 text-amber-600 px-3 py-1 text-xs hover:bg-amber-50"
              >
                Sync Taxonomy
              </button>
              <button
                type="button"
                onClick={() => setDetailItem(i)}
                className="rounded-btn border border-border-default px-3 py-1 text-xs hover:border-accent"
              >
                Details
              </button>
              <button
                type="button"
                onClick={() => reonboard(i.supplier_slug)}
                disabled={busySlug === i.supplier_slug}
                className="rounded-btn border border-border-default px-3 py-1 text-xs hover:border-accent disabled:opacity-60"
                title="Re-run the onboarding wizard pre-filled with the current manifest. Useful for re-validating + regenerating vendor knowledge."
              >
                {busySlug === i.supplier_slug ? '…' : 'Re-onboard'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {wizardOpen && (
        <OnboardingWizard
          existingSession={reonboardSession}
          onClose={() => { setWizardOpen(false); setReonboardSession(null); refetch(); }}
        />
      )}

      {detailItem && !detailItem.__report && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-40"
             onClick={() => setDetailItem(null)}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-card-bg rounded-card shadow-md w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-border-default flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-primary">{detailItem.name}</h3>
                <div className="text-xs text-text-secondary">{detailItem.supplier_slug}</div>
              </div>
              <button onClick={() => setDetailItem(null)} className="text-text-secondary hover:text-danger text-lg leading-none">×</button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-text-secondary text-xs">Status</div><div className="font-medium">{detailItem.status}</div></div>
                <div><div className="text-text-secondary text-xs">SLA Tier</div><div className="font-medium">{detailItem.sla_tier}</div></div>
                <div><div className="text-text-secondary text-xs">Categories</div><div>{(detailItem.categories || []).join(', ')}</div></div>
                <div><div className="text-text-secondary text-xs">Activated</div><div>{fmtDate(detailItem.activated_at)}</div></div>
                <div><div className="text-text-secondary text-xs">Credential rotation</div><div>{fmtDate(detailItem.credential_rotation_due)}</div></div>
                <div><div className="text-text-secondary text-xs">Last test</div><div>
                  {detailItem.last_test_run
                    ? `${detailItem.last_test_run.status} · ${detailItem.last_test_run.steps_passed}/${detailItem.last_test_run.steps_total} · ${fmtAgo(detailItem.last_test_run.ran_at)}`
                    : '—'}
                </div></div>
              </div>
              <div>
                <div className="text-text-secondary text-xs mb-1">Operations</div>
                <div className="flex flex-wrap gap-2">
                  {(detailItem.operations || []).map((op) => (
                    <span key={op} className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">{op}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-text-secondary text-xs mb-2 mt-2">Test history</div>
                {testHistory === null && <div className="text-xs text-text-secondary">Loading…</div>}
                {testHistory && testHistory.length === 0 && (
                  <div className="text-xs text-text-secondary">No test runs recorded yet.</div>
                )}
                {testHistory && testHistory.length > 0 && (
                  <div className="space-y-1">
                    {testHistory.map((t) => {
                      const open = expandedTestId === t.id;
                      const steps = t.report?.steps || [];
                      const passed = steps.filter((s) => s.ok).length;
                      return (
                        <div key={t.id} className="border border-border-default rounded-btn">
                          <button type="button"
                            onClick={() => setExpandedTestId(open ? null : t.id)}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-page-bg">
                            <div className="flex items-center gap-2">
                              <span className={`font-mono ${t.status === 'PASS' ? 'text-success' : 'text-danger'}`}>
                                {t.status === 'PASS' ? '✓' : '✗'}
                              </span>
                              <span className="font-medium">{t.status}</span>
                              {steps.length > 0 && <span className="text-text-secondary">{passed}/{steps.length}</span>}
                              <span className="text-text-secondary">{new Date(t.ran_at).toLocaleString()}</span>
                            </div>
                            <span className="text-text-secondary">{open ? '▾' : '▸'}</span>
                          </button>
                          {open && (
                            <div className="border-t border-border-default p-3 space-y-1 bg-page-bg">
                              {steps.length === 0 && (
                                <div className="text-xs text-text-secondary">No step breakdown stored for this run.</div>
                              )}
                              {steps.map((s) => (
                                <div key={s.name} className="flex justify-between items-start text-xs">
                                  <div>
                                    <span className={`mr-2 font-mono ${s.ok ? 'text-success' : 'text-danger'}`}>
                                      {s.ok ? '✓' : '✗'}
                                    </span>
                                    Step {s.step}: {s.name}
                                    {s.marked_untested && <span className="text-text-secondary"> — skipped (no test_booking_ref)</span>}
                                    {s.marked_optional && <span className="text-text-secondary"> — optional</span>}
                                    {s.error && <span className="text-danger"> — {s.error}</span>}
                                    {s.pass_rate != null && <span className="text-text-secondary"> — pass rate {(s.pass_rate * 100).toFixed(0)}%</span>}
                                  </div>
                                  <div className="text-text-secondary whitespace-nowrap ml-3">
                                    {s.latency_ms != null ? `${s.latency_ms}ms` : (s.marked_untested || s.marked_optional ? '—' : '')}
                                  </div>
                                </div>
                              ))}
                              {t.report?.failure_report && (
                                <div className="text-xs text-danger mt-2">{t.report.failure_report}</div>
                              )}
                              <details className="mt-2">
                                <summary className="cursor-pointer text-text-secondary text-xs">Search params sent</summary>
                                <pre className="text-xs bg-card-bg p-2 rounded-btn overflow-auto max-h-40 mt-1">
                                  {JSON.stringify(t.search_params, null, 2)}
                                </pre>
                              </details>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-text-secondary">Raw payload</summary>
                <pre className="bg-page-bg p-3 rounded-btn overflow-auto max-h-64 mt-2">
                  {JSON.stringify(detailItem, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
