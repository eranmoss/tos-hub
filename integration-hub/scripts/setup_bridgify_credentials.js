// 1. Ensures MASTER_KEY is in .env (generates one if missing).
// 2. Stores Bridgify credentials (from BRIDGIFY_CLIENT_ID/SECRET env vars) encrypted into hub_credentials_map.
// 3. Confirms decryption round-trip.
//
// Run: node scripts/setup_bridgify_credentials.js <tenant_id>
//      (defaults to 't_demo' if omitted)

import 'dotenv/config';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../src/db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../.env');

const log = (event, extra = {}) => console.log(JSON.stringify({ event, ...extra }));

const ensureMasterKey = () => {
  if (process.env.MASTER_KEY) { log('master_key_present'); return; }
  const key = randomBytes(32).toString('hex');
  const prefix = existsSync(ENV_PATH) && !readFileSync(ENV_PATH, 'utf8').endsWith('\n') ? '\n' : '';
  appendFileSync(ENV_PATH, `${prefix}MASTER_KEY=${key}\n`);
  process.env.MASTER_KEY = key;
  log('master_key_generated_and_written_to_env');
};

const main = async () => {
  const tenantId = process.argv[2] || 't_demo';
  ensureMasterKey();

  const clientId = process.env.BRIDGIFY_CLIENT_ID;
  const clientSecret = process.env.BRIDGIFY_SECRET || process.env.BRIDGIFY_CLIENT_SECRET;
  const baseUrl = process.env.BRIDGIFY_BASE_URL || 'https://api.dev.bridgify.io';
  if (!clientId || !clientSecret) {
    log('missing_bridgify_creds', {
      need_env: ['BRIDGIFY_CLIENT_ID', 'BRIDGIFY_SECRET (or BRIDGIFY_CLIENT_SECRET)'],
    });
    throw new Error('Set BRIDGIFY_CLIENT_ID and BRIDGIFY_SECRET in integration_hub/.env');
  }

  const { setSecret, getSecret } = await import('../src/infra/secrets.js');
  await setSecret(tenantId, 'bridgify', {
    client_id: clientId,
    client_secret: clientSecret,
    base_url: baseUrl,
  });
  log('credentials_stored', { tenantId, slug: 'bridgify', base_url: baseUrl });

  const readback = await getSecret(tenantId, 'bridgify');
  log('readback_ok', {
    has_client_id: !!readback?.client_id,
    has_client_secret: !!readback?.client_secret,
    base_url: readback?.base_url,
  });
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((e) => { log('failed', { error: e.message }); process.exit(1); });
