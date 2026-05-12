import 'dotenv/config';
import readline from 'readline';
import { query, closePool } from '../src/db/client.js';
import { getSecret } from '../src/infra/secrets.js';
import { syncBridgifyExperiences } from '../src/sync/bridgify-experiences.js';
import { syncHotelbedsHotels } from '../src/sync/hotelbeds-hotels.js';
import { syncHotelbedsExperiences } from '../src/sync/hotelbeds-experiences.js';
import { syncHotelbedsTransfers } from '../src/sync/hotelbeds-transfers.js';
import { precomputeDedupForAllTenants } from '../src/sync/dedup-precompute.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const SUPPLIERS = [
  {
    key: 'bridgify',
    slug: 'bridgify',
    label: 'Bridgify Experiences',
    run: (c) => syncBridgifyExperiences({ clientId: c.client_id, clientSecret: c.client_secret, baseUrl: c.base_url }),
  },
  {
    key: 'hotelbeds-hotels',
    slug: 'hotelbeds-hotels',
    label: 'HotelBeds Hotels',
    run: (c) => syncHotelbedsHotels({ apiKey: c.api_key, secretKey: c.secret_key || c.secret, env: c.env || 'sandbox' }),
  },
  {
    key: 'hotelbeds-activities',
    slug: 'hotelbeds-activities',
    label: 'HotelBeds Activities',
    run: (c) => syncHotelbedsExperiences({ apiKey: c.api_key, secretKey: c.secret_key || c.secret, env: c.env || 'sandbox' }),
  },
  {
    key: 'hotelbeds-transfers',
    slug: 'hotelbeds-transfers',
    label: 'HotelBeds Transfers',
    run: (c) => syncHotelbedsTransfers({ apiKey: c.api_key, secretKey: c.secret_key || c.secret, env: c.env || 'sandbox' }),
  },
];

// Use the first tenant configured for a supplier as the credential source.
const firstTenantFor = async (slug) => {
  const r = await query(
    `SELECT tenant_id FROM hub_tenant_suppliers
     WHERE supplier_slug = $1 AND is_active = true LIMIT 1`,
    [slug]
  );
  return r.rows[0]?.tenant_id || null;
};

const runOne = async (supplier) => {
  const tenant = await firstTenantFor(supplier.slug);
  if (!tenant) { log('warn', 'sync_no_tenant', { supplier: supplier.slug }); return; }
  const creds = await getSecret(tenant, supplier.slug);
  if (!creds) { log('warn', 'sync_no_credentials', { supplier: supplier.slug, tenant }); return; }
  log('info', 'sync_start', { supplier: supplier.slug, tenant });
  try {
    const res = await supplier.run(creds);
    log('info', 'sync_ok', { supplier: supplier.slug, ...res });
  } catch (e) {
    log('error', 'sync_err', { supplier: supplier.slug, error: e.message });
  }
};

const prompt = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });

const pickSuppliers = async () => {
  const rawArg = process.argv[2];

  // Explicit "all" runs everything non-interactively.
  if (rawArg === 'all') return SUPPLIERS;

  // Match arg against slug, key, or 1-based number.
  if (rawArg) {
    const byIdx = Number.parseInt(rawArg, 10);
    const picked =
      SUPPLIERS.find((s) => s.slug === rawArg || s.key === rawArg) ||
      (Number.isInteger(byIdx) && byIdx >= 1 && byIdx <= SUPPLIERS.length ? SUPPLIERS[byIdx - 1] : null);
    if (!picked) {
      console.log(`\nUnknown supplier: "${rawArg}"\n`);
      console.log('Valid choices:');
      SUPPLIERS.forEach((s, i) => console.log(`  ${i + 1}. ${s.slug.padEnd(22)} ${s.label}`));
      console.log('  all                      run every supplier\n');
      process.exit(1);
    }
    return [picked];
  }

  // Interactive picker.
  console.log('\nWhich supplier do you want to sync?\n');
  SUPPLIERS.forEach((s, i) => console.log(`  ${i + 1}. ${s.slug.padEnd(22)} ${s.label}`));
  console.log(`  ${SUPPLIERS.length + 1}. all                      run every supplier\n`);
  const ans = await prompt(`Enter 1-${SUPPLIERS.length + 1} (or slug): `);
  const byIdx = Number.parseInt(ans, 10);
  if (byIdx === SUPPLIERS.length + 1) return SUPPLIERS;
  const picked =
    SUPPLIERS.find((s) => s.slug === ans || s.key === ans) ||
    (Number.isInteger(byIdx) && byIdx >= 1 && byIdx <= SUPPLIERS.length ? SUPPLIERS[byIdx - 1] : null);
  if (!picked) {
    console.log(`\nInvalid selection: "${ans}"`);
    process.exit(1);
  }
  return [picked];
};

const main = async () => {
  const selected = await pickSuppliers();
  log('info', 'sync_plan', { suppliers: selected.map((s) => s.slug) });

  for (const supplier of selected) {
    await runOne(supplier);
  }

  // Only recompute dedup when we ran everything — single-supplier runs skip it.
  if (selected.length === SUPPLIERS.length) {
    log('info', 'dedup_precompute_start');
    const res = await precomputeDedupForAllTenants();
    log('info', 'dedup_precompute_all_done', { tenants: res.length });
  } else {
    log('info', 'dedup_precompute_skipped', { reason: 'single_supplier_run' });
  }
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((e) => { log('error', 'nightly_sync_failed', { error: e.message }); process.exit(1); });
