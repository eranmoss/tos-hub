import { client } from './client.js';

export const getBuilderState = (slug) =>
  client.get('/v1/builder/state', { params: slug ? { slug } : {} }).then(r => r.data);

export const runPrompt = (prompt, page_slug) =>
  client.post('/v1/builder/prompt', { prompt, page_slug }).then(r => r.data);

export const applyManifest = (payload) =>
  client.post('/v1/builder/apply', payload).then(r => r.data);

// Reuse pages API for create / delete
export const listPages = () =>
  client.get('/v1/pages').then(r => r.data);

export const deletePage = (id) =>
  client.delete(`/v1/pages/${id}`).then(r => r.data);

// ── Component Editor API ──────────────────────────────────────────────────────
export const listAllComponents = () =>
  client.get('/v1/builder/components').then(r => r.data.components);

export const generateComponentTemplate = (payload) =>
  client.post('/v1/builder/components/generate', payload).then(r => r.data);

export const createComponent = (payload) =>
  client.post('/v1/builder/components', payload).then(r => r.data);

export const updateComponent = (name, payload) =>
  client.put(`/v1/builder/components/${name}`, payload).then(r => r.data);

export const deleteComponent = (name) =>
  client.delete(`/v1/builder/components/${name}`).then(r => r.data);

export const getComponentSource = (name) =>
  client.get(`/v1/builder/components/${name}/source`).then(r => r.data);

export const saveComponentSource = (name, source) =>
  client.put(`/v1/builder/components/${name}/source`, { source }).then(r => r.data);
