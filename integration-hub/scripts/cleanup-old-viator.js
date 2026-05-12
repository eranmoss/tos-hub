#!/usr/bin/env node
// Removes the old 'viator' supplier (Bridgify-sourced) now that 'viator-direct' exists.
// Safe to run multiple times (idempotent).

import { query } from '../src/db/client.js';

const OLD_SLUG = 'viator';

async function main() {
  console.log('=== Cleanup old viator supplier ===\n');

  // 1. Check current state
  const inv = await query(
    `SELECT is_active, count(*)::int as cnt FROM hub_static_inventory WHERE supplier_slug=$1 GROUP BY is_active`,
    [OLD_SLUG]
  );
  console.log('Current inventory:', inv.rows);

  // 2. Soft-delete all inventory records
  const deactivated = await query(
    `UPDATE hub_static_inventory SET is_active = false, updated_at = now() WHERE supplier_slug=$1 AND is_active = true RETURNING id`,
    [OLD_SLUG]
  );
  console.log(`Deactivated ${deactivated.rowCount} inventory records`);

  // 3. Remove tenant-supplier link
  const tenantLink = await query(
    `DELETE FROM hub_tenant_suppliers WHERE supplier_slug=$1 RETURNING id`,
    [OLD_SLUG]
  );
  console.log(`Removed ${tenantLink.rowCount} tenant-supplier link(s)`);

  // 4. Remove credentials
  const creds = await query(
    `DELETE FROM hub_credentials_map WHERE supplier_slug=$1 RETURNING id`,
    [OLD_SLUG]
  );
  console.log(`Removed ${creds.rowCount} credential mapping(s)`);

  // 5. Deactivate the supplier record (keep for audit trail)
  const supplier = await query(
    `UPDATE hub_suppliers SET is_active = false WHERE supplier_slug=$1 AND is_active = true RETURNING supplier_slug`,
    [OLD_SLUG]
  );
  console.log(`Deactivated supplier: ${supplier.rowCount > 0 ? 'yes' : 'already inactive'}`);

  // 6. Summary
  const remaining = await query(
    `SELECT supplier_slug, is_active, count(*)::int as cnt FROM hub_static_inventory WHERE supplier_slug IN ($1, 'viator-direct') GROUP BY supplier_slug, is_active ORDER BY supplier_slug`,
    [OLD_SLUG]
  );
  console.log('\nFinal state:');
  console.table(remaining.rows);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
