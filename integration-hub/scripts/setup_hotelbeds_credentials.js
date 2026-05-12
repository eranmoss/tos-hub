// Stores HotelBeds credentials (from HOTELBEDS_API_KEY + HOTELBEDS_SECRET env
// vars) encrypted into hub_credentials_map for all three HotelBeds slugs.
// Also ensures the hub_tenant_suppliers + hub_suppliers rows exist so sync
// workers can find the tenant.
//
// Run: node scripts/setup_hotelbeds_credentials.js <tenant_id>
//      (defaults to 't_demo' if omitted)

import 'dotenv/config';
import { query, closePool } from '../src/db/client.js';

const log = (event, extra = {}) => console.log(JSON.stringify({ event, ...extra }));

const SLUGS = [
  { slug: 'hotelbeds-hotels',     name: 'HotelBeds Hotels',     categories: ['HOTEL'] },
  { slug: 'hotelbeds-activities', name: 'HotelBeds Activities', categories: ['EXPERIENCE'] },
  { slug: 'hotelbeds-transfers',  name: 'HotelBeds Transfers',  categories: ['TRANSFER'] },
];

const main = async () => {
  if (!process.env.MASTER_KEY) throw new Error('MASTER_KEY missing in .env');
  const apiKey = process.env.HOTELBEDS_API_KEY;
  const secretKey = process.env.HOTELBEDS_SECRET || process.env.HOTELBEDS_SECRET_KEY;
  const env = process.env.HOTELBEDS_ENV || 'sandbox';
  if (!apiKey || !secretKey) {
    throw new Error('Set HOTELBEDS_API_KEY and HOTELBEDS_SECRET in integration_hub/.env');
  }

  const tenantId = process.argv[2] || 't_demo';
  const { setSecret, getSecret } = await import('../src/infra/secrets.js');

  for (const { slug, name, categories } of SLUGS) {
    // Ensure parent supplier row exists (so FK to hub_tenant_suppliers is satisfied).
    await query(
      `INSERT INTO hub_suppliers(supplier_slug, name, categories, auth_type, rate_limit_rpm, response_format, supports_webhooks)
       VALUES ($1,$2,$3,'HMAC_SHA256',500,'JSON',false)
       ON CONFLICT (supplier_slug) DO UPDATE SET
         name = EXCLUDED.name,
         categories = EXCLUDED.categories`,
      [slug, name, categories]
    );

    // Ensure tenant integration row exists + active.
    await query(
      `INSERT INTO hub_tenant_suppliers(tenant_id, supplier_slug, sla_tier, preferred_for_cats, is_active)
       VALUES ($1,$2,'ENTERPRISE',$3,true)
       ON CONFLICT (tenant_id, supplier_slug) DO UPDATE SET is_active = true`,
      [tenantId, slug, categories]
    );

    await setSecret(tenantId, slug, { api_key: apiKey, secret_key: secretKey, env });
    const readback = await getSecret(tenantId, slug);
    log('stored', {
      tenantId, slug,
      has_api_key: !!readback?.api_key,
      has_secret_key: !!readback?.secret_key,
      env: readback?.env,
    });
  }
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((e) => { log('failed', { error: e.message }); process.exit(1); });
