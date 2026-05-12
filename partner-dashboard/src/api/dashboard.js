import { client } from './client.js';

export const getOverview = () =>
  client.get('/v1/dashboard/overview').then(r => r.data);

export const getSuppliers = () =>
  client.get('/v1/dashboard/suppliers').then(r => r.data);

export const runSupplierTest = (slug) =>
  client.post(`/v1/dashboard/suppliers/${slug}/test`).then(r => r.data);

export const getSupplierTests = (slug) =>
  client.get(`/v1/dashboard/suppliers/${slug}/tests`).then(r => r.data);

export const toggleSupplier = (slug, enable) =>
  client.post(`/v1/dashboard/suppliers/${slug}/toggle`, { enable }).then(r => r.data);

export const getTransactions = (params = {}) =>
  client.get('/v1/dashboard/transactions', { params }).then(r => r.data);

export const getInventory = (params = {}) =>
  client.get('/v1/dashboard/inventory', { params }).then(r => r.data);

export const getSyncHistory = () =>
  client.get('/v1/dashboard/inventory/sync-history').then(r => r.data);

export const getInventoryGrowth = (params = {}) =>
  client.get('/v1/dashboard/inventory/growth', { params }).then(r => r.data);

export const triggerSync = (supplier) =>
  client.post('/v1/dashboard/sync/trigger', { supplier }).then(r => r.data);

export const getSyncStatus = () =>
  client.get('/v1/dashboard/sync/status').then(r => r.data);

export const triggerDedup = () =>
  client.post('/v1/dashboard/dedup/run').then(r => r.data);

export const triggerLLMJudge = () =>
  client.post('/v1/dashboard/dedup/llm-judge').then(r => r.data);

export const triggerEnrichActivities = (limit) =>
  client.post('/v1/dashboard/enrich/activities', limit ? { limit } : {}).then(r => r.data);

export const getDedupConfig = () =>
  client.get('/v1/dashboard/dedup-config').then(r => r.data);

export const patchDedupConfig = (body) =>
  client.patch('/v1/dashboard/dedup-config', body).then(r => r.data);

export const getDedupClusters = (params = {}) =>
  client.get('/v1/dashboard/dedup-clusters', { params }).then(r => r.data);

export const getDedupLog = (params = {}) =>
  client.get('/v1/dashboard/dedup-log', { params }).then(r => r.data);

export const getDedupReviewSample = (params = {}) =>
  client.get('/v1/dashboard/dedup-review/sample', { params }).then(r => r.data);

export const submitDedupReview = (body) =>
  client.post('/v1/dashboard/dedup-review', body).then(r => r.data);

export const getDedupReviewStats = () =>
  client.get('/v1/dashboard/dedup-review/stats').then(r => r.data);

export const getEscalations = (params = {}) =>
  client.get('/v1/dashboard/escalations', { params }).then(r => r.data);

export const resolveEscalation = (id, body) =>
  client.post(`/v1/admin/escalation/${id}/resolve`, body).then(r => r.data);

export const getPrompts = () =>
  client.get('/v1/dashboard/prompts').then(r => r.data);

export const patchPrompt = (id, body) =>
  client.patch(`/v1/dashboard/prompts/${id}`, body).then(r => r.data);

export const getSettings = () =>
  client.get('/v1/dashboard/settings').then(r => r.data);

export const rotateApiKey = () =>
  client.post('/v1/dashboard/settings/rotate-key').then(r => r.data);

export const createWebhook = (body) =>
  client.post('/v1/dashboard/settings/webhooks', body).then(r => r.data);

export const deleteWebhook = (id) =>
  client.delete(`/v1/dashboard/settings/webhooks/${id}`).then(r => r.data);

export const patchNotificationEmail = (notification_email) =>
  client.patch('/v1/dashboard/settings/notification-email', { notification_email })
    .then(r => r.data);

export const getAttractions = (params = {}) =>
  client.get('/v1/dashboard/attractions', { params }).then(r => r.data);

export const getAttractionDetail = (id) =>
  client.get(`/v1/dashboard/attractions/${id}`).then(r => r.data);

export const getAttractionAutocomplete = (q) =>
  client.get('/v1/dashboard/attractions/autocomplete', { params: { q } }).then(r => r.data);

export const triggerAttractionCluster = () =>
  client.post('/v1/dashboard/attractions/cluster').then(r => r.data);

export const triggerAttractionValidate = () =>
  client.post('/v1/dashboard/attractions/validate').then(r => r.data);

export const triggerPoiMatch = () =>
  client.post('/v1/dashboard/attractions/poi-match').then(r => r.data);

export const getAttractionReview = () =>
  client.get('/v1/dashboard/attractions/review').then(r => r.data);

export const resolveAttractionReview = (escalationId, action) =>
  client.post(`/v1/dashboard/attractions/review/${escalationId}`, { action }).then(r => r.data);

