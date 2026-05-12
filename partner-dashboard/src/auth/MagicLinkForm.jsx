import { useState } from 'react';
import { requestMagicLink } from '../api/auth.js';

export default function MagicLinkForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | sent | error
  const [errorMsg, setErrorMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');
    try {
      await requestMagicLink(email);
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.response?.data?.error || 'Something went wrong');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-page-bg">
      <div className="w-full max-w-md bg-card-bg rounded-card shadow-sm p-8 border border-border-default">
        <h1 className="text-2xl font-semibold text-primary">TOS Partner Portal</h1>
        <p className="text-text-secondary mt-1 mb-6">Sign in with your partner email.</p>

        {status === 'sent' ? (
          <div className="p-4 rounded-btn bg-success/10 text-success font-medium">
            Check your email for your login link.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-text-primary">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-btn border border-border-default px-3 py-2 focus:border-accent focus:outline-none"
                placeholder="you@partner.com"
              />
            </label>
            {errorMsg && <div className="text-danger text-sm">{errorMsg}</div>}
            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full rounded-btn bg-accent text-white font-medium py-2 disabled:opacity-60"
            >
              {status === 'loading' ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
