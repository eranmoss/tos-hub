import axios from 'axios';

export const JWT_KEY = 'tos_jwt';

export const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem(JWT_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing = null;
client.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401 && !err.config.__retry) {
      if (!refreshing) {
        refreshing = client.post('/v1/auth/dev-login', { email: 'eranm@bridgify.io' })
          .then((r) => {
            if (r.data?.jwt) localStorage.setItem(JWT_KEY, r.data.jwt);
            return r.data?.jwt;
          })
          .catch(() => null)
          .finally(() => { refreshing = null; });
      }
      const jwt = await refreshing;
      if (jwt) {
        err.config.__retry = true;
        err.config.headers.Authorization = `Bearer ${jwt}`;
        return client.request(err.config);
      }
    }
    return Promise.reject(err);
  },
);
