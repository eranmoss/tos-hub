import { client } from './client.js';

export const requestMagicLink = (email) =>
  client.post('/v1/auth/magic-link', { email }).then(r => r.data);

export const verifyToken = (token) =>
  client.get(`/v1/auth/verify/${token}`).then(r => r.data);
