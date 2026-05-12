import 'dotenv/config';
import { query, closePool } from '../src/db/client.js';

const TENANT_ID = process.argv[2] || 't_demo';

const run = async () => {
  await query(
    `INSERT INTO hub_tenants (tenant_id, name, tier, email, api_key_hash, api_key_preview)
     VALUES ($1, 'Demo Co', 'GROWTH', 'eranm@bridgify.io', 'stub', '****demo')
     ON CONFLICT (tenant_id) DO UPDATE SET email = EXCLUDED.email`,
    [TENANT_ID]
  );

  await query(
    `INSERT INTO hub_suppliers (supplier_slug, name, categories, base_url_sandbox, auth_type, rate_limit_rpm, response_format)
     VALUES ('hotelbeds-hotels', 'HotelBeds Hotels', ARRAY['HOTEL'],
       'https://api.test.hotelbeds.com', 'HMAC_SHA256', 500, 'JSON')
     ON CONFLICT (supplier_slug) DO NOTHING`
  );

  await query(
    `INSERT INTO hub_suppliers (supplier_slug, name, categories, base_url_sandbox, auth_type, rate_limit_rpm, response_format)
     VALUES ('hotelbeds-transfers', 'HotelBeds Transfers', ARRAY['TRANSFER'],
       'https://api.test.hotelbeds.com', 'HMAC_SHA256', 500, 'JSON')
     ON CONFLICT (supplier_slug) DO NOTHING`
  );

  for (const slug of ['hotelbeds-hotels', 'hotelbeds-transfers']) {
    await query(
      `INSERT INTO hub_tenant_suppliers (tenant_id, supplier_slug, sla_tier, is_active)
       VALUES ($1, $2, 'ENTERPRISE', true)
       ON CONFLICT (tenant_id, supplier_slug) DO UPDATE SET is_active = true`,
      [TENANT_ID, slug]
    );
  }

  console.log(JSON.stringify({ ok: true, tenant_id: TENANT_ID, seeded: ['hotelbeds-hotels', 'hotelbeds-transfers'] }));
  await closePool();
};

run().catch((e) => { console.error(e); process.exit(1); });
