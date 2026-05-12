import { useState, useEffect, useCallback } from 'react';
import {
  getGoldDataset, sampleGoldPairs, labelGoldPairs,
  evalGoldDataset, deleteGoldDataset,
} from '../api/dashboard.js';

const Info = ({ tip }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block ml-1 align-middle">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 text-[9px] font-semibold text-gray-400 hover:text-accent hover:border-accent cursor-help leading-none"
      >i</button>
      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-3 py-2 shadow-lg pointer-events-none">
          {tip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </span>
  );
};

const fmt = (n, dec = 0) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—';
const pct = (n) => n != null ? `${(n * 100).toFixed(1)}%` : '—';

const BAND_LABELS = {
  high_dup: { label: 'High Dup', color: 'bg-red-100 text-red-700', desc: 'sim > 0.90 — should all be DUPLICATE' },
  medium_dup: { label: 'Medium Dup', color: 'bg-orange-100 text-orange-700', desc: 'sim 0.85-0.90 — most are DUPLICATE' },
  borderline: { label: 'Borderline', color: 'bg-amber-100 text-amber-700', desc: 'sim 0.70-0.85 — the hard zone' },
  near_miss: { label: 'Near Miss', color: 'bg-blue-100 text-blue-700', desc: 'sim 0.60-0.70 — should be DISTINCT' },
  clear_distinct: { label: 'Clear Distinct', color: 'bg-emerald-100 text-emerald-700', desc: 'cross-city random pairs' },
};

