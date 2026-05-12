import axios from 'axios';
import { runSync } from './base-sync.js';
import { buildHeaders } from '../suppliers/hotelbeds/auth.js';

const SANDBOX = 'https://api.test.hotelbeds.com/transfer-cache-api/1.0';
const PROD = 'https://api.hotelbeds.com/transfer-cache-api/1.0';

// HotelBeds transfer-cache-api publishes the LOCATIONS catalog
// (destinations, hotels, terminals). Actual transfer routes + pricing
// are search-time only and not cacheable. We sync destinations AND
// terminals here so the TOS inventory has pickup/dropoff points.
const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));

const extractName = (raw) => {
  if (typeof raw.name === 'object' && raw.name !== null) {
    return raw.name.description || raw.name.name || JSON.stringify(raw.name);
  }
  return raw.name || raw.content || null;
};

const mapper = (raw) => {
  const ref = String(raw?.code || '');
  if (!ref) return null;
  const name = extractName(raw);
  return {
    supplier_raw_ref: `${raw._locationType || 'DST'}-${ref}`,
    type: 'TRANSFER',
    title: name || `Transfer Point ${ref}`,
    city: typeof raw.name === 'string' ? raw.name : (raw.content || name || null),
    country: raw.countryCode || null,
    route_origin: ref,
    route_destination: null,
    raw_content: raw,
  };
};

const fetchEndpoint = async function* ({ apiKey, secretKey, baseUrl, endpoint, locationType, label }) {
  const headers = buildHeaders(apiKey, secretKey);
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${baseUrl}/${endpoint}`;
    const params = { fields: 'ALL', language: 'ENG', offset, limit };
    let res;
    try {
      res = await axios.get(url, {
        headers, params, timeout: 120000,
        validateStatus: (s) => s < 500,
      });
    } catch (e) {
      log('hb_transfers_fetch_error', { endpoint, offset, error: e.message });
      return;
    }
    if (res.status === 204) { log('hb_transfers_empty', { endpoint, offset }); return; }
    if (res.status === 403) {
      log('hb_transfers_access_denied', { endpoint, offset, status: 403 });
      return;
    }
    if (res.status >= 400) {
      const body = typeof res.data === 'string' ? res.data.slice(0, 400)
        : res.data ? JSON.stringify(res.data).slice(0, 400) : null;
      log('hb_transfers_http_error', { endpoint, offset, status: res.status, body_preview: body });
      return;
    }
    const body = res.data;
    const records = Array.isArray(body) ? body
      : Array.isArray(body?.destinations) ? body.destinations
      : Array.isArray(body?.locations) ? body.locations
      : Array.isArray(body?.terminals) ? body.terminals
      : [];

    if (records.length === 0) {
      log('hb_transfers_endpoint_done', { endpoint, offset, total_fetched: offset });
      return;
    }

    records.forEach(r => { r._locationType = locationType; });

    if (offset === 0 && records[0]) {
      log('hb_transfers_record_shape', {
        endpoint,
        top_keys: Object.keys(records[0]).slice(0, 20),
        sample: JSON.stringify(records[0]).slice(0, 300),
        total_in_page: records.length,
      });
    }

    yield { records };
    log('hb_transfers_page', { endpoint, offset, page_count: records.length });

    if (records.length < limit) return;
    offset += limit;
  }
};

const ENDPOINTS = [
  { endpoint: 'locations/destinations', locationType: 'DST', label: 'destinations' },
  { endpoint: 'locations/terminals', locationType: 'TRM', label: 'terminals' },
];

const fetchAll = async function* ({ apiKey, secretKey, baseUrl }) {
  for (const ep of ENDPOINTS) {
    log('hb_transfers_fetching', { endpoint: ep.endpoint });
    yield* fetchEndpoint({ apiKey, secretKey, baseUrl, ...ep });
  }
};

export const syncHotelbedsTransfers = async ({ apiKey, secretKey, env = 'sandbox' }) => {
  const baseUrl = env === 'production' ? PROD : SANDBOX;
  log('hb_transfers_sync_start', { baseUrl });
  return runSync({
    supplierSlug: 'hotelbeds-transfers',
    fetcher: () => fetchAll({ apiKey, secretKey, baseUrl }),
    mapper,
  });
};
