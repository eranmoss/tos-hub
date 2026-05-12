import { useEffect, useState } from 'react';
import { usePageContext } from '../agent/usePageContext.js';
import {
  getSettings, rotateApiKey, createWebhook, deleteWebhook, patchNotificationEmail,
} from '../api/dashboard.js';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [hookForm, setHookForm] = useState({ event_type: '', endpoint_url: '' });
  const [newHookSecret, setNewHookSecret] = useState(null);
  const [notifEmail, setNotifEmail] = useState('');
  const [notifStatus, setNotifStatus] = useState('idle');
  const { register } = usePageContext();

  useEffect(() => { register('settings', {}); }, [register]);

  const load = () => getSettings().then((d) => {
    setSettings(d);
    setNotifEmail(d.notification_email || '');
  });
  useEffect(() => { load(); }, []);

  const doRotate = async () => {
    if (!window.confirm('Rotating will immediately invalidate the current API key. Continue?')) return;
    setRotating(true);
    try {
      const r = await rotateApiKey();
      setNewKey(r.new_api_key);
      await load();
    } finally { setRotating(false); }
  };

  const addHook = async (e) => {
    e.preventDefault();
    if (!hookForm.event_type || !hookForm.endpoint_url) return;
    const r = await createWebhook(hookForm);
    setNewHookSecret({ id: r.id, secret: r.secret });
    setHookForm({ event_type: '', endpoint_url: '' });
    await load();
  };

  const removeHook = async (id) => {
    if (!window.confirm('Delete webhook?')) return;
    await deleteWebhook(id);
    await load();
  };

  const saveNotif = async () => {
    setNotifStatus('saving');
    try {
      await patchNotificationEmail(notifEmail);
      setNotifStatus('saved');
    } catch { setNotifStatus('error'); }
  };

  if (!settings) return <div className="p-8 text-text-secondary">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <section className="bg-card-bg border border-border-default rounded-card p-5">
        <h3 className="font-semibold text-primary mb-3">Account</h3>
        <div className="text-sm grid grid-cols-2 gap-2">
          <div><div className="text-xs text-text-secondary">User</div>{settings.user_name || settings.email}</div>
          <div><div className="text-xs text-text-secondary">Role</div>
            <span className="inline-block mt-1 bg-accent/10 text-accent text-xs px-2 py-0.5 rounded-full font-medium capitalize">
              {settings.role || 'admin'}
            </span>
          </div>
          <div><div className="text-xs text-text-secondary">Organization</div>{settings.tenant_name}</div>
          <div><div className="text-xs text-text-secondary">Tier</div>
            <span className="inline-block mt-1 bg-teal/10 text-teal text-xs px-2 py-0.5 rounded-full font-medium">
              {settings.tier}
            </span>
          </div>
          <div><div className="text-xs text-text-secondary">Email</div>{settings.email}</div>
        </div>
      </section>

      <section className="bg-card-bg border border-border-default rounded-card p-5">
        <h3 className="font-semibold text-primary mb-3">API Key</h3>
        <div className="text-sm flex items-center justify-between">
          <code className="font-mono">{settings.api_key_preview || 'no key set'}</code>
          <button
            type="button"
            onClick={doRotate}
            disabled={rotating}
            className="rounded-btn bg-danger text-white px-4 py-2 text-xs disabled:opacity-60"
          >
            {rotating ? 'Rotating…' : 'Rotate key'}
          </button>
        </div>
        {newKey && (
          <div className="mt-3 p-3 rounded-btn bg-warning/10 text-warning text-xs">
            <div className="font-medium">Your new API key — shown once, store it now:</div>
            <code className="block mt-1 break-all font-mono text-text-primary">{newKey}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(newKey)}
              className="mt-2 rounded-btn border border-warning px-2 py-1 text-xs"
            >
              Copy
            </button>
          </div>
        )}
      </section>

      <section className="bg-card-bg border border-border-default rounded-card p-5">
        <h3 className="font-semibold text-primary mb-3">Webhooks</h3>
        <ul className="divide-y divide-border-default">
          {(settings.webhooks || []).map((w) => (
            <li key={w.id} className="py-2 flex items-center justify-between text-sm">
              <div>
                <div className="font-medium">{w.event_type}</div>
                <div className="text-xs text-text-secondary">{w.endpoint_url}</div>
              </div>
              <button
                type="button"
                onClick={() => removeHook(w.id)}
                className="text-danger text-xs hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
          {(settings.webhooks || []).length === 0 && (
            <li className="py-2 text-xs text-text-secondary">No webhooks configured</li>
          )}
        </ul>
        <form onSubmit={addHook} className="mt-3 flex gap-2 items-end">
          <label className="text-xs flex-1">
            <span className="text-text-secondary">Event type</span>
            <input
              value={hookForm.event_type}
              onChange={(e) => setHookForm({ ...hookForm, event_type: e.target.value })}
              placeholder="booking.confirmed"
              className="mt-1 block w-full rounded-btn border border-border-default px-2 py-1"
            />
          </label>
          <label className="text-xs flex-[2]">
            <span className="text-text-secondary">Endpoint URL</span>
            <input
              type="url"
              value={hookForm.endpoint_url}
              onChange={(e) => setHookForm({ ...hookForm, endpoint_url: e.target.value })}
              placeholder="https://example.com/hook"
              className="mt-1 block w-full rounded-btn border border-border-default px-2 py-1"
            />
          </label>
          <button type="submit" className="rounded-btn bg-accent text-white px-3 py-2 text-xs">
            Add
          </button>
        </form>
        {newHookSecret && (
          <div className="mt-3 p-2 rounded-btn bg-warning/10 text-xs text-warning">
            Secret for new webhook (shown once):
            <code className="block mt-1 font-mono text-text-primary break-all">{newHookSecret.secret}</code>
          </div>
        )}
      </section>

      <section className="bg-card-bg border border-border-default rounded-card p-5">
        <h3 className="font-semibold text-primary mb-3">Notification email</h3>
        <div className="flex gap-2 items-end">
          <input
            type="email"
            value={notifEmail}
            onChange={(e) => setNotifEmail(e.target.value)}
            placeholder="ops@partner.com"
            className="flex-1 rounded-btn border border-border-default px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={saveNotif}
            disabled={notifStatus === 'saving'}
            className="rounded-btn bg-accent text-white px-4 py-2 text-sm"
          >
            Save
          </button>
          {notifStatus === 'saved' && <span className="text-success text-xs">Saved</span>}
        </div>
      </section>
    </div>
  );
}
