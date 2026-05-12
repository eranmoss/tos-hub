import { useEffect, useState } from 'react';
import { useAuth } from './useAuth.js';
import { client, JWT_KEY } from '../api/client.js';

// Dev auto-login: if no JWT in localStorage, hit /v1/auth/dev-login,
// store the JWT, and reload. Set VITE_DEV_LOGIN_EMAIL in .env.local to
// pick a specific tenant; otherwise the hub returns the first tenant.
const DEV_AUTO_LOGIN =
  import.meta.env.MODE !== 'test' &&
  (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') &&
  typeof globalThis.__vitest_worker__ === 'undefined';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const [trying, setTrying] = useState(!isAuthenticated && DEV_AUTO_LOGIN);

  useEffect(() => {
    if (isAuthenticated || !trying) return;
    const email = import.meta.env.VITE_DEV_LOGIN_EMAIL || 'eranm@bridgify.io';
    client.post('/v1/auth/dev-login', email ? { email } : {})
      .then(res => {
        if (res.data?.jwt) {
          localStorage.setItem(JWT_KEY, res.data.jwt);
          window.location.reload();
        } else {
          setTrying(false);
        }
      })
      .catch(() => setTrying(false));
  }, [isAuthenticated, trying]);

  if (trying) return <div style={{ padding: 40, color: '#888' }}>Signing you in…</div>;
  return children;
}
