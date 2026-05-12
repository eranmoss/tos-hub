import { client } from './client.js';

export const getLifecycleSuppliers = () =>
  client.get('/v1/dashboard/lifecycle/suppliers').then((r) => r.data);

export const runLifecycleStep = (slug, step, body) =>
  client.post(`/v1/dashboard/lifecycle/${slug}/${step}`, body).then((r) => r.data);