const BandPill = ({ band }) => {
  const b = BAND_LABELS[band] || { label: band, color: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded ${b.color}`}>{b.label}</span>;
};

export default function GoldDatasetEval() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionStatus, setActionStatus] = useState(null);
  const [evalResult, setEvalResult] = useState(null);
  const [dupThresh, setDupThresh] = useState(0.85);
  const [uncThresh, setUncThresh] = useState(0.70);
  const [tab, setTab] = useState('overview');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getGoldDataset()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const action = async (label, fn) => {
    setActionStatus({ text: `${label}...`, type: 'pending' });
    try {
      const result = await fn();
      setActionStatus({ text: `${label} complete`, type: 'success', result });
      load();
    } catch (e) {
      setActionStatus({ text: `${label} failed: ${e.message}`, type: 'error' });
    }
  };

  const runEval = async () => {
    setActionStatus({ text: 'Running eval...', type: 'pending' });
    try {
      const result = await evalGoldDataset({ duplicate: dupThresh, uncertain: uncThresh });
      setEvalResult(result);
      setActionStatus({ text: 'Eval complete', type: 'success' });
      load();
    } catch (e) {
      setActionStatus({ text: `Eval failed: ${e.message}`, type: 'error' });
    }
  };

  if (loading) return <div className="text-text-secondary text-sm py-8 text-center">Loading gold dataset...</div>;
  if (error) return <div className="text-red-600 text-sm py-4">Error: {error}</div>;
  if (!data) return null;

  const { summary, band_summary, pairs, eval_runs } = data;
  const hasData = summary.total > 0;
  const allLabeled = summary.total > 0 && summary.labeled === summary.total;
  const latestEval = evalResult || (eval_runs?.[0] ? {
    ...eval_runs[0],
    precision: eval_runs[0].precision_val,
    recall: eval_runs[0].recall_val,
    f1: eval_runs[0].f1_val,
    tp: eval_runs[0].true_positives,
    fp: eval_runs[0].false_positives,
    tn: eval_runs[0].true_negatives,
    fn: eval_runs[0].false_negatives,
    per_band: eval_runs[0].per_band,
    config: eval_runs[0].config_snapshot,
  } : null);

  return (
    <div className="space-y-4">
      {/* Header + Actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            Gold Dataset<Info tip="A stratified sample of 200 inventory pairs labeled as DUPLICATE or DISTINCT by LLM. Used to compute precision, recall, and F1 for the dedup engine. Re-run eval after tuning thresholds to measure improvement." />
          </h3>
          <div className="text-[10px] text-text-secondary">
            {summary.total} pairs · {summary.labeled} labeled · {summary.label_dup} dup · {summary.label_dist} distinct
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {!hasData && (
            <button type="button" onClick={() => action('Sampling 200 pairs', sampleGoldPairs)}
              className="text-xs px-3 py-1.5 rounded-btn bg-accent text-white hover:opacity-90">
              Sample 200 Pairs
            </button>
          )}
          {hasData && !allLabeled && (
            <button type="button" onClick={() => action('Labeling with LLM', labelGoldPairs)}
              className="text-xs px-3 py-1.5 rounded-btn border border-violet-500 text-violet-600 hover:bg-violet-50">
              Label with LLM
            </button>
          )}
          {allLabeled && (
            <button type="button" onClick={runEval}
              className="text-xs px-3 py-1.5 rounded-btn bg-accent text-white hover:opacity-90">
              Run Eval
            </button>
          )}
          {hasData && (
            <>
              <button type="button" onClick={load}
                className="text-xs px-3 py-1.5 rounded-btn border border-border-default text-text-secondary hover:bg-gray-50">
                Refresh
              </button>
              <button type="button"
                onClick={() => { if (confirm('Delete all gold pairs?')) action('Deleting gold dataset', deleteGoldDataset); }}
                className="text-xs px-3 py-1.5 rounded-btn border border-red-300 text-red-500 hover:bg-red-50">
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      {actionStatus && (
        <div className={`flex items-center gap-3 text-xs px-3 py-2 rounded-btn ${
          actionStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : actionStatus.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          <span className="flex-1">{actionStatus.text}</span>
          <button type="button" onClick={() => setActionStatus(null)} className="text-current opacity-50 hover:opacity-100">&times;</button>
        </div>
      )}

      {/* Tabs */}
      {hasData && (
        <div className="flex gap-1">
          {['overview', 'pairs', 'history'].map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-medium rounded-btn border ${
                tab === t ? 'bg-accent text-white border-accent' : 'border-border-default text-text-secondary hover:bg-gray-50'
              }`}>
              {t === 'overview' ? 'Overview' : t === 'pairs' ? 'Pair Browser' : 'Eval History'}
            </button>
          ))}
        </div>
      )}

      {/* Overview Tab */}
      {tab === 'overview' && hasData && (
        <>
          {/* Eval Results */}
          {latestEval && (
            <div className="bg-white border border-border-default rounded-card p-4">
              <div className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-3">
                Latest Eval<Info tip="Compares the dedup engine's decide() output against gold labels. TP = engine says DUPLICATE and label agrees. FP = engine says DUPLICATE but label says DISTINCT (false alarm). FN = engine says DISTINCT but label says DUPLICATE (missed duplicate)." />
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-3xl font-semibold text-accent">{pct(latestEval.precision)}</div>
                  <div className="text-[10px] text-text-secondary mt-1">
                    Precision<Info tip="TP / (TP + FP). Of all pairs the engine called DUPLICATE, how many actually are? Low precision = too many false merges (hiding unique products)." />
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-semibold text-blue-600">{pct(latestEval.recall)}</div>
                  <div className="text-[10px] text-text-secondary mt-1">
                    Recall<Info tip="TP / (TP + FN). Of all actual duplicates, how many did the engine find? Low recall = too many missed duplicates (showing redundant results)." />
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-semibold text-emerald-600">{pct(latestEval.f1)}</div>
                  <div className="text-[10px] text-text-secondary mt-1">
                    F1<Info tip="Harmonic mean of precision and recall. Single number that balances both. Higher is better. 1.0 = perfect." />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div><div className="font-mono font-semibold text-emerald-600">{latestEval.tp}</div><div className="text-[9px] text-text-secondary">True Pos</div></div>
                <div><div className="font-mono font-semibold text-red-500">{latestEval.fp}</div><div className="text-[9px] text-text-secondary">False Pos</div></div>
                <div><div className="font-mono font-semibold text-emerald-600">{latestEval.tn}</div><div className="text-[9px] text-text-secondary">True Neg</div></div>
                <div><div className="font-mono font-semibold text-red-500">{latestEval.fn}</div><div className="text-[9px] text-text-secondary">False Neg</div></div>
              </div>
              {latestEval.config && (
                <div className="mt-3 text-[10px] text-text-secondary">
                  Thresholds: dup={latestEval.config.duplicate_threshold} unc={latestEval.config.uncertain_threshold}
                </div>
              )}
            </div>
          )}

          {/* Per-Band Breakdown */}
          {latestEval?.per_band && (
            <div className="bg-white border border-border-default rounded-card p-4">
              <div className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Per-Band Breakdown<Info tip="Shows how the engine performs across different similarity bands. Expect near-perfect scores at the extremes (high_dup, clear_distinct) and more errors in the borderline zone." />
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-text-secondary uppercase">
                    <th className="text-left py-1">Band</th>
                    <th className="text-right py-1">Pairs</th>
                    <th className="text-right py-1">TP</th>
                    <th className="text-right py-1">FP</th>
                    <th className="text-right py-1">TN</th>
                    <th className="text-right py-1">FN</th>
                    <th className="text-right py-1">Precision</th>
                    <th className="text-right py-1">Recall</th>
                    <th className="text-right py-1">F1</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(latestEval.per_band).map(([band, s]) => (
                    <tr key={band} className="border-t border-border-default">
                      <td className="py-1.5"><BandPill band={band} /></td>
                      <td className="py-1.5 text-right font-mono">{s.total}</td>
                      <td className="py-1.5 text-right font-mono text-emerald-600">{s.tp}</td>
                      <td className="py-1.5 text-right font-mono text-red-500">{s.fp}</td>
                      <td className="py-1.5 text-right font-mono text-emerald-600">{s.tn}</td>
                      <td className="py-1.5 text-right font-mono text-red-500">{s.fn}</td>
                      <td className="py-1.5 text-right font-mono">{s.precision != null ? pct(s.precision) : '—'}</td>
                      <td className="py-1.5 text-right font-mono">{s.recall != null ? pct(s.recall) : '—'}</td>
                      <td className="py-1.5 text-right font-mono font-semibold">{s.f1 != null ? pct(s.f1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Threshold Sliders */}
          {allLabeled && (
            <div className="bg-white border border-border-default rounded-card p-4">
              <div className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-3">
                Threshold Tuning<Info tip="Adjust duplicate and uncertain thresholds, then run eval to see how P/R/F1 change. Lower duplicate threshold = more aggressive dedup (higher recall, lower precision). Higher = more conservative (higher precision, lower recall)." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-text-secondary block mb-1">
                    Duplicate Threshold: <span className="font-mono font-semibold">{dupThresh.toFixed(2)}</span>
                  </label>
                  <input type="range" min="0.60" max="0.95" step="0.01"
                    value={dupThresh} onChange={(e) => setDupThresh(parseFloat(e.target.value))}
                    className="w-full accent-accent" />
                </div>
                <div>
                  <label className="text-[10px] text-text-secondary block mb-1">
                    Uncertain Threshold: <span className="font-mono font-semibold">{uncThresh.toFixed(2)}</span>
                  </label>
                  <input type="range" min="0.50" max="0.85" step="0.01"
                    value={uncThresh} onChange={(e) => setUncThresh(parseFloat(e.target.value))}
                    className="w-full accent-accent" />
                </div>
              </div>
              <button type="button" onClick={runEval}
                className="mt-3 text-xs px-4 py-1.5 rounded-btn bg-accent text-white hover:opacity-90">
                Run Eval with These Thresholds
              </button>
            </div>
          )}

          {/* Band Summary */}
          <div className="bg-white border border-border-default rounded-card p-4">
            <div className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
              Band Summary<Info tip="How many pairs were sampled per confidence band. Target: 200 total stratified across 5 bands to stress-test the engine at different similarity levels." />
            </div>
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(BAND_LABELS).map(([band, meta]) => {
                const bs = band_summary[band] || { total: 0, labeled: 0, dup: 0, dist: 0 };
                return (
                  <div key={band} className="text-center p-2 bg-gray-50 rounded-card">
                    <BandPill band={band} />
                    <div className="text-lg font-semibold mt-1">{bs.total}</div>
                    <div className="text-[9px] text-text-secondary">{bs.labeled} labeled</div>
                    <div className="text-[9px] text-text-secondary">{bs.dup}D / {bs.dist}S</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mismatches */}
          {latestEval?.mismatches?.length > 0 && (
            <div className="bg-white border border-red-200 rounded-card p-4">
              <div className="text-[10px] font-semibold text-red-600 uppercase tracking-wider mb-2">
                Mismatches (Top 20)<Info tip="Pairs where the engine's decision disagreed with the gold label. FP = engine merged two distinct products. FN = engine missed a real duplicate. Review these to understand engine weaknesses." />
              </div>
              <div className="space-y-2">
                {latestEval.mismatches.map((m, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr_1fr_60px] gap-2 items-center text-[10px] border-b border-border-default pb-1">
                    <BandPill band={m.band} />
                    <div className="truncate" title={m.title_a}>{m.title_a}</div>
                    <div className="truncate" title={m.title_b}>{m.title_b}</div>
                    <div className="text-right">
                      <span className={m.predicted === 'DUPLICATE' ? 'text-red-500' : 'text-amber-600'}>
                        {m.predicted === 'DUPLICATE' ? 'FP' : 'FN'}
                      </span>
                      <span className="text-text-secondary ml-1">{m.emb_sim?.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Pair Browser Tab */}
      {tab === 'pairs' && (
        <div className="bg-white border border-border-default rounded-card p-4">
          <div className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
            All Gold Pairs ({pairs.length})
          </div>
          <div className="max-h-[500px] overflow-auto">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-white">
                <tr className="text-text-secondary uppercase">
                  <th className="text-left py-1 px-1">Band</th>
                  <th className="text-left py-1 px-1">Title A</th>
                  <th className="text-left py-1 px-1">Title B</th>
                  <th className="text-left py-1 px-1">Suppliers</th>
                  <th className="text-right py-1 px-1">Sim</th>
                  <th className="text-left py-1 px-1">Label</th>
                  <th className="text-left py-1 px-1">Reason</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.id} className="border-t border-border-default hover:bg-gray-50">
                    <td className="py-1 px-1"><BandPill band={p.band} /></td>
                    <td className="py-1 px-1 max-w-[180px] truncate" title={p.title_a}>{p.title_a}</td>
                    <td className="py-1 px-1 max-w-[180px] truncate" title={p.title_b}>{p.title_b}</td>
                    <td className="py-1 px-1 text-text-secondary">{p.supplier_a} / {p.supplier_b}</td>
                    <td className="py-1 px-1 text-right font-mono">{p.emb_sim?.toFixed(3)}</td>
                    <td className="py-1 px-1">
                      {p.label ? (
                        <span className={p.label === 'DUPLICATE' ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>
                          {p.label === 'DUPLICATE' ? 'DUP' : 'DIST'}
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-1 px-1 text-text-secondary max-w-[120px] truncate" title={p.label_reason}>{p.label_reason || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Eval History Tab */}
      {tab === 'history' && (
        <div className="bg-white border border-border-default rounded-card p-4">
          <div className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Eval Run History<Info tip="Each row is a past eval run with its threshold settings and results. Compare runs to see how threshold changes affect P/R/F1." />
          </div>
          {eval_runs.length === 0 ? (
            <div className="text-text-secondary text-xs py-4 text-center">No eval runs yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-text-secondary uppercase">
                  <th className="text-left py-1">Date</th>
                  <th className="text-right py-1">Pairs</th>
                  <th className="text-right py-1">Precision</th>
                  <th className="text-right py-1">Recall</th>
                  <th className="text-right py-1">F1</th>
                  <th className="text-right py-1">TP/FP/TN/FN</th>
                  <th className="text-right py-1">Dup Thresh</th>
                </tr>
              </thead>
              <tbody>
                {eval_runs.map((run) => (
                  <tr key={run.id} className="border-t border-border-default">
                    <td className="py-1.5 text-text-secondary">{new Date(run.created_at).toLocaleString()}</td>
                    <td className="py-1.5 text-right font-mono">{run.total_pairs}</td>
                    <td className="py-1.5 text-right font-mono">{(run.precision_val * 100).toFixed(1)}%</td>
                    <td className="py-1.5 text-right font-mono">{(run.recall_val * 100).toFixed(1)}%</td>
                    <td className="py-1.5 text-right font-mono font-semibold">{(run.f1_val * 100).toFixed(1)}%</td>
                    <td className="py-1.5 text-right font-mono text-[10px]">
                      {run.true_positives}/{run.false_positives}/{run.true_negatives}/{run.false_negatives}
                    </td>
                    <td className="py-1.5 text-right font-mono">{run.config_snapshot?.duplicate_threshold ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Empty state */}
      {!hasData && (
        <div className="bg-gray-50 border border-border-default rounded-card p-8 text-center">
          <div className="text-lg font-semibold text-text-secondary mb-2">No Gold Dataset Yet</div>
          <div className="text-xs text-text-secondary mb-4 max-w-md mx-auto">
            Sample 200 stratified pairs across 5 confidence bands, label them with LLM,
            then run eval to get precision/recall/F1 scores for the dedup engine.
          </div>
          <button type="button" onClick={() => action('Sampling 200 pairs', sampleGoldPairs)}
            className="text-xs px-4 py-2 rounded-btn bg-accent text-white hover:opacity-90">
            Sample 200 Pairs
          </button>
        </div>
      )}
    </div>
  );
}
