// Store per-tenant supplier credentials in DB (encrypted with MASTER_KEY).
//
// Usage:
//   MASTER_KEY=... DATABASE_URL=... node scripts/set_credentials.js \
//     <tenant_id> <supplier_slug> '<json_credentials>'
//
// Example:
//   node scripts/set_credentials.js demo hotelbeds-hotels \
//     '{"api_key":"abc","secret_key":"xyz","env":"sandbox"}'

import { setSecret } from '../src/infra/secrets.js';
import { closePool } from '../src/db/client.js';

const [tenantId, supplierSlug, credsJson] = process.argv.slice(2);

if (!tenantId || !supplierSlug || !credsJson) {
  console.error('Usage: node scripts/set_credentials.js <tenant_id> <supplier_slug> <json>');
  process.exit(1);
}

let creds;
try { creds = JSON.parse(credsJson); }
catch (e) { console.error(`Invalid JSON: ${e.message}`); process.exit(1); }

(async () => {
  await setSecret(tenantId, supplierSlug, creds);
  console.log(`Stored credentials for tenant=${tenantId} supplier=${supplierSlug} fields=[${Object.keys(creds).join(', ')}]`);
  await closePool();
})().catch(e => { console.error(e); process.exit(1); });
