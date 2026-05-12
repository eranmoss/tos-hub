import { useState } from 'react';
import { patchPrompt } from '../api/dashboard.js';

const CAT_COLOR = {
  INVENTORY: 'bg-teal/10 text-teal',
  INTEGRATION: 'bg-accent/10 text-accent',
  PRICING: 'bg-warning/10 text-warning',
  POLICY: 'bg-danger/10 text-danger',
};

export default function PromptCard({ prompt }) {
  const [active, setActive] = useState(prompt.is_active);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const r = await patchPrompt(prompt.id, { is_active: !active });
      setActive(r.is_active);
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-card-bg border border-border-default rounded-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="font-medium text-text-primary">{prompt.prompt_key}</div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CAT_COLOR[prompt.category] || ''}`}>
          {prompt.category}
        </span>
      </div>
      <div className="mt-1 text-xs text-text-secondary">
        Trigger: {prompt.trigger_condition}
      </div>
      {prompt.escalate_to_human && (
        <div className="mt-1 text-xs text-warning">Escalates to human</div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={active} onChange={toggle} disabled={busy} />
          Active
        </label>
        <span className="text-xs text-text-secondary">v{prompt.version}</span>
      </div>
    </div>
  );
}
