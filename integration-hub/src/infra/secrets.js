import { query } from '../db/client.js';

const masterKey = () => {
  const k = process.env.MASTER_KEY;
  if (!k) throw new Error('MASTER_KEY env var is required for credential decryption');
  return k;
};

// Read tenant-scoped supplier credentials from hub_credentials_map.
// Returns the decrypted JSON object, or null if no row.
export const getSecret = async (tenantId, supplierSlug) => {
  if (!tenantId || !supplierSlug) {
    throw new Error('getSecret requires tenantId and supplierSlug');
  }
  const r = await query(
    `SELECT pgp_sym_decrypt(credentials_encrypted, $3)::text AS json
     FROM hub_credentials_map
     WHERE tenant_id = $1 AND supplier_slug = $2 AND credentials_encrypted IS NOT NULL`,
    [tenantId, supplierSlug, masterKey()]
  );
  if (!r.rows[0]) return null;
  try { return JSON.parse(r.rows[0].json); } catch { return null; }
};

export const setSecret = async (tenantId, supplierSlug, credentials) => {
  if (!tenantId || !supplierSlug) {
    throw new Error('setSecret requires tenantId and supplierSlug');
  }
  const json = JSON.stringify(credentials || {});
  await query(
    `INSERT INTO hub_credentials_map(tenant_id, supplier_slug, secret_path, credentials_encrypted, updated_at)
     VALUES ($1, $2, NULL, pgp_sym_encrypt($3, $4), now())
     ON CONFLICT (tenant_id, supplier_slug)
     DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, updated_at = now()`,
    [tenantId, supplierSlug, json, masterKey()]
  );
};

export const deleteSecret = async (tenantId, supplierSlug) => {
  await query(
    `DELETE FROM hub_credentials_map WHERE tenant_id = $1 AND supplier_slug = $2`,
    [tenantId, supplierSlug]
  );
};
