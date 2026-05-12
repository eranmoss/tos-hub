import { useState } from 'react';
import { resolveEscalation } from '../api/dashboard.js';

const ago = (s) => {
  const ms = Date.now() - new Date(s).getTime();
  const h = Math.round(ms / 3.6e6);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export default function EscalationCard({ escalation, onResolved }) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState('');
  const [action, setAction] = useState('ACKNOWLEDGE');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await resolveEscalation(escalation.id, { resolution, action });
      onResolved?.(escalation.id);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="bg-card-bg border border-border-default rounded-card p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-text-primary">{escalation.prompt_key}</div>
          <div className="text-xs text-text-secondary">{ago(escalation.created_at)}</div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          escalation.status === 'PENDING' ? 'bg-warning/10 text-warning'
          : escalation.status === 'RESOLVED' ? 'bg-success/10 text-success'
          : 'bg-text-secondary/10 text-text-secondary'
        }`}>
          {escalation.status}
        </span>
      </div>
      {escalation.trigger_data && (
        <pre className="mt-3 text-xs bg-page-bg p-2 rounded-btn overflow-auto max-h-32">
          {JSON.stringify(escalation.trigger_data, null, 2)}
        </pre>
      )}
      {escalation.status === 'PENDING' && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 text-xs rounded-btn bg-accent text-white px-3 py-1"
        >
          Resolve
        </button>
      )}
      {open && (
        <div className="mt-3 space-y-2 text-xs">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="rounded-btn border border-border-default px-2 py-1"
          >
            <option value="ACKNOWLEDGE">Acknowledge</option>
            <option value="OVERRIDE">Override</option>
            <option value="DISMISS">Dismiss</option>
          </select>
          <textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Resolution notes…"
            rows={2}
            className="w-full rounded-btn border border-border-default px-2 py-1"
          />
          <div className="flex gap-2">
            <button disabled={busy} onClick={submit} className="rounded-btn bg-success text-white px-3 py-1">
              {busy ? 'Resolving…' : 'Confirm'}
            </button>
            <button onClick={() => setOpen(false)} className="text-text-secondary">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
