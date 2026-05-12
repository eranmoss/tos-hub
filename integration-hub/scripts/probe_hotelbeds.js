// Diagnostic: calls each HotelBeds content endpoint directly and reports
// envelope shape + total counts without running the full sync.
//
// Run: node scripts/probe_hotelbeds.js

import 'dotenv/config';
import axios from 'axios';
import { buildHeaders } from '../src/suppliers/hotelbeds/auth.js';
import { getSecret } from '../src/infra/secrets.js';
import { query, closePool } from '../src/db/client.js';

const log = (event, extra = {}) => console.log(JSON.stringify({ event, ...extra }));

const BASES = {
  'hotelbeds-hotels':     'https://api.test.hotelbeds.com/hotel-content-api/1.0',
  'hotelbeds-activities': 'https://api.test.hotelbeds.com/activity-content-api/1.0',
  'hotelbeds-transfers':  'https://api.test.hotelbeds.com/transfer-cache-api/1.0',
};
const PATHS = {
  'hotelbeds-hotels':     '/hotels',
  'hotelbeds-activities': '/activities',
  'hotelbeds-transfers':  '/routes',
};
const PAGES = {
  'hotelbeds-hotels':     { fields: 'all', language: 'ENG', from: 1, to: 1000, useSecondaryLanguage: false },
  'hotelbeds-activities': { language: 'ENG', from: 1, to: 500 },
  'hotelbeds-transfers':  { from: 1, to: 500 },
};

const describe = (slug, data) => {
  const top = Object.keys(data || {});
  const hotels = data?.hotels?.length;
  const activities = data?.activities?.length;
  const routes = data?.routes?.length;
  const transfers = data?.transfers?.length;
  const total = data?.total ?? data?.totalHits ?? data?.pagination?.total ?? null;
  const firstKey = top.find(k => Array.isArray(data[k]));
  const firstRec = firstKey ? data[firstKey]?.[0] : null;
  log('envelope', {
    slug, top_keys: top, total,
    hotels, activities, routes, transfers,
    first_array_key: firstKey,
    first_record_keys: firstRec ? Object.keys(firstRec).slice(0, 15) : null,
  });
};

const probe = async (slug) => {
  const tenantRow = await query(
    `SELECT tenant_id FROM hub_tenant_suppliers WHERE supplier_slug=$1 AND is_active=true LIMIT 1`, [slug]
  );
  const tenantId = tenantRow.rows[0]?.tenant_id;
  if (!tenantId) { log('no_tenant', { slug }); return; }
  const creds = await getSecret(tenantId, slug);
  const secret = creds?.secret_key || creds?.secret;
  if (!creds?.api_key || !secret) {
    log('no_creds', { slug, tenantId, cred_keys: creds ? Object.keys(creds) : null });
    return;
  }

  try {
    const res = await axios.get(`${BASES[slug]}${PATHS[slug]}`, {
      headers: buildHeaders(creds.api_key, secret),
      params: PAGES[slug],
      timeout: 60000,
    });
    log('response', { slug, status: res.status, content_length: JSON.stringify(res.data).length });
    describe(slug, res.data);
  } catch (e) {
    log('error', { slug, status: e.response?.status, message: e.message, body: e.response?.data });
  }
};

const main = async () => {
  for (const slug of ['hotelbeds-hotels', 'hotelbeds-activities', 'hotelbeds-transfers']) {
    await probe(slug);
  }
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((e) => { log('failed', { error: e.message }); process.exit(1); });
