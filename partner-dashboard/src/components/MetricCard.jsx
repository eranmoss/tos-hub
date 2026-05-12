export default function MetricCard({ label, value, sub, trend }) {
  const trendColor =
    trend === 'up' ? 'text-success' : trend === 'down' ? 'text-danger' : 'text-text-secondary';
  return (
    <div className="bg-card-bg rounded-card border border-border-default p-4 shadow-sm">
      <div className="text-xs text-text-secondary uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-text-primary">{value}</div>
      {sub && <div className={`text-xs mt-1 ${trendColor}`}>{sub}</div>}
    </div>
  );
}
