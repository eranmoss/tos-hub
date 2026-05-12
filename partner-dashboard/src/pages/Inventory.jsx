import { Fragment, useEffect, useState } from 'react';
import { useInventory } from '../hooks/useInventory.js';
import { usePageContext } from '../agent/usePageContext.js';
import LifecycleDrawer from '../components/LifecycleDrawer.jsx';
import { getLifecycleSuppliers } from '../api/lifecycle.js';
import { triggerSync } from '../api/dashboard.js';

const fmtAgo = (s) => {
  if (!s) return '—';
  const ms = Date.now() - new Date(s).getTime();
  const hr = Math.round(ms / (1000 * 60 * 60));
  if (hr < 1) return 'just now';
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
};

const StatusDot = ({ status }) => {
  const color = status === 'COMPLETE' ? 'bg-success' :
    status === 'FAILED' ? 'bg-danger' :
    status === 'RUNNING' ? 'bg-warning' : 'bg-text-secondary';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
};

export default function Inventory() {
  const { data, loading, error, filters, setFilters } = useInventory();
  const { register } = usePageContext();
  const [localFilters, setLocalFilters] = useState({
    type: '', supplier_slug: '', city: '', category: '',
  });
  const [expandedId, setExpandedId] = useState(null);
  const [lifecycleRow, setLifecycleRow] = useState(null);
  const [supportedSuppliers, setSupportedSuppliers] = useState([]);
  const [actionStatus, setActionStatus] = useState(null);

  useEffect(() => {
    getLifecycleSuppliers()
      .then((r) => setSupportedSuppliers(r?.supported || []))
      .catch(() => setSupportedSuppliers([]));
  }, []);

  useEffect(() => {
    if (data) {
      register('inventory', {
        active_filters: filters,
        visible_count: data.records.length,
        sync_status: data.sync_summary,
      });
    }
  }, [data, filters, register]);

  const applyFilters = () => {
    const cleaned = Object.fromEntries(
      Object.entries(localFilters).filter(([, v]) => v)
    );
    setFilters((f) => ({ page: 1, limit: f.limit, ...cleaned }));
  };

  const clearFilters = () => {
    setLocalFilters({ type: '', supplier_slug: '', city: '', category: '' });
    setFilters((f) => ({ page: 1, limit: f.limit }));
  };

  const suppliers = data?.sync_status_by_supplier || [];

  return (
    <div className="p-6 space-y-4">
      <div className="bg-card-bg border border-border-default rounded-card p-3 flex flex-wrap gap-2 items-end">
        <label className="text-xs flex flex-col">
          <span className="text-text-secondary">Type</span>
          <select
            value={localFilters.type}
            onChange={(e) => setLocalFilters({ ...localFilters, type: e.target.value })}
            className="rounded-btn border border-border-default px-2 py-1"
          >
            <option value="">All</option>
            <option value="HOTEL">HOTEL</option>
            <option value="EXPERIENCE">EXPERIENCE</option>
            <option value="TRANSFER">TRANSFER</option>
            <option value="FLIGHT">FLIGHT</option>
            <option value="RAIL">RAIL</option>
            <option value="PACKAGE">PACKAGE</option>
          </select>
        </label>
        <label className="text-xs flex flex-col">
          <span className="text-text-secondary">Supplier</span>
          <select
            value={localFilters.supplier_slug}
            onChange={(e) => setLocalFilters({ ...localFilters, supplier_slug: e.target.value })}
            className="rounded-btn border border-border-default px-2 py-1"
          >
            <option value="">All</option>
            {suppliers.map((s) => (
              <option key={s.supplier_slug} value={s.supplier_slug}>{s.supplier_slug}</option>
            ))}
          </select>
        </label>
        <label className="text-xs flex flex-col">
          <span className="text-text-secondary">City</span>
          <input
            value={localFilters.city}
            onChange={(e) => setLocalFilters({ ...localFilters, city: e.target.value })}
            placeholder="e.g. Barcelona"
            className="rounded-btn border border-border-default px-2 py-1"
          />
        </label>
        <label className="text-xs flex flex-col">
          <span className="text-text-secondary">Category</span>
          <input
            value={localFilters.category}
            onChange={(e) => setLocalFilters({ ...localFilters, category: e.target.value })}
            placeholder="e.g. CULTURE"
            className="rounded-btn border border-border-default px-2 py-1"
          />
        </label>
        <button type="button" onClick={applyFilters}
          className="rounded-btn bg-accent text-white text-xs px-3 py-2">Apply</button>
        <button type="button" onClick={clearFilters}
          className="rounded-btn border border-border-default text-xs px-3 py-2">Clear</button>
      </div>

      {data?.sync_summary && (
        <div className="bg-card-bg border border-border-default rounded-card p-3 flex flex-wrap gap-4 items-center text-xs">
          <div className="flex items-center gap-2">
            <StatusDot status={data.sync_summary.status} />
            <span className="text-text-secondary">Last sync:</span>
            <span className="font-medium">{fmtAgo(data.sync_summary.completed_at || data.sync_summary.started_at)}</span>
            <span className="text-text-secondary">· {data.sync_summary.status}</span>
          </div>
          {suppliers.map((s) => (
            <div key={s.supplier_slug} className="flex items-center gap-1 px-2 py-1 rounded-btn bg-page-bg">
              <StatusDot status={s.last_job_status} />
              <span className="font-medium">{s.supplier_slug}</span>
              <span className="text-text-secondary">: {s.records_active} active</span>
              {s.records_inactive > 0 && (
                <span className="text-text-secondary">({s.records_inactive} inactive)</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-card-bg border border-border-default rounded-card p-3 flex flex-wrap gap-2 items-center">
        <span className="text-xs text-text-secondary font-medium mr-2">Actions</span>
        <button type="button"
          onClick={() => {
            setActionStatus('Syncing all suppliers...');
            triggerSync().then(r => setActionStatus(r.message)).catch(e => setActionStatus(`Error: ${e.message}`));
          }}
          className="rounded-btn bg-primary text-white text-xs px-3 py-1.5 hover:opacity-90">
          Sync All
        </button>
        {actionStatus && (
          <span className="text-xs text-text-secondary ml-2">{actionStatus}</span>
        )}
      </div>

      {data && (
        <div className="text-xs text-text-secondary">
          {data.total} records · showing {data.records.length}
        </div>
      )}

      {loading && <div className="text-text-secondary">Loading…</div>}
      {error && <div className="text-danger">{error}</div>}

      {data && (
        <div className="bg-card-bg border border-border-default rounded-card overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-page-bg text-text-secondary">
              <tr>
                <th className="text-left px-3 py-2">Title</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Supplier</th>
                <th className="text-left px-3 py-2">City</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Star</th>
                <th className="text-left px-3 py-2">Synced</th>
                <th className="text-left px-3 py-2">Active</th>
                <th className="text-left px-3 py-2">Test</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => {
                const open = expandedId === r.id;
                const supported = supportedSuppliers.includes(r.supplier_slug);
                return (
                  <Fragment key={r.id}>
                    <tr
                        className="border-t border-border-default cursor-pointer hover:bg-page-bg"
                        onClick={() => setExpandedId(open ? null : r.id)}>
                      <td className="px-3 py-2 font-medium">{r.title}</td>
                      <td className="px-3 py-2">{r.type}</td>
                      <td className="px-3 py-2">{r.supplier_slug}</td>
                      <td className="px-3 py-2">{r.city || '—'}</td>
                      <td className="px-3 py-2">{r.category || '—'}</td>
                      <td className="px-3 py-2">{r.star_rating ? '★'.repeat(Math.round(r.star_rating)) : '—'}</td>
                      <td className="px-3 py-2 text-text-secondary">{fmtAgo(r.last_synced_at)}</td>
                      <td className="px-3 py-2">
                        {r.is_active
                          ? <span className="text-success">✓</span>
                          : <span className="text-text-secondary">✗</span>}
                      </td>
                      <td className="px-3 py-2">
                        <button type="button"
                          disabled={!supported}
                          title={supported ? 'Walk through detail → book → cancel' : `Lifecycle tester not yet supported for ${r.supplier_slug}`}
                          onClick={(e) => { e.stopPropagation(); if (supported) setLifecycleRow(r); }}
                          className="rounded-btn border border-border-default px-2 py-1 text-xs hover:bg-page-bg disabled:opacity-40 disabled:cursor-not-allowed">
                          ⚡ Test
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-page-bg">
                        <td colSpan={9} className="px-3 py-3">
                          <pre className="text-xs overflow-auto max-h-64">{JSON.stringify(r, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {data.records.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-text-secondary">No records match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <LifecycleDrawer
        open={!!lifecycleRow}
        row={lifecycleRow}
        onClose={() => setLifecycleRow(null)}
      />

      {data && data.pages > 1 && (
        <div className="flex gap-2 items-center text-xs">
          <button type="button"
            onClick={() => setFilters((f) => ({ ...f, page: Math.max(1, (f.page || 1) - 1) }))}
            disabled={(filters.page || 1) <= 1}
            className="rounded-btn border border-border-default px-3 py-1 disabled:opacity-50">← Prev</button>
          <span>Page {data.page} of {data.pages}</span>
          <button type="button"
            onClick={() => setFilters((f) => ({ ...f, page: Math.min(data.pages, (f.page || 1) + 1) }))}
            disabled={(filters.page || 1) >= data.pages}
            className="rounded-btn border border-border-default px-3 py-1 disabled:opacity-50">Next →</button>
        </div>
      )}
    </div>
  );
}
