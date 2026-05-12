import 'dotenv/config';
import { existsSync, renameSync, copyFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../src/db/client.js';
import { syncBridgifyExperiences } from '../src/sync/bridgify-experiences.js';
import { getSecret } from '../src/infra/secrets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDORS = path.resolve(__dirname, '../config/vendors');

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ event, ...extra }));

const renameIfExists = (from, to) => {
  const src = path.join(VENDORS, from);
  const dst = path.join(VENDORS, to);
  if (existsSync(src)) { renameSync(src, dst); log('renamed', { from, to }); }
};

const copyIfExists = (from, to) => {
  const src = path.join(VENDORS, from);
  const dst = path.join(VENDORS, to);
  if (existsSync(src)) { copyFileSync(src, dst); log('copied', { from, to }); }
};

const main = async () => {
  // 1. Rename leftover slug files.
  renameIfExists('bridgify-attraction-api.md', 'bridgify.md');
  renameIfExists('bridgify-attraction-api.json', 'bridgify.json');
  renameIfExists('bridgify-attraction-api.handwritten.md', 'bridgify.handwritten.md');
  renameIfExists('bridgify-attraction-api.handwritten.json', 'bridgify.handwritten.json');
  renameIfExists('bridgify-attraction-api.pending.md', 'bridgify.pending.md');
  renameIfExists('bridgify-attraction-api.pending.json', 'bridgify.pending.json');

  // 2. Restore hand-written as canonical.
  copyIfExists('bridgify.handwritten.md', 'bridgify.md');
  copyIfExists('bridgify.handwritten.json', 'bridgify.json');

  // 3. Protect the DB row so LLM re-generations go to pending_update only.
  const upd = await query(
    `UPDATE hub_vendor_knowledge
        SET generated_by = 'human', updated_at = now()
      WHERE supplier_slug = 'bridgify'
     RETURNING supplier_slug, generated_by, version`,
  );
  log('knowledge_protected', { rows: upd.rowCount, row: upd.rows[0] || null });

  // 4. Run Bridgify inventory sync.
  const tenantRow = (await query(
    `SELECT tenant_id FROM hub_tenant_suppliers
     WHERE supplier_slug = 'bridgify' AND is_active = true LIMIT 1`
  )).rows[0];
  if (!tenantRow) {
    log('sync_skipped', { reason: 'no active tenant for bridgify' });
    return;
  }
  const creds = await getSecret(tenantRow.tenant_id, 'bridgify');
  if (!creds?.client_id || !creds?.client_secret) {
    log('sync_skipped', { reason: 'no credentials in secrets for bridgify',
      tenant_id: tenantRow.tenant_id });
    return;
  }
  try {
    const res = await syncBridgifyExperiences({
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
      baseUrl: creds.base_url,
    });
    log('sync_ok', res);
  } catch (e) {
    log('sync_err', { error: e.message });
  }

  // 5. Show inventory count.
  const cnt = (await query(
    `SELECT COUNT(*)::int AS n FROM hub_static_inventory WHERE supplier_slug = 'bridgify'`
  )).rows[0].n;
  log('inventory_count', { supplier: 'bridgify', count: cnt });
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((e) => { log('failed', { error: e.message, stack: e.stack }); process.exit(1); });
