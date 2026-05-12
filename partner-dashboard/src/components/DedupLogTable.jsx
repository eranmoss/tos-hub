import { useEffect, useState } from 'react';
import { getDedupLog } from '../api/dashboard.js';

const DECISION_COLOR = {
  DUPLICATE: 'text-danger',
  DISTINCT: 'text-success',
  UNCERTAIN: 'text-warning',
};

export default function DedupLogTable() {
  const [rows, setRows] = useState([]);
  const [decision, setDecision] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getDedupLog({ decision: decision || undefined })
      .then((d) => setRows(d.decisions || []))
      .finally(() => setLoading(false));
  }, [decision]);

  return (
    <div className="space-y-3">
      <select
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
        className="rounded-btn border border-border-default px-2 py-1 text-sm"
      >
        <option value="">All decisions</option>
        <option value="DUPLICATE">DUPLICATE</option>
        <option value="DISTINCT">DISTINCT</option>
        <option value="UNCERTAIN">UNCERTAIN</option>
      </select>
      {loading ? <div className="text-text-secondary text-sm">Loading…</div> : (
        <div className="bg-card-bg border border-border-default rounded-card overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-page-bg text-text-secondary uppercase">
              <tr>
                <th className="text-left px-3 py-2">Pair</th>
                <th className="text-right px-3 py-2">Score</th>
                <th className="text-left px-3 py-2">Decision</th>
                <th className="text-left px-3 py-2">Strategy</th>
                <th className="text-left px-3 py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border-default">
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {String(r.option_id_a).slice(0, 8)} / {String(r.option_id_b).slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 text-right">{Number(r.composite_score).toFixed(2)}</td>
                  <td className={`px-3 py-2 font-medium ${DECISION_COLOR[r.decision] || ''}`}>{r.decision}</td>
                  <td className="px-3 py-2">{r.strategy_applied || '—'}</td>
                  <td className="px-3 py-2">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-text-secondary">No decisions</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
