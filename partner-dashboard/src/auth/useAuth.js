import { JWT_KEY } from '../api/client.js';

const decode = (jwt) => {
  try {
    const [, payload] = jwt.split('.');
    const pad = '='.repeat((4 - (payload.length % 4)) % 4);
    const b64 = (payload + pad).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
};

export const getTenant = () => {
  const jwt = typeof localStorage !== 'undefined' ? localStorage.getItem(JWT_KEY) : null;
  if (!jwt) return null;
  const p = decode(jwt);
  if (!p) return null;
  if (p.exp && p.exp * 1000 < Date.now()) {
    localStorage.removeItem(JWT_KEY);
    return null;
  }
  return p;
};

export const useAuth = () => {
  const tenant = getTenant();
  return {
    tenant,
    isAuthenticated: !!tenant,
    logout: () => {
      localStorage.removeItem(JWT_KEY);
      window.location.href = '/login';
    },
  };
};
