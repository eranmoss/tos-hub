import { useState, useEffect, useCallback } from 'react';
import { getDedupReviewSample, submitDedupReview } from '../api/dashboard.js';

const SUPPLIER_COLORS = {
  bridgify: 'bg-blue-100 text-blue-800',
  'hotelbeds-activities': 'bg-orange-100 text-orange-800',
  'hotelbeds-hotels': 'bg-purple-100 text-purple-800',
  'hotelbeds-transfers': 'bg-green-100 text-green-800',
};

const Badge = ({ slug }) => (
  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SUPPLIER_COLORS[slug] || 'bg-gray-100 text-gray-700'}`}>
    {slug}
  </span>
);

const BandBadge = ({ band }) => (
  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
    size {band}
  </span>
);

const ItemMeta = ({ item }) => (
  <div className="mt-0.5">
    <div className="text-[11px] text-text-secondary flex flex-wrap gap-x-2 gap-y-0.5">
      {item.city && <span>{item.city}</span>}
      {item.category && <span>{item.category}</span>}
      {item.duration_minutes > 0 && <span>{item.duration_minutes}min</span>}
      {item.price_from != null && (
        <span className="font-medium text-text-primary">
          {item.price_currency === 'USD' ? '$' : item.price_currency || '$'}{item.price_from.toFixed(0)}
        </span>
      )}
      {item.rating != null && (
        <span className="text-yellow-600">
          {'★'}{item.rating.toFixed(1)}
          {item.review_count > 0 && <span className="text-text-secondary"> ({item.review_count})</span>}
        </span>
      )}
      {item.modality && <span className="italic">{item.modality}</span>}
      {item.pax_range && <span>{item.pax_range.min}-{item.pax_range.max} pax</span>}
      {item.destination_code && !item.city && <span>dest: {item.destination_code}</span>}
      {item.supplier_code && <span className="font-mono text-[10px] opacity-60">{item.supplier_code}</span>}
    </div>
    {item.description ? (
      <div className="text-[10px] text-text-secondary mt-0.5 line-clamp-2">{item.description}</div>
    ) : (
      <div className="text-[10px] text-yellow-600 mt-0.5 italic">No description available</div>
    )}
  </div>
);

const PrecisionGauge = ({ stats }) => {
  if (!stats || stats.total_reviewed === 0) return null;
  const pct = parseFloat(stats.precision);
  const color = pct >= 85 ? 'text-success' : pct >= 70 ? 'text-yellow-600' : 'text-danger';
  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
        <div className={`text-2xl font-bold ${color}`}>{stats.precision}%</div>
        <div className="text-[11px] text-text-secondary">Precision</div>
      </div>
      <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
        <div className="text-2xl font-bold text-success">{stats.correct}</div>
        <div className="text-[11px] text-text-secondary">Correct</div>
      </div>
      <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
        <div className="text-2xl font-bold text-yellow-600">{stats.partial}</div>
        <div className="text-[11px] text-text-secondary">Partial</div>
      </div>
      <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
        <div className="text-2xl font-bold text-danger">{stats.wrong}</div>
        <div className="text-[11px] text-text-secondary">Wrong</div>
      </div>
    </div>
  );
};

const ReviewCard = ({ cluster, onVerdict, busy }) => {
  const { canonical, duplicates, band } = cluster;
  const [wrongIds, setWrongIds] = useState(new Set());

  const toggleWrong = (id) => {
    setWrongIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const submit = (verdict) => {
    onVerdict({
      canonical_id: canonical.id,
      verdict,
      wrong_ids: verdict === 'PARTIAL' ? [...wrongIds] : null,
      cluster_size: duplicates.length + 1,
    });
  };

  return (
    <div className="border border-border-default rounded-card bg-card-bg">
      <div className="px-4 py-3 border-b border-border-default">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-green-600 bg-green-50 px-1.5 py-0.5 rounded">CANONICAL</span>
            <Badge slug={canonical.supplier_slug} />
            <BandBadge band={band} />
          </div>
          <span className="text-[10px] text-text-secondary">{duplicates.length} duplicate{duplicates.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex gap-3">
          {canonical.image_urls?.[0] && (
            <img src={canonical.image_urls[0]} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{canonical.title}</div>
            <ItemMeta item={canonical} />
          </div>
        </div>
      </div>

      <div className="divide-y divide-border-default">
        {duplicates.map((dup) => {
          const isWrong = wrongIds.has(dup.id);
          return (
            <div key={dup.id}
              className={`px-4 py-2 flex items-start gap-3 cursor-pointer transition-colors ${
                isWrong ? 'bg-red-50' : 'hover:bg-gray-50/50'
              }`}
              onClick={() => toggleWrong(dup.id)}
            >
              <input
                type="checkbox"
                checked={isWrong}
                onChange={() => toggleWrong(dup.id)}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 accent-red-500"
                title="Mark as wrongly grouped"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs">{dup.title}</div>
                <ItemMeta item={dup} />
              </div>
              <Badge slug={dup.supplier_slug} />
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 border-t border-border-default flex gap-2 items-center">
        <span className="text-[11px] text-text-secondary mr-1">Verdict:</span>
        <button type="button" disabled={busy}
          onClick={() => submit('CORRECT')}
          className="rounded-btn bg-success/10 text-success text-xs px-3 py-1.5 hover:bg-success/20 disabled:opacity-50 font-medium">
          All Correct
        </button>
        <button type="button" disabled={busy || wrongIds.size === 0}
          onClick={() => submit('PARTIAL')}
          className="rounded-btn bg-yellow-100 text-yellow-700 text-xs px-3 py-1.5 hover:bg-yellow-200 disabled:opacity-50 font-medium"
          title="Some duplicates are correct, checked ones are wrong">
          Partial ({wrongIds.size} wrong)
        </button>
        <button type="button" disabled={busy}
          onClick={() => submit('WRONG')}
          className="rounded-btn bg-danger/10 text-danger text-xs px-3 py-1.5 hover:bg-danger/20 disabled:opacity-50 font-medium">
          All Wrong
        </button>
      </div>
    </div>
  );
};

export default function DedupReview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(new Set());
  const [stats, setStats] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    getDedupReviewSample({ sample_size: 50 })
      .then((d) => {
        setData(d);
        setStats(d.stats);
        setReviewed(new Set());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleVerdict = async (review) => {
    setBusy(true);
    try {
      const r = await submitDedupReview(review);
      setStats(r.stats);
      setReviewed((prev) => new Set([...prev, review.canonical_id]));
    } catch {
    } finally {
      setBusy(false);
    }
  };

  const remaining = (data?.clusters || []).filter(c => !reviewed.has(c.canonical.id));
  const done = reviewed.size;
  const total = data?.clusters?.length || 0;

  return (
    <div className="space-y-4">
      <PrecisionGauge stats={stats} />

      <div className="flex items-center justify-between">
        <div className="text-sm text-text-secondary">
          {loading ? 'Loading sample...' : (
            <>
              {done}/{total} reviewed this batch
              {remaining.length === 0 && total > 0 && (
                <span className="text-success ml-2 font-medium">Batch complete!</span>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} disabled={loading}
            className="rounded-btn border border-border-default text-xs px-3 py-1.5 hover:border-accent disabled:opacity-50">
            New Sample
          </button>
        </div>
      </div>

      {done > 0 && total > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div className="bg-accent h-1.5 rounded-full transition-all" style={{ width: `${(done/total)*100}%` }} />
        </div>
      )}

      <div className="text-[11px] text-text-secondary bg-page-bg rounded-btn px-3 py-2">
        Review each cluster: are all items genuinely the same experience?
        Click <strong>All Correct</strong> if the grouping is right.
        Check the wrongly grouped items and click <strong>Partial</strong> if some don't belong.
        Click <strong>All Wrong</strong> if the cluster shouldn't exist at all.
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary">Loading clusters...</div>
      ) : (
        <div className="space-y-3">
          {remaining.map((cluster) => (
            <ReviewCard
              key={cluster.canonical.id}
              cluster={cluster}
              onVerdict={handleVerdict}
              busy={busy}
            />
          ))}
          {remaining.length === 0 && total > 0 && (
            <div className="text-center py-12 text-text-secondary">
              All clusters in this batch reviewed. Click "New Sample" for more.
            </div>
          )}
          {total === 0 && (
            <div className="text-center py-12 text-text-secondary">
              No unreviewed clusters available. Run dedup first to generate clusters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
