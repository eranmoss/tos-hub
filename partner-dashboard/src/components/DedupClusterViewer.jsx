import { useState, useEffect } from 'react';
import { getDedupClusters } from '../api/dashboard.js';

const SUPPLIER_COLORS = {
  bridgify: 'bg-blue-100 text-blue-800',
  'hotelbeds-activities': 'bg-orange-100 text-orange-800',
  'hotelbeds-hotels': 'bg-purple-100 text-purple-800',
  'hotelbeds-transfers': 'bg-green-100 text-green-800',
  viator: 'bg-teal-100 text-teal-800',
  'viator-direct': 'bg-cyan-100 text-cyan-800',
};

const SupplierBadge = ({ slug }) => (
  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SUPPLIER_COLORS[slug] || 'bg-gray-100 text-gray-700'}`}>
    {slug}
  </span>
);

const ItemDetail = ({ item, label, labelColor }) => {
  const img = item.image_urls?.[0];
  return (
    <div className="flex gap-3">
      {img && (
        <img
          src={img}
          alt=""
          className="w-20 h-20 rounded object-cover flex-shrink-0 bg-gray-100"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${labelColor}`}>{label}</span>
          <SupplierBadge slug={item.supplier_slug} />
        </div>
        <div className="text-sm font-medium leading-tight mb-1">{item.title}</div>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-secondary mb-1.5">
          {item.city && <span>{item.city}</span>}
          {item.category && <span>{item.category}</span>}
          {item.duration_minutes > 0 && <span>{item.duration_minutes} min</span>}
          {item.price_from != null && (
            <span className="font-medium text-text-primary">
              {item.price_currency || 'USD'} {Number(item.price_from).toFixed(2)}
            </span>
          )}
          {item.rating != null && (
            <span>
              {'★'.repeat(Math.round(item.rating))}{item.rating.toFixed(1)}
              {item.review_count > 0 && <span className="text-text-secondary"> ({item.review_count})</span>}
            </span>
          )}
          {item.latitude != null && (
            <span className="font-mono text-[10px]">{Number(item.latitude).toFixed(4)}, {Number(item.longitude).toFixed(4)}</span>
          )}
        </div>

        {item.description && (
          <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">
            {item.description}
          </p>
        )}
      </div>
    </div>
  );
};

const ClusterCard = ({ cluster, isOpen, onToggle }) => {
  const { canonical, duplicates } = cluster;
  if (!canonical) return null;

  return (
    <div className="border border-border-default rounded-card bg-card-bg">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50/50"
      >
        <span className={`text-xs font-mono w-5 h-5 rounded-full flex items-center justify-center
          ${duplicates.length >= 5 ? 'bg-danger/10 text-danger' : duplicates.length >= 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
          {duplicates.length}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{canonical.title}</div>
          <div className="text-[11px] text-text-secondary flex gap-2 mt-0.5">
            <span>{canonical.city}</span>
            {canonical.category && <span>{canonical.category}</span>}
            {canonical.duration_minutes > 0 && <span>{canonical.duration_minutes}min</span>}
            {canonical.price_from != null && (
              <span className="font-medium">{canonical.price_currency || 'USD'} {Number(canonical.price_from).toFixed(2)}</span>
            )}
          </div>
        </div>
        <SupplierBadge slug={canonical.supplier_slug} />
        <svg className={`w-4 h-4 text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-border-default">
          <div className="px-4 py-3 bg-green-50/50 border-b border-border-default">
            <div className="text-[11px] text-green-800 font-semibold flex items-center gap-1.5 mb-2">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
              CANONICAL (shown to users)
            </div>
            <ItemDetail item={canonical} label="CANONICAL" labelColor="bg-green-100 text-green-800" />
          </div>

          <div className="divide-y divide-border-default">
            {duplicates.map((dup) => (
              <div key={dup.id} className="px-4 py-3 bg-red-50/20">
                <ItemDetail item={dup} label="DUPLICATE" labelColor="bg-red-100 text-red-700" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default function DedupClusterViewer() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState('');
  const [supplier, setSupplier] = useState('');
  const [page, setPage] = useState(1);
  const [openClusters, setOpenClusters] = useState(new Set());

  const load = () => {
    setLoading(true);
    const params = { page, limit: 20 };
    if (city) params.city = city;
    if (supplier) params.supplier_slug = supplier;
    getDedupClusters(params)
      .then(d => { setData(d); setOpenClusters(new Set()); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, city, supplier]);

  const toggle = (id) => {
    setOpenClusters(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    if (!data?.clusters) return;
    setOpenClusters(new Set(data.clusters.map(c => c.canonical?.id)));
  };

  const collapseAll = () => setOpenClusters(new Set());

  const summary = data?.summary || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
          <div className="text-2xl font-bold">{summary.total_clusters?.toLocaleString() || '—'}</div>
          <div className="text-[11px] text-text-secondary">Clusters</div>
        </div>
        <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
          <div className="text-2xl font-bold text-danger">{summary.total_duplicates?.toLocaleString() || '—'}</div>
          <div className="text-[11px] text-text-secondary">Duplicates Hidden</div>
        </div>
        <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
          <div className="text-2xl font-bold text-success">{summary.total_unique?.toLocaleString() || '—'}</div>
          <div className="text-[11px] text-text-secondary">Unique Shown</div>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <select
          value={city}
          onChange={(e) => { setCity(e.target.value); setPage(1); }}
          className="text-sm border border-border-default rounded-btn px-2 py-1.5 bg-card-bg min-w-[160px]"
        >
          <option value="">All cities</option>
          {(data?.cities || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={supplier}
          onChange={(e) => { setSupplier(e.target.value); setPage(1); }}
          className="text-sm border border-border-default rounded-btn px-2 py-1.5 bg-card-bg"
        >
          <option value="">All suppliers</option>
          <option value="bridgify">Bridgify</option>
          <option value="hotelbeds-activities">HotelBeds Activities</option>
          <option value="viator">Viator</option>
          <option value="viator-direct">Viator Direct</option>
        </select>
        <div className="flex-1" />
        <button type="button" onClick={expandAll}
          className="text-[11px] text-text-secondary hover:text-text-primary">Expand all</button>
        <span className="text-text-secondary">|</span>
        <button type="button" onClick={collapseAll}
          className="text-[11px] text-text-secondary hover:text-text-primary">Collapse all</button>
      </div>

      {loading ? (
        <div className="text-sm text-text-secondary py-8 text-center">Loading clusters...</div>
      ) : (
        <div className="space-y-2">
          {(data?.clusters || []).map((cluster) => (
            <ClusterCard
              key={cluster.canonical?.id}
              cluster={cluster}
              isOpen={openClusters.has(cluster.canonical?.id)}
              onToggle={() => toggle(cluster.canonical?.id)}
            />
          ))}
          {data?.clusters?.length === 0 && (
            <div className="text-sm text-text-secondary py-8 text-center">No clusters found</div>
          )}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary text-xs">
            Page {data.page} of {data.pages} ({data.total} clusters)
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 border border-border-default rounded-btn disabled:opacity-30">
              Prev
            </button>
            <button type="button" onClick={() => setPage(p => Math.min(data.pages, p + 1))}
              disabled={page >= data.pages}
              className="px-3 py-1 border border-border-default rounded-btn disabled:opacity-30">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
