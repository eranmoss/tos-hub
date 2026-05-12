import { useEffect, useState } from 'react';
import { useTransactions } from '../hooks/useTransactions.js';
import { usePageContext } from '../agent/usePageContext.js';
import TransactionTable from '../components/TransactionTable.jsx';

const toCSV = (rows) => {
  const header = ['txn_id', 'created_at', 'supplier_slug', 'operation', 'status', 'latency_ms', 'source'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map(h => JSON.stringify(r[h] ?? '')).join(','));
  }
  return lines.join('\n');
};

export default function Transactions() {
  const { data, loading, error, filters, setFilters } = useTransactions();
  const { register } = usePageContext();
  const [localFilters, setLocalFilters] = useState({ supplier_slug: '', operation: '', status: '' });

  useEffect(() => {
    if (data) register('transactions', { active_filters: filters, summary: data.summary });
  }, [data, filters, register]);

  const applyFilters = () => {
    const cleaned = Object.fromEntries(Object.entries(localFilters).filter(([, v]) => v));
    setFilters((f) => ({ ...f, ...cleaned, page: 1 }));
  };

  const downloadCSV = () => {
    if (!data) return;
    const blob = new Blob([toCSV(data.transactions)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tos-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-card-bg border border-border-default rounded-card p-3 flex flex-wrap gap-2 items-end">
        <label className="text-xs flex flex-col">
          <span className="text-text-secondary">Supplier</span>
          <input
            value={localFilters.supplier_slug}
            onChange={(e) => setLocalFilters({ ...localFilters, supplier_slug: e.target.value })}
            className="rounded-btn border border-border-default px-2 py-1"
          />
        </label>
        <label className="text-xs flex flex-col">
          <span className="text-text-secondary">Operation</span>
          <select
            value={localFilters.operation}
            onChange={(e) => setLocalFilters({ ...localFilters, operation: e.target.value })}
            className="rounded-btn border border-border-default px-2 py-1"
          >
            <option value="">All</option>
            <option value="search">search</option>
            <option value="book">book</option>
            <option value="cancel">cancel</option>
            <option value="get">get</option>
          </select>
        </label>
        <label className="text-xs flex flex-col">
          <span className="text-text-secondary">Status</span>
          <select
            value={localFilters.status}
            onChange={(e) => setLocalFilters({ ...localFilters, status: e.target.value })}
            className="rounded-btn border border-border-default px-2 py-1"
          >
            <option value="">All</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="ERROR">ERROR</option>
            <option value="DEDUP_SUPPRESSED">DEDUP_SUPPRESSED</option>
            <option value="NORMALIZATION_FAILED">NORMALIZATION_FAILED</option>
          </select>
        </label>
        <button
          type="button"
          onClick={applyFilters}
          className="rounded-btn bg-accent text-white text-xs px-3 py-2"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={downloadCSV}
          className="rounded-btn border border-border-default text-xs px-3 py-2"
        >
          Export CSV
        </button>
      </div>

      {data && (
        <div className="flex gap-4 text-xs text-text-secondary">
          <span>{data.total} total</span>
          <span>Success rate: {data.summary.success_rate_pct}%</span>
          <span>Avg latency: {data.summary.avg_latency_ms}ms</span>
        </div>
      )}

      {loading && <div className="text-text-secondary">Loading…</div>}
      {error && <div className="text-danger">{error}</div>}

      {data && <TransactionTable rows={data.transactions} />}

      {data && data.pages > 1 && (
        <div className="flex gap-2 items-center text-xs">
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))}
            disabled={filters.page <= 1}
            className="rounded-btn border border-border-default px-3 py-1 disabled:opacity-50"
          >
            ← Prev
          </button>
          <span>Page {data.page} of {data.pages}</span>
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, page: Math.min(data.pages, f.page + 1) }))}
            disabled={filters.page >= data.pages}
            className="rounded-btn border border-border-default px-3 py-1 disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
