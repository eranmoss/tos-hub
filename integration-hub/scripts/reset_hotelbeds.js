// Wipes every DB row that references any HotelBeds slug across every tenant
// so you can re-onboard cleanly via the UI. Does NOT touch .env.
//
// Run: node scripts/reset_hotelbeds.js

import 'dotenv/config';
import { query, closePool } from '../src/db/client.js';

const SLUGS = ['hotelbeds-hotels', 'hotelbeds-activities', 'hotelbeds-transfers'];

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ event, ...extra }));

const wipe = async (table, column = 'supplier_slug') => {
  const r = await query(
    `DELETE FROM ${table} WHERE ${column} = ANY($1::text[])`,
    [SLUGS]
  );
  log('wiped', { table, rows: r.rowCount });
};

const main = async () => {
  // Children first (FK order)
  await wipe('hub_transactions');
  await wipe('hub_static_inventory');
  await wipe('hub_schema_mappings');
  await wipe('hub_integration_tests');
  await wipe('hub_vendor_knowledge');
  await wipe('hub_knowledge_events');
  await wipe('hub_credentials_map');
  await wipe('hub_tenant_suppliers');

  // Onboarding sessions (slug is inside manifest_json)
  const sess = await query(
    `DELETE FROM hub_onboarding_sessions
     WHERE manifest_json->'supplier'->>'slug' = ANY($1::text[])`,
    [SLUGS]
  );
  log('wiped', { table: 'hub_onboarding_sessions', rows: sess.rowCount });

  // Parent last
  await wipe('hub_suppliers');

  // Verify nothing HotelBeds-related remains
  for (const t of [
    'hub_suppliers','hub_tenant_suppliers','hub_schema_mappings',
    'hub_static_inventory','hub_vendor_knowledge','hub_integration_tests',
    'hub_credentials_map','hub_knowledge_events','hub_transactions',
  ]) {
    const r = await query(
      `SELECT COUNT(*)::int AS n FROM ${t} WHERE supplier_slug = ANY($1::text[])`,
      [SLUGS]
    );
    log('remaining', { table: t, n: r.rows[0].n });
  }
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((e) => { log('failed', { error: e.message }); process.exit(1); });
