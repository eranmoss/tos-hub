import { useState, useEffect, useCallback } from 'react';
import { getRankingConfig, patchRankingConfig } from '../api/dashboard.js';

const WEIGHT_DEFS = [
  { key: 'semantic',          label: 'Semantic Relevance', color: 'bg-blue-500',   desc: 'pgvector cosine similarity — the dominant signal' },
  { key: 'popularity',        label: 'Popularity',         color: 'bg-emerald-500', desc: 'Bookings, clicks, conversion rate (log-normalized)' },
  { key: 'rating',            label: 'Rating & Reviews',   color: 'bg-amber-500',   desc: 'Bayesian avg: rating * confidence from review count' },
  { key: 'margin',            label: 'Margin',             color: 'bg-violet-500',  desc: 'Commission rate / margin percentage' },
  { key: 'availability',      label: 'Availability',       color: 'bg-cyan-500',    desc: 'Live availability signal (1.0 = confirmed, 0 = sold out)' },
  { key: 'supplier_priority', label: 'Supplier Priority',  color: 'bg-rose-400',    desc: 'Preferred / standard / deprioritized supplier' },
];

const FALLBACK_FIELDS = [
  { key: 'popularity_fallback',  label: 'Popularity (no data)', min: 0, max: 1, step: 0.05 },
  { key: 'rating_fallback',      label: 'Rating (no data)',     min: 0, max: 1, step: 0.05 },
  { key: 'margin_fallback',      label: 'Margin (no data)',     min: 0, max: 1, step: 0.05 },
  { key: 'availability_fallback',label: 'Availability (unknown)',min: 0, max: 1, step: 0.05 },
];

const DEFAULT_WEIGHTS = {
  semantic: 0.55, popularity: 0.15, rating: 0.10,
  margin: 0.10, availability: 0.07, supplier_priority: 0.03,
};

