import axios from 'axios';
import { getSecret } from '../../infra/secrets.js';

const SANDBOX_URL = 'https://api.sandbox.viator.com/partner';
const PROD_URL = 'https://api.viator.com/partner';

const clientFor = async (tenantId) => {
  const creds = await getSecret(tenantId, 'viator');
  if (!creds?.api_key) throw new Error('viator credentials not found for tenant');
  const baseURL = creds.env === 'production' ? PROD_URL : SANDBOX_URL;
  return axios.create({
    baseURL,
    headers: {
      'exp-api-key': creds.api_key,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en',
    },
    timeout: 30000,
  });
};

export const viatorHandler = {
  detail: async ({ tenantId, rawRef }) => {
    const client = await clientFor(tenantId);
    const resp = await client.get(`/products/${encodeURIComponent(rawRef)}`);
    return { ok: true, data: resp.data };
  },

  availability: async ({ tenantId, rawRef, payload = {} }) => {
    const client = await clientFor(tenantId);
    const body = {
      productCode: rawRef,
      travelDate: payload.date || payload.date_from || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      currency: payload.currency || 'USD',
    };
    const resp = await client.post('/availability/check', body);
    return {
      ok: true,
      data: resp.data,
      bookable_items: resp.data?.bookableItems || [],
    };
  },

  // TODO: Implement booking when Viator partner API key is fully activated
  book: async () => {
    return { ok: false, error: 'Viator direct booking not yet implemented' };
  },

  cancel: async () => {
    return { ok: false, error: 'Viator direct cancellation not yet implemented' };
  },
};
