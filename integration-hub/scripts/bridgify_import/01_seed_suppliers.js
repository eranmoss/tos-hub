// Seed hub_suppliers with the 7 Bridgify experience suppliers we'll import from.
// Idempotent — safe to re-run (uses ON CONFLICT DO NOTHING).
//
// Usage: node scripts/bridgify_import/01_seed_suppliers.js

import 'dotenv/config';
import { query, closePool } from '../../src/db/client.js';

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));

// 7 experience-style Bridgify suppliers with active inventory and recent updates.
// auth_type is 'BRIDGIFY_DB' to indicate these aren't synced via API — they come
// from a one-time DB import. Existing supplier_slug values follow the integration_hub
// convention of lowercase, hyphen-separated.
const SUPPLIERS = [
  { slug: 'viator',          name: 'Viator (via Bridgify)',          categories: ['EXPERIENCE'] },
  { slug: 'getyourguide',    name: 'GetYourGuide (via Bridgify)',    categories: ['EXPERIENCE'] },
  { slug: 'tiqets',          name: 'Tiqets (via Bridgify)',          categories: ['EXPERIENCE'] },
  { slug: 'hotelbeds',       name: 'HotelBeds (via Bridgify)',       categories: ['EXPERIENCE'] },
  { slug: 'attractionworld', name: 'AttractionWorld (via Bridgify)', categories: ['EXPERIENCE'] },
  { slug: 'bookitfun',       name: 'BookitFun (via Bridgify)',       categories: ['EXPERIENCE'] },
  { slug: 'tillo',           name: 'Tillo (via Bridgify)',           categories: ['EXPERIENCE'] },
  { slug: 'stubhub',         name: 'StubHub (via Bridgify)',         categories: ['EVENT'] },
  { slug: 'ticketero',       name: 'Ticketero (via Bridgify)',       categories: ['EVENT'] },
  { slug: 'sportsevents365', name: 'SportsEvents365 (via Bridgify)', categories: ['EVENT'] },
  { slug: 'livetickets',     name: 'LiveTickets (via Bridgify)',     categories: ['EVENT'] },
  { slug: 'manawa',          name: 'Manawa (via Bridgify)',          categories: ['EXPERIENCE'] },
];

const ensureSupplier = async ({ slug, name, categories }) => {
  await query(
    `INSERT INTO hub_suppliers (supplier_slug, name, categories, auth_type)
     VALUES ($1, $2, $3, 'BRIDGIFY_DB')
     ON CONFLICT (supplier_slug) DO NOTHING`,
    [slug, name, categories]
  );
};

const main = async () => {
  log('seed_start', { count: SUPPLIERS.length });
  for (const s of SUPPLIERS) {
    await ensureSupplier(s);
    log('seed_supplier', { slug: s.slug });
  }

  const { rows } = await query(
    `SELECT supplier_slug, auth_type FROM hub_suppliers
      WHERE supplier_slug = ANY($1::varchar[])
      ORDER BY supplier_slug`,
    [SUPPLIERS.map((s) => s.slug)]
  );
  for (const r of rows) log('seed_verified', r);

  log('seed_complete', { rows: rows.length });
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((e) => {
    log('seed_failed', { error: e.message });
    process.exit(1);
  });