export default function RankingConfigEditor() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState('loading');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getRankingConfig()
      .then((d) => { setConfig(d.config); setStatus('idle'); })
      .catch(() => {
        setConfig({
          weights: { ...DEFAULT_WEIGHTS },
          popularity_fallback: 0.3,
          rating_fallback: 0.5,
          margin_fallback: 0.3,
          availability_fallback: 0.5,
          rating_confidence_threshold: 50,
          boost_events_with_availability: true,
        });
        setStatus('idle');
      });
  }, []);

  const weights = config?.weights || DEFAULT_WEIGHTS;
  const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);

  const setWeight = useCallback((key, val) => {
    setConfig((prev) => ({
      ...prev,
      weights: { ...prev.weights, [key]: Number(val) },
    }));
    setDirty(true);
  }, []);

  const setFallback = useCallback((key, val) => {
    setConfig((prev) => ({ ...prev, [key]: Number(val) }));
    setDirty(true);
  }, []);

  const setField = useCallback((key, val) => {
    setConfig((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }, []);

  const normalizeWeights = () => {
    if (totalWeight === 0) return;
    const factor = 1 / totalWeight;
    const normalized = {};
    for (const k of Object.keys(weights)) {
      normalized[k] = parseFloat((weights[k] * factor).toFixed(4));
    }
    setConfig((prev) => ({ ...prev, weights: normalized }));
    setDirty(true);
  };

  const resetDefaults = () => {
    setConfig((prev) => ({ ...prev, weights: { ...DEFAULT_WEIGHTS } }));
    setDirty(true);
  };

  const save = async () => {
    setStatus('saving');
    try {
      const result = await patchRankingConfig(config);
      setConfig(result.config);
      setStatus('saved');
      setDirty(false);
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
    }
  };

  if (!config) {
    return <div className="text-text-secondary text-sm py-8 text-center">Loading ranking config...</div>;
  }

  const weightWarning = Math.abs(totalWeight - 1.0) > 0.01;

  return (
    <div className="space-y-5">
      {/* Weight Distribution Visual */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-text-primary">Score Weights</h3>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono ${weightWarning ? 'text-amber-600 font-semibold' : 'text-text-secondary'}`}>
              Total: {totalWeight.toFixed(2)}
            </span>
            {weightWarning && (
              <button
                type="button"
                onClick={normalizeWeights}
                className="text-xs px-2 py-0.5 rounded-btn border border-amber-400 text-amber-600 hover:bg-amber-50"
              >
                Normalize to 1.0
              </button>
            )}
            <button
              type="button"
              onClick={resetDefaults}
              className="text-xs px-2 py-0.5 rounded-btn border border-border-default text-text-secondary hover:bg-gray-50"
            >
              Reset defaults
            </button>
          </div>
        </div>

        {/* Stacked bar preview */}
        <div className="h-6 rounded-btn overflow-hidden flex mb-3" title="Weight distribution">
          {WEIGHT_DEFS.map((w) => {
            const pct = totalWeight > 0 ? (weights[w.key] / totalWeight) * 100 : 0;
            return pct > 0 ? (
              <div
                key={w.key}
                className={`${w.color} transition-all duration-200 flex items-center justify-center`}
                style={{ width: `${pct}%` }}
              >
                {pct >= 8 && <span className="text-[10px] text-white font-medium">{Math.round(pct)}%</span>}
              </div>
            ) : null;
          })}
        </div>

        {/* Sliders */}
        <div className="space-y-2.5">
          {WEIGHT_DEFS.map((w) => (
            <div key={w.key} className="grid grid-cols-[180px_1fr_60px] gap-3 items-center">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${w.color} shrink-0`} />
                  <span className="text-xs font-medium text-text-primary">{w.label}</span>
                </div>
                <div className="text-[10px] text-text-secondary ml-4 mt-0.5 leading-tight">{w.desc}</div>
              </div>
              <input
                type="range"
                min="0" max="1" step="0.01"
                value={weights[w.key] ?? 0}
                onChange={(e) => setWeight(w.key, e.target.value)}
                className="w-full accent-accent"
              />
              <input
                type="number"
                min="0" max="1" step="0.01"
                value={weights[w.key] ?? 0}
                onChange={(e) => setWeight(w.key, e.target.value)}
                className="w-full text-xs text-center border border-border-default rounded-btn px-1 py-0.5 font-mono"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Fallback Values */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-2">Fallback Values</h3>
        <p className="text-[10px] text-text-secondary mb-3">Score used when real data is missing for an item</p>
        <div className="grid grid-cols-2 gap-3">
          {FALLBACK_FIELDS.map((f) => (
            <label key={f.key} className="text-xs">
              <div className="text-text-secondary mb-1">{f.label}</div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={f.min} max={f.max} step={f.step}
                  value={config[f.key] ?? 0.5}
                  onChange={(e) => setFallback(f.key, e.target.value)}
                  className="flex-1 accent-accent"
                />
                <span className="font-mono w-8 text-right">{(config[f.key] ?? 0.5).toFixed(2)}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Advanced */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-2">Advanced</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">
            <div className="text-text-secondary mb-1">Rating confidence threshold (reviews)</div>
            <input
              type="number"
              min="1" max="500" step="1"
              value={config.rating_confidence_threshold ?? 50}
              onChange={(e) => setField('rating_confidence_threshold', parseInt(e.target.value, 10) || 50)}
              className="w-full border border-border-default rounded-btn px-2 py-1 font-mono"
            />
          </label>
          <label className="text-xs flex items-center gap-2 mt-4">
            <input
              type="checkbox"
              checked={config.boost_events_with_availability ?? true}
              onChange={(e) => setField('boost_events_with_availability', e.target.checked)}
              className="accent-accent"
            />
            <span className="text-text-secondary">Boost events with confirmed availability</span>
          </label>
        </div>
      </div>

      {/* Formula preview */}
      <div className="bg-gray-50 border border-border-default rounded-card p-3">
        <div className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
          Live Formula
        </div>
        <code className="text-xs leading-relaxed text-text-primary block font-mono">
          final_score = semantic * {(weights.semantic ?? 0).toFixed(2)}
          {' + '}popularity * {(weights.popularity ?? 0).toFixed(2)}
          {' + '}rating * {(weights.rating ?? 0).toFixed(2)}
          {' + '}margin * {(weights.margin ?? 0).toFixed(2)}
          {' + '}availability * {(weights.availability ?? 0).toFixed(2)}
          {' + '}supplier * {(weights.supplier_priority ?? 0).toFixed(2)}
        </code>
      </div>

      {/* Save */}
      <div className="flex items-center justify-between pt-2 border-t border-border-default">
        <div className="text-xs text-text-secondary">
          {status === 'saved' && <span className="text-emerald-600">Saved</span>}
          {status === 'error' && <span className="text-red-600">Error saving config</span>}
          {status === 'saving' && <span className="text-blue-600">Saving...</span>}
          {weightWarning && status === 'idle' && (
            <span className="text-amber-600">Weights don't sum to 1.0 — normalize or adjust</span>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || status === 'saving'}
          className={`text-xs px-4 py-1.5 rounded-btn font-medium ${
            dirty
              ? 'bg-accent text-white hover:opacity-90'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          Save Ranking Config
        </button>
      </div>
    </div>
  );
}
