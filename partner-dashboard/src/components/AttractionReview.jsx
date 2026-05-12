import { useState, useEffect } from 'react';
import { getAttractionReview, resolveAttractionReview } from '../api/dashboard.js';

const STATUS_COLORS = {
  PENDING: 'bg-amber-100 text-amber-800',
  RESOLVED: 'bg-green-100 text-green-800',
};

export default function AttractionReview() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('PENDING');
  const [resolving, setResolving] = useState(null);

  const load = () => {
    setLoading(true);
    getAttractionReview()
      .then(d => setItems(d.escalations || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const resolve = async (id, action) => {
    setResolving(id);
    try {
      await resolveAttractionReview(id, action);
      setItems(prev => prev.map(it =>
        it.id === id ? { ...it, status: 'RESOLVED', resolution: { action } } : it
      ));
    } catch (e) {
      alert(`Failed: ${e.message}`);
    } finally {
      setResolving(null);
    }
  };

  const shown = items.filter(it => filter === 'ALL' || it.status === filter);

  const pendingCount = items.filter(it => it.status === 'PENDING').length;
  const resolvedCount = items.filter(it => it.status === 'RESOLVED').length;

  if (loading) return <div className="text-text-secondary text-sm p-4">Loading review queue...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h3 className="font-semibold text-primary text-sm">Attraction Review Queue</h3>
        <span className="text-xs text-text-secondary">
          {pendingCount} pending &middot; {resolvedCount} resolved
        </span>
        <div className="ml-auto flex gap-1">
          {['PENDING', 'RESOLVED', 'ALL'].map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-btn border ${
                filter === f ? 'bg-accent text-white border-accent' : 'border-border-default text-text-secondary'
              }`}
            >
              {f === 'ALL' ? `All (${items.length})` : f === 'PENDING' ? `Pending (${pendingCount})` : `Resolved (${resolvedCount})`}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && (
        <div className="bg-card-bg border border-border-default rounded-card p-8 text-center text-text-secondary text-sm">
          {filter === 'PENDING'
            ? 'No attractions pending review. Run "Validate Attractions" to check for questionable entries.'
            : 'No items match this filter.'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {shown.map(item => {
          const data = typeof item.trigger_data === 'string' ? JSON.parse(item.trigger_data) : item.trigger_data;
          const resolved = item.status === 'RESOLVED';
          const resolution = typeof item.resolution === 'string' ? JSON.parse(item.resolution) : item.resolution;

          return (
            <div
              key={item.id}
              className={`bg-card-bg border rounded-card p-4 ${resolved ? 'border-border-default opacity-70' : 'border-amber-300'}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold text-sm text-primary">{data.name}</div>
                  <div className="text-xs text-text-secondary">
                    {data.city || 'Unknown city'} &middot; {data.experience_count} experiences
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[item.status] || 'bg-gray-100'}`}>
                  {item.status}
                </span>
              </div>

              {data.reason && (
                <div className="text-xs text-text-secondary mb-2 italic">
                  LLM: {data.reason}
                </div>
              )}

              <div className="mb-3">
                <div className="text-[10px] text-text-secondary font-medium mb-1 uppercase tracking-wide">Sample experiences</div>
                <ul className="space-y-0.5">
                  {(data.sample_titles || []).slice(0, 4).map((t, i) => (
                    <li key={i} className="text-xs text-text-primary truncate" title={t}>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>

              {resolved ? (
                <div className="text-xs font-medium text-green-700">
                  {resolution?.action === 'keep' ? 'Kept as valid attraction' : 'Dismantled — experiences released'}
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={resolving === item.id}
                    onClick={() => resolve(item.id, 'keep')}
                    className="flex-1 rounded-btn bg-emerald-500 text-white text-xs py-1.5 hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    disabled={resolving === item.id}
                    onClick={() => resolve(item.id, 'dismantle')}
                    className="flex-1 rounded-btn bg-red-500 text-white text-xs py-1.5 hover:bg-red-600 disabled:opacity-50"
                  >
                    Dismantle
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
