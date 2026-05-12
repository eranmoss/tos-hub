import 'dotenv/config';
import { getSecret } from './src/infra/secrets.js';
import { syncBridgifyExperiences } from './src/sync/bridgify-experiences.js';
import { syncHotelbedsHotels } from './src/sync/hotelbeds-hotels.js';
import { syncHotelbedsTransfers } from './src/sync/hotelbeds-transfers.js';
import { syncHotelbedsExperiences } from './src/sync/hotelbeds-experiences.js';
import { precomputeDedup } from './src/sync/dedup-precompute.js';

const TENANT = 't_demo';

const run = async () => {
  const supplier = process.argv[2];
  if (!supplier) {
    console.log('Usage: node run-sync.js <bridgify|hotelbeds-hotels|hotelbeds-transfers|hotelbeds-activities|dedup|all>');
    process.exit(1);
  }

  if (supplier === 'dedup') {
    console.log('Starting dedup precompute...');
    const start = Date.now();
    const result = await precomputeDedup();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nDedup DONE in ${elapsed}s:`, JSON.stringify(result));
    process.exit(0);
  }

  const runners = [];

  if (supplier === 'bridgify' || supplier === 'all') {
    const creds = await getSecret(TENANT, 'bridgify');
    if (!creds) { console.error('No bridgify creds'); process.exit(1); }
    runners.push({
      name: 'bridgify',
      fn: () => syncBridgifyExperiences({
        clientId: creds.client_id,
        clientSecret: creds.client_secret,
        baseUrl: creds.base_url || process.env.BRIDGIFY_BASE_URL || 'https://api.bridgify.io',
      }),
    });
  }

  if (supplier === 'hotelbeds-hotels' || supplier === 'all') {
    const creds = await getSecret(TENANT, 'hotelbeds-hotels');
    if (!creds) { console.error('No hotelbeds creds'); process.exit(1); }
    runners.push({
      name: 'hotelbeds-hotels',
      fn: () => syncHotelbedsHotels({
        apiKey: creds.api_key,
        secretKey: creds.secret_key || creds.secret,
        env: creds.env || 'sandbox',
      }),
    });
  }

  if (supplier === 'hotelbeds-transfers' || supplier === 'all') {
    const creds = await getSecret(TENANT, 'hotelbeds-transfers') || await getSecret(TENANT, 'hotelbeds-hotels');
    if (!creds) { console.error('No hotelbeds creds'); process.exit(1); }
    runners.push({
      name: 'hotelbeds-transfers',
      fn: () => syncHotelbedsTransfers({
        apiKey: creds.api_key,
        secretKey: creds.secret_key || creds.secret,
        env: creds.env || 'sandbox',
      }),
    });
  }

  if (supplier === 'hotelbeds-activities' || supplier === 'all') {
    const creds = await getSecret(TENANT, 'hotelbeds-activities') || await getSecret(TENANT, 'hotelbeds-hotels');
    if (!creds) { console.error('No hotelbeds creds'); process.exit(1); }
    runners.push({
      name: 'hotelbeds-activities',
      fn: () => syncHotelbedsExperiences({
        apiKey: creds.api_key,
        secretKey: creds.secret_key || creds.secret,
        env: creds.env || 'sandbox',
      }),
    });
  }

  for (const r of runners) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting sync: ${r.name}`);
    console.log('='.repeat(60));
    const start = Date.now();
    try {
      const result = await r.fn();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`\n${r.name} DONE in ${elapsed}s:`, JSON.stringify(result));
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`\n${r.name} FAILED after ${elapsed}s:`, e.message);
    }
  }

  process.exit(0);
};

run().catch(e => { console.error(e); process.exit(1); });
