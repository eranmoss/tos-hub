-- Per-tenant supplier credentials encrypted at rest.
-- One env var (MASTER_KEY) decrypts everything; pg_dump carries the rest.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE hub_credentials_map
  ADD COLUMN IF NOT EXISTS credentials_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ALTER COLUMN secret_path DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hub_credentials_map_tenant_supplier_idx
  ON hub_credentials_map (tenant_id, supplier_slug);
