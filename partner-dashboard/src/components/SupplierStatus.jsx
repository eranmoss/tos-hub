const STATUS_CFG = {
  UP:       { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success', label: 'Connected' },
  DEGRADED: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning', label: 'Slow' },
  DOWN:     { bg: 'bg-danger/10',  text: 'text-danger',  dot: 'bg-danger',  label: 'Errors' },
};

const CATEGORY_ICONS = {
  HOTEL: '🏨',
  EXPERIENCE: '🎯',
  TRANSFER: '🚐',
};

const fmtNumber = (n) => {
  if (n == null || n === 0) return '—';
  return n.toLocaleString();
};

export default function SupplierStatus({ supplier, sync }) {
  const cfg = STATUS_CFG[supplier.status] || STATUS_CFG.UP;
  const hasTraffic = supplier.transactions_24h > 0;
  const categories = supplier.categories || [];
  const icons = categories.map(c => CATEGORY_ICONS[c] || '').join(' ');

  const fmtAgo = (s) => {
    if (!s) return null;
    const ms = Date.now() - new Date(s).getTime();
    const hr = Math.round(ms / (1000 * 60 * 60));
    if (hr < 1) return 'just now';
    if (hr < 24) return `${hr}h ago`;
    return `${Math.round(hr / 24)}d ago`;
  };

  const syncAgo = sync ? fmtAgo(sync.last_synced_at) : null;

  return (
    <div className="bg-card-bg rounded-card border border-border-default p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-text-primary flex items-center gap-1.5">
            {icons && <span className="text-sm">{icons}</span>}
            {supplier.name}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`} />
          <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
        </div>
      </div>

      {sync && (sync.records_active > 0 || sync.records_inactive > 0) && (
        <div className="mt-2 text-xs text-text-secondary">
          <span className="font-medium text-text-primary">{fmtNumber(sync.records_active)}</span> items in catalog
          {syncAgo && <span> · synced {syncAgo}</span>}
        </div>
      )}

      {hasTraffic ? (
        <div className="grid grid-cols-3 mt-3 gap-2 text-xs">
          <div>
            <div className="text-text-secondary">Response time</div>
            <div className="font-medium">{supplier.latency_p95_ms || 0}ms</div>
          </div>
          <div>
            <div className="text-text-secondary">Error rate</div>
            <div className="font-medium">{Number(supplier.error_rate_pct).toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-text-secondary">API calls (24h)</div>
            <div className="font-medium">{fmtNumber(supplier.transactions_24h)}</div>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-xs text-text-secondary italic">
          No API calls in the last 24 hours
        </div>
      )}
    </div>
  );
}
