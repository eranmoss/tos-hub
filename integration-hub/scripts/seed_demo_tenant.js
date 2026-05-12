import bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { query, closePool } from '../src/db/client.js';

const TENANT_ID = process.argv[2] || 'demo';
const API_KEY = process.argv[3] || `demo-${randomBytes(8).toString('hex')}`;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin-dev-key';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || 'internal-dev-token';

const main = async () => {
  const hash = await bcrypt.hash(API_KEY, 8);

  await query(
    `INSERT INTO hub_tenants(tenant_id, name, tier, api_key_hash, rate_limit_rpm)
     VALUES ($1, $2, 'GROWTH', $3, 120)
     ON CONFLICT (tenant_id) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, rate_limit_rpm = EXCLUDED.rate_limit_rpm`,
    [TENANT_ID, `Demo ${TENANT_ID}`, hash]
  );

  const webhookSecret = `wh-${randomBytes(8).toString('hex')}`;
  const whHash = createHash('sha256').update(webhookSecret).digest('hex');
  await query(
    `INSERT INTO hub_webhooks(tenant_id, event_type, endpoint_url, secret_hash, is_active)
     VALUES ($1, 'booking.confirmed', 'https://example.com/hook', $2, true)
     ON CONFLICT DO NOTHING`,
    [TENANT_ID, whHash]
  );

  console.log('\n=== SEED COMPLETE ===');
  console.log(`TENANT_ID      = ${TENANT_ID}`);
  console.log(`API_KEY        = ${API_KEY}`);
  console.log(`WEBHOOK_SECRET = ${webhookSecret}`);
  console.log(`ADMIN_KEY      = ${ADMIN_KEY}   (export ADMIN_KEY in server env to match)`);
  console.log(`INTERNAL_TOKEN = ${INTERNAL_TOKEN} (export INTERNAL_TOKEN in server env to match)`);
  console.log('\nRun smoke test:');
  console.log(`  TENANT_ID=${TENANT_ID} API_KEY=${API_KEY} WEBHOOK_SECRET=${webhookSecret} node scripts/smoke_test.js\n`);

  await closePool();
};

main().catch(e => { console.error(e); process.exit(1); });
