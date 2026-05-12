import { useEffect, useState } from 'react';
import { useOverview } from '../hooks/useOverview.js';
import { useIntegrations } from '../hooks/useIntegrations.js';
import { usePageContext } from '../agent/usePageContext.js';
import MetricCard from '../components/MetricCard.jsx';
import VolumeChart from '../components/VolumeChart.jsx';
import InventoryGrowthChart from '../components/InventoryGrowthChart.jsx';
import OnboardingWizard from '../components/OnboardingWizard.jsx';
import {
  runSupplierTest, getSupplierTests, reonboardFromExisting,
  triggerSync, getSyncStatus, toggleSupplier, autoMapCategories,
} from '../api/dashboard.js';

const fmtAgo = (s) => {
  if (!s) return '—';
  const ms = Date.now() - new Date(s).getTime();
  const hr = Math.round(ms / (1000 * 60 * 60));
  if (hr < 1) return 'just now';
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
};

export default function Overview() {
  const { data, loading, error, refetch } = useOverview();
  const { data: intData, refetch: refetchInt } = useIntegrations();
  const { register } = usePageContext();
  const [expandedType, setExpandedType] = useState(null);
  const [expTab, setExpTab] = useState('supplier');

  const [wizardOpen, setWizardOpen] = useState(false);
  const [reonboardSession, setReonboardSession] = useState(null);
  const [busySlug, setBusySlug] = useState(null);
  const [syncingSlug, setSyncingSlug] = useState(null);
  const [syncStatus, setSyncStatus] = useState({});
  const [pollFast, setPollFast] = useState(false);
  const [toast, setToast] = useState(null);
  const [lastReport, setLastReport] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [testHistory, setTestHistory] = useState(null);
  const [expandedTestId, setExpandedTestId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const poll = () => {
      getSyncStatus()
        .then((r) => {
          if (cancelled) return;
          setSyncStatus(r.by_supplier || {});
          const hasRunning = Object.values(r.by_supplier || {}).some((s) => s.status === 'RUNNING');
          setPollFast(hasRunning);
          timer = setTimeout(poll, hasRunning ? 3000 : 60000);
        })
        .catch(() => { if (!cancelled) timer = setTimeout(poll, 60000); });
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
          if (!Object.values(r.by_supplier || {}).some((s) => s.status === 'RUNNING')) setPollFast(false);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [pollFast]);

  useEffect(() => {
    if (detailItem) {
      setTestHistory(null);
      getSupplierTests(detailItem.supplier_slug)
        .then((r) => setTestHistory(r.tests))
        .catch(() => setTestHistory([]));
    }
  }, [detailItem]);

  useEffect(() => {
    if (data) {
      register('overview', {
        suppliers: data.suppliers,
        content_by_type: data.content_by_type,
        metrics: {
          total_24h: data.transactions.total_24h,
          success_rate_pct: data.transactions.success_rate_pct,
          avg_latency_ms: data.transactions.avg_latency_ms,
          pending_escalations: data.escalations.pending,
        },
      });
    }
  }, [data, register]);

  const doSync = (slug) => {
    setSyncingSlug(slug);
    setToast(null);
    setSyncStatus((prev) => ({
      ...prev,
      [slug]: { ...prev[slug], status: 'RUNNING', records_fetched: 0, records_upserted: 0, started_at: new Date().toISOString(), completed_at: null, error_message: null },
    }));
    setPollFast(true);
    triggerSync(slug)
      .then((r) => setToast({ kind: 'ok', text: `${slug}: ${r.message}` }))
      .catch((e) => {
        setSyncStatus((prev) => ({ ...prev, [slug]: { ...prev[slug], status: 'FAILED', error_message: e?.response?.data?.error || e.message } }));
        setToast({ kind: 'err', text: `${slug}: ${e?.response?.data?.error || e.message}` });
      })
      .finally(() => setSyncingSlug(null));
  };

  const doTest = async (slug) => {
    setBusySlug(slug);
    setToast(null);
    try {
      const r = await runSupplierTest(slug);
      const steps = r.report?.steps || [];
      const passed = steps.filter((s) => s.ok).length;
      const failMsg = r.report?.failure_report ? ` — ${r.report.failure_report}` : '';
      setLastReport({ slug, ...r });
      setToast({
        kind: r.status === 'PASS' ? 'ok' : 'err',
        text: `${slug}: ${r.status} ${passed}/${steps.length || 6}${failMsg}`,
        clickable: true,
      });
      await refetchInt();
    } catch (e) {
      setToast({ kind: 'err', text: `${slug}: ${e?.response?.data?.error || e.message}` });
    } finally { setBusySlug(null); }
  };

  const doReonboard = async (slug) => {
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

  if (loading) return <div className="p-8 text-text-secondary">Loading...</div>;
  if (error) return <div className="p-8 text-danger">{error}</div>;
  if (!data) return null;

  const { suppliers, transactions, agent_sessions, escalations, dedup, embedding_coverage, last_import_job, experience_categories } = data;
  const syncRows = data.sync_status_by_supplier || [];
  const contentRows = data.content_by_type || [];
  const integrations = intData?.integrations || [];
  const expCategories = experience_categories || [];

  const supplierSync = (slug) => syncRows.find((sr) => sr.supplier_slug === slug);
  const supplierInt = (slug) => integrations.find((i) => i.supplier_slug === slug);

  return (
    <div className="p-6 space-y-6">
      {toast && (
        <div className={`text-sm rounded-btn px-3 py-2 ${
          toast.kind === 'ok' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
        }`}>
          {toast.text}
          {toast.clickable && lastReport && (
            <button type="button" onClick={() => setReportOpen(true)}
              className="ml-2 underline opacity-80 hover:opacity-100">view report</button>
          )}
          <button type="button" onClick={() => setToast(null)} className="float-right text-xs opacity-60 hover:opacity-100">x</button>
        </div>
      )}

      {/* --- Inventory growth chart --- */}
      <InventoryGrowthChart />

      {/* --- Content by type --- */}
      {contentRows.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-text-secondary mb-2">Content by type</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {contentRows.map((c) => {
              const open = expandedType === c.type;
              return (
                <button
                  key={c.type}
                  type="button"
                  onClick={() => setExpandedType(open ? null : c.type)}
                  className={`bg-card-bg border rounded-card p-3 text-left transition-colors ${
                    open ? 'border-accent' : 'border-border-default hover:border-accent'
                  }`}
                >
                  <div className="text-xs text-text-secondary">{c.type}</div>
                  <div className="text-2xl font-semibold text-primary">{c.total_active.toLocaleString()}</div>
                  <div className="text-xs text-text-secondary mt-1">
                    {c.by_supplier.length} supplier{c.by_supplier.length !== 1 && 's'}
                  </div>
                </button>
              );
            })}
          </div>
          {expandedType && (
            <div className="mt-3 bg-card-bg border border-border-default rounded-card p-3 text-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="font-medium">{expandedType}</div>
                  {expandedType === 'EXPERIENCE' && (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setExpTab('supplier')}
                        className={`px-2 py-0.5 rounded-btn text-xs ${expTab === 'supplier' ? 'bg-accent text-white' : 'bg-page-bg text-text-secondary hover:text-text-primary'}`}>
                        By supplier
                      </button>
                      <button type="button" onClick={() => setExpTab('category')}
                        className={`px-2 py-0.5 rounded-btn text-xs ${expTab === 'category' ? 'bg-accent text-white' : 'bg-page-bg text-text-secondary hover:text-text-primary'}`}>
                        By category
                      </button>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => setExpandedType(null)}
                  className="text-text-secondary hover:text-danger text-xs">close</button>
              </div>
              {(expandedType !== 'EXPERIENCE' || expTab === 'supplier') && (
                <div className="divide-y divide-border-default">
                  {(contentRows.find((c) => c.type === expandedType)?.by_supplier || [])
                    .sort((a, b) => b.count - a.count)
                    .map((sv) => (
                    <div key={sv.supplier_slug} className="flex justify-between py-1.5 text-xs">
                      <span className="font-medium">{sv.supplier_slug}</span>
                      <span className="text-text-secondary">{sv.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              {expandedType === 'EXPERIENCE' && expTab === 'category' && (
                <div className="divide-y divide-border-default max-h-80 overflow-y-auto">
                  {expCategories.map((cat) => (
                    <details key={cat.category} className="group">
                      <summary className="flex justify-between py-1.5 text-xs cursor-pointer hover:bg-page-bg px-1 rounded">
                        <span className="font-medium">{cat.category}</span>
                        <span className="text-text-secondary">{cat.total.toLocaleString()}</span>
                      </summary>
                      <div className="pl-4 pb-1">
                        {cat.by_supplier.sort((a, b) => b.count - a.count).map((sv) => (
                          <div key={sv.supplier_slug} className="flex justify-between py-0.5 text-xs text-text-secondary">
                            <span>{sv.supplier_slug}</span>
                            <span>{sv.count.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* --- Supplier connections (unified with Integrations) --- */}
      <section>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-sm font-medium text-text-secondary">Supplier connections</h2>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="rounded-btn bg-accent text-white px-3 py-1.5 text-xs"
          >
            + Add Integration
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {suppliers.length === 0 && (
            <div className="text-text-secondary text-sm">No active integrations yet.</div>
          )}
          {suppliers.map((s) => {
            const sync = supplierSync(s.supplier_slug);
            const intg = supplierInt(s.supplier_slug);
            const ss = syncStatus[s.supplier_slug];
            const isRunning = ss?.status === 'RUNNING';
            const hasTraffic = s.transactions_24h > 0;

            const isDisabled = s.is_active === false || s.status === 'DISABLED';
            const statusDot = isDisabled ? 'bg-gray-400' : s.status === 'DOWN' ? 'bg-danger' : s.status === 'DEGRADED' ? 'bg-warning' : 'bg-success';
            const statusLabel = isDisabled ? 'Disabled' : s.status === 'DOWN' ? 'Errors' : s.status === 'DEGRADED' ? 'Slow' : 'Connected';
            const statusText = isDisabled ? 'text-gray-400' : s.status === 'DOWN' ? 'text-danger' : s.status === 'DEGRADED' ? 'text-warning' : 'text-success';

            return (
              <div key={s.supplier_slug} className={`rounded-card border p-4 shadow-sm ${
                isDisabled
                  ? 'bg-gray-50 border-gray-200 border-dashed'
                  : 'bg-card-bg border-border-default'
              }`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className={`font-semibold ${isDisabled ? 'text-gray-400' : 'text-text-primary'}`}>{s.name}</div>
                    <div className="text-xs text-text-secondary">
                      {(s.categories || intg?.categories || []).join(', ')}
                      {s.inventory_total > 0 && (
                        <span className={`ml-2 px-1.5 py-0.5 rounded font-medium ${
                          isDisabled ? 'bg-gray-100 text-gray-400' : 'bg-gray-100 text-text-primary'
                        }`}>
                          {(s.inventory_active || 0).toLocaleString()} / {(s.inventory_total || 0).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${
                    isDisabled ? 'bg-gray-100' : statusLabel === 'Connected' ? 'bg-emerald-50' : statusLabel === 'Errors' ? 'bg-red-50' : 'bg-amber-50'
                  }`}>
                    <span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} />
                    <span className={`text-xs font-medium ${statusText}`}>{statusLabel}</span>
                  </div>
                </div>

                {/* Inventory & sync info */}
                {sync && (sync.records_active > 0 || sync.records_inactive > 0) && (
                  <div className="mt-2 text-xs text-text-secondary">
                    <span className="font-medium text-text-primary">{(sync.records_active || 0).toLocaleString()}</span> items in catalog
                    {sync.last_synced_at && <span> &middot; synced {fmtAgo(sync.last_synced_at)}</span>}
                  </div>
                )}

                {/* Traffic stats or quiet message */}
                {hasTraffic ? (
                  <div className="grid grid-cols-3 mt-2 gap-2 text-xs">
                    <div>
                      <div className="text-text-secondary">Response time</div>
                      <div className="font-medium">{s.latency_p95_ms || 0}ms</div>
                    </div>
                    <div>
                      <div className="text-text-secondary">Error rate</div>
                      <div className="font-medium">{Number(s.error_rate_pct).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-text-secondary">API calls (24h)</div>
                      <div className="font-medium">{(s.transactions_24h || 0).toLocaleString()}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-text-secondary italic">
                    No API calls in the last 24 hours
                  </div>
                )}

                {/* Live sync status bar */}
                {ss && (
                  <div className={`mt-2 text-xs flex items-center gap-2 rounded-btn px-2.5 py-1.5 ${
                    isRunning ? 'bg-primary/5 border border-primary/20' : 'bg-page-bg'
                  }`}>
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      ss.status === 'COMPLETE' ? 'bg-success' : ss.status === 'FAILED' ? 'bg-danger' : 'bg-warning'
                    } ${isRunning ? 'animate-pulse' : ''}`} />
                    <span className="font-medium">{ss.status}</span>
                    {isRunning && (
                      <span className="text-text-secondary">
                        {ss.records_fetched > 0
                          ? `${ss.records_fetched.toLocaleString()} fetched`
                          : 'starting...'}
                      </span>
                    )}
                    {ss.status === 'COMPLETE' && (
                      <span className="text-text-secondary">
                        {(ss.records_upserted || 0).toLocaleString()} upserted &middot; {fmtAgo(ss.completed_at)}
                      </span>
                    )}
                    {ss.status === 'FAILED' && (
                      <span className="text-danger truncate max-w-[260px]" title={ss.error_message}>
                        {ss.error_message || 'Unknown error'}
                      </span>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => doSync(s.supplier_slug)}
                    disabled={syncingSlug === s.supplier_slug || isRunning}
                    className="rounded-btn bg-primary text-white px-3 py-1 text-xs hover:opacity-90 disabled:opacity-60"
                  >
                    {isRunning ? 'Syncing...' : 'Sync'}
                  </button>
                  <button
                    type="button"
                    onClick={() => doTest(s.supplier_slug)}
                    disabled={busySlug === s.supplier_slug}
                    className="rounded-btn border border-border-default px-3 py-1 text-xs hover:border-accent disabled:opacity-60"
                  >
                    {busySlug === s.supplier_slug ? 'Running...' : 'Run Tests'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setToast(null);
                      autoMapCategories({ supplier_slug: s.supplier_slug })
                        .then((r) => setToast({ kind: 'ok', text: `${s.supplier_slug}: mapped ${r.mapped} categories, ${r.created} new, ${r.skipped} flags skipped` }))
                        .catch((e) => setToast({ kind: 'err', text: `Taxonomy: ${e?.response?.data?.error || e.message}` }));
                    }}
                    className="rounded-btn border border-amber-400 text-amber-600 px-3 py-1 text-xs hover:bg-amber-50"
                  >
                    Sync Taxonomy
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailItem(intg || s)}
                    className="rounded-btn border border-border-default px-3 py-1 text-xs hover:border-accent"
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const enabling = isDisabled;
                      if (!enabling && !window.confirm(
                        `Disable ${s.name || s.supplier_slug}?\n\nThis will deactivate the supplier and mark all ${(s.inventory_active || 0).toLocaleString()} inventory items as inactive. You can re-enable it later.`
                      )) return;
                      toggleSupplier(s.supplier_slug, enabling)
                        .then((r) => {
                          setToast({ kind: 'ok', text: `${s.supplier_slug}: ${r.is_active ? 'enabled' : 'disabled'} — ${r.inventory_updated.toLocaleString()} items updated` });
                          refetch(); refetchInt();
                        })
                        .catch((e) => setToast({ kind: 'err', text: e?.response?.data?.error || e.message }));
                    }}
                    className={`rounded-btn px-3 py-1 text-xs ${
                      isDisabled
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600 border border-emerald-500'
                        : 'border border-red-300 text-red-500 hover:bg-red-50'
                    }`}
                  >
                    {isDisabled ? '● Enable' : 'Disable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => doReonboard(s.supplier_slug)}
                    disabled={busySlug === s.supplier_slug}
                    className="rounded-btn border border-border-default px-3 py-1 text-xs hover:border-accent disabled:opacity-60"
                    title="Re-run the onboarding wizard with the current manifest"
                  >
                    Re-onboard
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* --- Metrics --- */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Transactions (24h)" value={transactions.total_24h} />
        <MetricCard label="Success rate" value={`${transactions.success_rate_pct}%`} />
        <MetricCard label="Active sessions" value={agent_sessions.active} sub={`${agent_sessions.completed_24h} completed / ${agent_sessions.failed_24h} failed`} />
        <MetricCard label="Pending escalations" value={escalations.pending} sub={`${escalations.resolved_24h} resolved in 24h`} />
      </section>

      {/* --- Volume chart --- */}
      <VolumeChart data={transactions.volume_by_hour} />

      {/* --- Dedup status --- */}
      <section>
        <h2 className="text-sm font-medium text-text-secondary mb-2">Dedup status</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="Duplicates Hidden" value={dedup.duplicates_hidden?.toLocaleString()} />
          <MetricCard label="Unique Shown" value={dedup.unique_shown?.toLocaleString()} />
          <MetricCard label="Clusters" value={dedup.clusters?.toLocaleString()} />
          <MetricCard label="Experiences" value={dedup.total_experiences?.toLocaleString()} />
          <MetricCard label="Hotels" value={dedup.total_hotels?.toLocaleString()} />
          <MetricCard label="Transfers" value={dedup.total_transfers?.toLocaleString()} />
        </div>
      </section>

      {/* --- Embedding coverage --- */}
      {embedding_coverage && (
        <section>
          <h2 className="text-sm font-medium text-text-secondary mb-2">Embedding coverage</h2>
          <div className="bg-card-bg border border-border-default rounded-card p-4">
            <div className="flex items-center gap-4 mb-3">
              <div className="flex-1">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-secondary">
                    {(embedding_coverage.with_embedding || 0).toLocaleString()} / {(embedding_coverage.total || 0).toLocaleString()} records indexed
                  </span>
                  <span className={`font-medium ${
                    embedding_coverage.pct >= 95 ? 'text-success' :
                    embedding_coverage.pct >= 50 ? 'text-warning' : 'text-danger'
                  }`}>
                    {embedding_coverage.pct}%
                  </span>
                </div>
                <div className="w-full bg-page-bg rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all ${
                      embedding_coverage.pct >= 95 ? 'bg-success' :
                      embedding_coverage.pct >= 50 ? 'bg-warning' : 'bg-danger'
                    }`}
                    style={{ width: `${Math.min(100, embedding_coverage.pct)}%` }}
                  />
                </div>
              </div>
              {embedding_coverage.without_embedding > 0 && (
                <div className="text-xs text-warning font-medium whitespace-nowrap">
                  {embedding_coverage.without_embedding.toLocaleString()} missing
                </div>
              )}
            </div>
            {embedding_coverage.by_supplier?.length > 0 && (
              <div className="divide-y divide-border-default">
                {embedding_coverage.by_supplier.map((s) => (
                  <div key={s.supplier_slug} className="flex items-center justify-between py-1.5 text-xs">
                    <span className="font-medium">{s.supplier_slug}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-text-secondary">
                        {s.with_embedding.toLocaleString()} / {s.total.toLocaleString()}
                      </span>
                      <span className={`font-medium w-12 text-right ${
                        s.pct >= 95 ? 'text-success' : s.pct >= 50 ? 'text-warning' : 'text-danger'
                      }`}>
                        {s.pct}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {last_import_job && (
            <div className="mt-2 text-xs text-text-secondary">
              Last import: <span className="font-medium">{last_import_job.status}</span>
              {last_import_job.records_upserted > 0 && (
                <span> &middot; {last_import_job.records_upserted.toLocaleString()} records</span>
              )}
              {last_import_job.duration_sec > 0 && (
                <span> &middot; {Math.round(last_import_job.duration_sec / 60)} min</span>
              )}
              {last_import_job.completed_at && (
                <span> &middot; {fmtAgo(last_import_job.completed_at)}</span>
              )}
            </div>
          )}
        </section>
      )}

      {/* --- Onboarding wizard modal --- */}
      {wizardOpen && (
        <OnboardingWizard
          existingSession={reonboardSession}
          onClose={() => { setWizardOpen(false); setReonboardSession(null); refetch(); refetchInt(); }}
        />
      )}

      {/* --- Validation report modal --- */}
      {reportOpen && lastReport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-40"
             onClick={() => setReportOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-card-bg rounded-card shadow-md w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-border-default flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-primary">Validation report - {lastReport.slug}</h3>
                <div className="text-xs text-text-secondary">
                  Session {lastReport.session_id?.slice(0, 8)}... &middot; Status{' '}
                  <span className={lastReport.status === 'PASS' ? 'text-success' : 'text-danger'}>{lastReport.status}</span>
                </div>
              </div>
              <button onClick={() => setReportOpen(false)} className="text-text-secondary hover:text-danger text-lg leading-none">x</button>
            </div>
            <div className="p-5 space-y-2 text-sm">
              {(lastReport.report?.steps || []).map((step) => (
                <div key={step.name} className="border border-border-default rounded-btn px-3 py-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      <span className={`mr-2 font-mono ${step.ok ? 'text-success' : 'text-danger'}`}>
                        {step.ok ? 'v' : 'x'}
                      </span>
                      Step {step.step}: {step.name}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      {step.marked_untested && 'skipped '}
                      {step.marked_optional && 'optional '}
                      {step.attempts != null && `attempts: ${step.attempts}`}
                      {step.pass_rate != null && ` pass rate: ${(step.pass_rate * 100).toFixed(0)}%`}
                      {step.error && <span className="text-danger"> {step.error}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-text-secondary whitespace-nowrap">
                    {step.latency_ms != null ? `${step.latency_ms} ms` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --- Supplier detail modal --- */}
      {detailItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-40"
             onClick={() => setDetailItem(null)}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-card-bg rounded-card shadow-md w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-border-default flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-primary">{detailItem.name}</h3>
                <div className="text-xs text-text-secondary">{detailItem.supplier_slug}</div>
              </div>
              <button onClick={() => setDetailItem(null)} className="text-text-secondary hover:text-danger text-lg leading-none">x</button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-text-secondary text-xs">Status</div><div className="font-medium">{detailItem.status}</div></div>
                <div><div className="text-text-secondary text-xs">SLA Tier</div><div className="font-medium">{detailItem.sla_tier || '—'}</div></div>
                <div><div className="text-text-secondary text-xs">Categories</div><div>{(detailItem.categories || []).join(', ') || '—'}</div></div>
                <div><div className="text-text-secondary text-xs">Activated</div><div>{detailItem.activated_at ? new Date(detailItem.activated_at).toLocaleDateString() : '—'}</div></div>
              </div>
              {detailItem.operations && (
                <div>
                  <div className="text-text-secondary text-xs mb-1">Operations</div>
                  <div className="flex flex-wrap gap-2">
                    {detailItem.operations.map((op) => (
                      <span key={op} className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">{op}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-text-secondary text-xs mb-2 mt-2">Test history</div>
                {testHistory === null && <div className="text-xs text-text-secondary">Loading...</div>}
                {testHistory && testHistory.length === 0 && (
                  <div className="text-xs text-text-secondary">No test runs recorded yet.</div>
                )}
                {testHistory && testHistory.length > 0 && (
                  <div className="space-y-1">
                    {testHistory.map((t) => {
                      const open = expandedTestId === t.id;
                      const steps = t.report?.steps || [];
                      const passed = steps.filter((st) => st.ok).length;
                      return (
                        <div key={t.id} className="border border-border-default rounded-btn">
                          <button type="button"
                            onClick={() => setExpandedTestId(open ? null : t.id)}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-page-bg">
                            <div className="flex items-center gap-2">
                              <span className={`font-mono ${t.status === 'PASS' ? 'text-success' : 'text-danger'}`}>
                                {t.status === 'PASS' ? 'v' : 'x'}
                              </span>
                              <span className="font-medium">{t.status}</span>
                              {steps.length > 0 && <span className="text-text-secondary">{passed}/{steps.length}</span>}
                              <span className="text-text-secondary">{new Date(t.ran_at).toLocaleString()}</span>
                            </div>
                            <span className="text-text-secondary">{open ? 'v' : '>'}</span>
                          </button>
                          {open && (
                            <div className="border-t border-border-default p-3 space-y-1 bg-page-bg">
                              {steps.length === 0 && (
                                <div className="text-xs text-text-secondary">No step breakdown stored.</div>
                              )}
                              {steps.map((st) => (
                                <div key={st.name} className="flex justify-between items-start text-xs">
                                  <div>
                                    <span className={`mr-2 font-mono ${st.ok ? 'text-success' : 'text-danger'}`}>
                                      {st.ok ? 'v' : 'x'}
                                    </span>
                                    Step {st.step}: {st.name}
                                    {st.error && <span className="text-danger"> - {st.error}</span>}
                                  </div>
                                  <div className="text-text-secondary whitespace-nowrap ml-3">
                                    {st.latency_ms != null ? `${st.latency_ms}ms` : ''}
                                  </div>
                                </div>
                              ))}
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