export const getJobs = () =>
  client.get('/v1/dashboard/jobs').then(r => r.data);

export const getRunningJobs = () =>
  client.get('/v1/dashboard/jobs/running').then(r => r.data);

export const restartJob = (jobId) =>
  client.post(`/v1/dashboard/jobs/${jobId}/restart`).then(r => r.data);

export const cancelJob = (jobId) =>
  client.post(`/v1/dashboard/jobs/${jobId}/cancel`).then(r => r.data);

export const runEmbeddings = (type = 'EXPERIENCE') =>
  client.post('/v1/dashboard/embeddings/run', { type }).then(r => r.data);

export const analyzeDocsUrl = (url) =>
  client.post('/v1/dashboard/onboard/analyze-docs', { url }).then(r => r.data);

export const analyzeByName = (name) =>
  client.post('/v1/dashboard/onboard/analyze-name', { name }).then(r => r.data);

export const createOnboardSession = (manifest) =>
  client.post('/v1/dashboard/onboard', manifest).then(r => r.data);

export const reonboardFromExisting = (slug) =>
  client.post(`/v1/dashboard/onboard/from-existing/${slug}`).then(r => r.data);

export const getOnboardSession = (id) =>
  client.get(`/v1/dashboard/onboard/${id}`).then(r => r.data);

export const patchOnboardManifest = (id, manifest) =>
  client.patch(`/v1/dashboard/onboard/${id}/manifest`, manifest).then(r => r.data);

export const confirmOnboardSession = (id) =>
  client.post(`/v1/dashboard/onboard/${id}/confirm`).then(r => r.data);

export const promoteOnboardSession = (id) =>
  client.post(`/v1/dashboard/onboard/${id}/promote`).then(r => r.data);

export const autoMapOnboardSession = (id, body) =>
  client.post(`/v1/dashboard/onboard/${id}/auto-map`, body).then(r => r.data);

export const triggerGeoReview = () =>
  client.post('/v1/dashboard/dedup/geo-review').then(r => r.data);

export const getEvalStats = () =>
  client.get('/v1/dashboard/eval/stats').then(r => r.data);

export const getRankingConfig = () =>
  client.get('/v1/dashboard/ranking-config').then(r => r.data);

export const patchRankingConfig = (body) =>
  client.patch('/v1/dashboard/ranking-config', body).then(r => r.data);

export const getGoldDataset = () =>
  client.get('/v1/dashboard/gold-dataset').then(r => r.data);

export const sampleGoldPairs = () =>
  client.post('/v1/dashboard/gold-dataset/sample').then(r => r.data);

export const labelGoldPairs = () =>
  client.post('/v1/dashboard/gold-dataset/label').then(r => r.data);

export const evalGoldDataset = (overrides = {}) =>
  client.post('/v1/dashboard/gold-dataset/eval', overrides).then(r => r.data);

export const deleteGoldDataset = () =>
  client.delete('/v1/dashboard/gold-dataset').then(r => r.data);

// ---- Global POIs ----
export const getGlobalPois = (params = {}) =>
  client.get('/v1/dashboard/pois', { params }).then(r => r.data);

export const getPoiStats = () =>
  client.get('/v1/dashboard/pois/stats').then(r => r.data);

export const getPoiDetail = (id) =>
  client.get(`/v1/dashboard/pois/${id}`).then(r => r.data);

// ---- Category Taxonomy ----
export const getCategories = (params = {}) =>
  client.get('/v1/dashboard/categories', { params }).then(r => r.data);

export const getCategoryDetail = (id) =>
  client.get(`/v1/dashboard/categories/${encodeURIComponent(id)}`).then(r => r.data);

export const createCategory = (data) =>
  client.post('/v1/dashboard/categories', data).then(r => r.data);

export const updateCategory = (id, data) =>
  client.put(`/v1/dashboard/categories/${encodeURIComponent(id)}`, data).then(r => r.data);

export const deleteCategory = (id) =>
  client.delete(`/v1/dashboard/categories/${encodeURIComponent(id)}`).then(r => r.data);

export const getCategoryMappings = (params = {}) =>
  client.get('/v1/dashboard/category-mappings', { params }).then(r => r.data);

export const createCategoryMapping = (data) =>
  client.post('/v1/dashboard/category-mappings', data).then(r => r.data);

export const deleteCategoryMapping = (data) =>
  client.delete('/v1/dashboard/category-mappings', { data }).then(r => r.data);

export const getCategoryStats = () =>
  client.get('/v1/dashboard/category-stats').then(r => r.data);

export const getUnmappedCategories = (params = {}) =>
  client.get('/v1/dashboard/categories/unmapped', { params }).then(r => r.data);

export const autoMapCategories = (data) =>
  client.post('/v1/dashboard/categories/auto-map', data).then(r => r.data);
