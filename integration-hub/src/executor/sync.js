import { createHash } from 'crypto';
import { query } from '../db/client.js';
import { getSecret } from '../infra/secrets.js';
import { HotelbedsHotels } from '../suppliers/hotelbeds/hotels.js';
import { HotelbedsExperiences } from '../suppliers/hotelbeds/experiences.js';
import { HotelbedsTransfers } from '../suppliers/hotelbeds/transfers.js';
import { BridgifyExperiences } from '../suppliers/bridgify/experiences.js';

const hash = (v) => createHash('sha256').update(JSON.stringify(v || {})).digest('hex');

const need = (creds, slug, fields) => {
  if (!creds) throw new Error(`No credentials configured for supplier '${slug}' on this tenant. Run scripts/set_credentials.js`);
  for (const f of fields) {
    if (!creds[f]) throw new Error(`Missing field '${f}' in credentials for '${slug}'`);
  }
  return creds;
};

const buildSupplier = async (slug, tenantId) => {
  if (slug === 'hotelbeds-hotels') {
    const c = need(await getSecret(tenantId, slug), slug, ['api_key', 'secret_key']);
    return new HotelbedsHotels({ apiKey: c.api_key, secretKey: c.secret_key, env: c.env || 'sandbox', baseUrl: c.base_url });
  }
  if (slug === 'hotelbeds-activities') {
    const c = need(await getSecret(tenantId, slug), slug, ['api_key', 'secret_key']);
    return new HotelbedsExperiences({ apiKey: c.api_key, secretKey: c.secret_key, env: c.env || 'sandbox', baseUrl: c.base_url });
  }
  if (slug === 'hotelbeds-transfers') {
    const c = need(await getSecret(tenantId, slug), slug, ['api_key', 'secret_key']);
    return new HotelbedsTransfers({ apiKey: c.api_key, secretKey: c.secret_key, env: c.env || 'sandbox', baseUrl: c.base_url });
  }
  if (slug === 'bridgify') {
    const c = need(await getSecret(tenantId, slug), slug, ['client_id', 'client_secret']);
    return new BridgifyExperiences({
      clientId: c.client_id, clientSecret: c.client_secret, baseUrl: c.base_url,
    });
  }
  throw new Error(`Unknown supplier: ${slug}`);
};

const logTxn = async (tenantId, supplier, operation, status, latencyMs, req, res) => {
  try {
    await query(
      `INSERT INTO hub_transactions(tenant_id, supplier_slug, operation, status, latency_ms, request_hash, response_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, supplier, operation, status, latencyMs, hash(req), hash(res)]
    );
  } catch {}
};

export const execSync = async ({ tenantId, supplier, operation, args }) => {
  if (!tenantId) throw new Error('tenant_id is required');
  const client = await buildSupplier(supplier, tenantId);
  const start = Date.now();
  let result, status = 'OK';
  try {
    if (typeof client[operation] !== 'function') {
      throw new Error(`Unsupported operation: ${operation}`);
    }
    result = await client[operation](args);
  } catch (err) {
    status = 'ERROR';
    await logTxn(tenantId, supplier, operation, status, Date.now() - start, args, { error: err.message });
    // Async knowledge event — fire-and-forget.
    (async () => {
      try {
        const { recordEvent, processEvent } = await import('../knowledge/knowledge-learner.js');
        const id = await recordEvent({
          supplierSlug: supplier, tenantId,
          eventType: 'sync_error',
          payload: { operation, error: err.message, status_code: err.response?.status || null, args },
        });
        if (id) await processEvent(id);
      } catch {}
    })();
    throw err;
  }
  await logTxn(tenantId, supplier, operation, status, Date.now() - start, args, result);
  return result;
};
