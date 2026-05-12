import { useState, useEffect } from 'react';
import { getDedupConfig, patchDedupConfig } from '../api/dashboard.js';

const DEFAULT_CONFIG = {
  strategy: 'LOWEST_PRICE',
  uncertain_behavior: 'SHOW_BOTH',
  thresholds: { embedding_duplicate: 0.85, embedding_uncertain: 0.70, max_cluster_size: 10 },
};

export default function DedupConfigEditor() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [testMode, setTestMode] = useState(false);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    getDedupConfig().then((d) => {
      if (d?.config_json) setConfig({ ...DEFAULT_CONFIG, ...d.config_json, thresholds: { ...DEFAULT_CONFIG.thresholds, ...d.config_json?.thresholds } });
      if (typeof d?.test_mode === 'boolean') setTestMode(d.test_mode);
    }).catch(() => {});
  }, []);

  const t = config.thresholds;
  const thresholdsValid = t.embedding_duplicate > t.embedding_uncertain && t.embedding_uncertain > 0;

  const save = async () => {
    setStatus('saving');
    try {
      await patchDedupConfig({ config_json: config, test_mode: testMode });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  const setThreshold = (key, val) =>
    setConfig({ ...config, thresholds: { ...config.thresholds, [key]: Number(val) } });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <div className="text-text-secondary text-xs">Strategy (when duplicate found)</div>
          <select
            value={config.strategy}
            onChange={(e) => setConfig({ ...config, strategy: e.target.value })}
            className="mt-1 block w-full rounded-btn border border-border-default px-2 py-1"
          >
            <option value="LOWEST_PRICE">LOWEST_PRICE</option>
            <option value="PREFERRED_SUPPLIER">PREFERRED_SUPPLIER</option>
            <option value="SHOW_ALL">SHOW_ALL</option>
          </select>
        </label>
        <label className="text-sm">
          <div className="text-text-secondary text-xs">Uncertain behavior</div>
          <select
            value={config.uncertain_behavior}
            onChange={(e) => setConfig({ ...config, uncertain_behavior: e.target.value })}
            className="mt-1 block w-full rounded-btn border border-border-default px-2 py-1"
          >
            <option value="SHOW_BOTH">SHOW_BOTH</option>
            <option value="ESCALATE">ESCALATE</option>
            <option value="AGENT_DECIDE">AGENT_DECIDE</option>
          </select>
        </label>
      </div>

      <div>
        <div className="text-text-secondary text-xs mb-2">Embedding Similarity Thresholds</div>
        <div className="text-text-secondary text-[10px] mb-2">
          Pairs within the same city are compared using title embeddings (MiniLM-L6). Different cities are always distinct.
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs">
            <div className="flex justify-between">
              <span>Duplicate</span>
              <span className="font-mono">{t.embedding_duplicate}</span>
            </div>
            <input
              type="range" min="0.50" max="1.00" step="0.01"
              value={t.embedding_duplicate}
              onChange={(e) => setThreshold('embedding_duplicate', e.target.value)}
              className="w-full"
            />
          </label>
          <label className="text-xs">
            <div className="flex justify-between">
              <span>Uncertain</span>
              <span className="font-mono">{t.embedding_uncertain}</span>
            </div>
            <input
              type="range" min="0.40" max="1.00" step="0.01"
              value={t.embedding_uncertain}
              onChange={(e) => setThreshold('embedding_uncertain', e.target.value)}
              className="w-full"
            />
          </label>
          <label className="text-xs">
            <div className="flex justify-between">
              <span>Max cluster</span>
              <span className="font-mono">{t.max_cluster_size}</span>
            </div>
            <input
              type="range" min="2" max="20" step="1"
              value={t.max_cluster_size}
              onChange={(e) => setThreshold('max_cluster_size', e.target.value)}
              className="w-full"
            />
          </label>
        </div>
        {!thresholdsValid && (
          <div className="text-danger text-xs mt-1">Duplicate threshold must be higher than uncertain</div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
        Test mode (log decisions without applying)
      </label>

      <div className="flex gap-3 items-center">
        <button
          type="button"
          disabled={!thresholdsValid || status === 'saving'}
          onClick={save}
          className="rounded-btn bg-accent text-white px-4 py-2 text-sm disabled:opacity-50"
        >
          {status === 'saving' ? 'Saving...' : 'Save config'}
        </button>
        {status === 'saved' && <span className="text-success text-xs">Saved</span>}
        {status === 'error' && <span className="text-danger text-xs">Save failed</span>}
      </div>
    </div>
  );
}
