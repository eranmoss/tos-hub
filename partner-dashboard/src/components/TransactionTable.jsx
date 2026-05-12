import { Fragment, useState } from 'react';

const STATUS_COLOR = {
  SUCCESS: 'text-success',
  ERROR: 'text-danger',
  DEDUP_SUPPRESSED: 'text-text-secondary',
  NORMALIZATION_FAILED: 'text-warning',
};

export default function TransactionTable({ rows }) {
  const [expanded, setExpanded] = useState(null);
  return (
    <div className="bg-card-bg rounded-card border border-border-default overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-page-bg text-text-secondary text-xs uppercase">
          <tr>
            <th className="text-left px-3 py-2">Time</th>
            <th className="text-left px-3 py-2">Supplier</th>
            <th className="text-left px-3 py-2">Operation</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-right px-3 py-2">Latency</th>
            <th className="text-left px-3 py-2">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <Fragment key={t.txn_id}>
              <tr
                className="border-t border-border-default hover:bg-page-bg cursor-pointer"
                onClick={() => setExpanded((e) => (e === t.txn_id ? null : t.txn_id))}
                data-testid="txn-row"
              >
                <td className="px-3 py-2 text-xs">{new Date(t.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">{t.supplier_slug}</td>
                <td className="px-3 py-2">{t.operation}</td>
                <td className={`px-3 py-2 font-medium ${STATUS_COLOR[t.status] || ''}`}>{t.status}</td>
                <td className="px-3 py-2 text-right">{t.latency_ms}ms</td>
                <td className="px-3 py-2 text-xs">{t.source}</td>
              </tr>
              {expanded === t.txn_id && (
                <tr className="bg-page-bg">
                  <td colSpan={6} className="px-3 py-2 text-xs text-text-secondary">
                    <div>txn_id: {t.txn_id}</div>
                    {t.request_hash && <div>request_hash: {t.request_hash}</div>}
                    {t.response_hash && <div>response_hash: {t.response_hash}</div>}
                    {t.error_message && <div className="text-danger">error: {t.error_message}</div>}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-text-secondary">No transactions</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
