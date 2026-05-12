const { Client } = require('pg')

const client = new Client({
  host: 'tos-postgres.ck3waqua68d9.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'tos',
  user: 'tos_admin',
  password: process.env.RDS_PASSWORD,  // aws secretsmanager get-secret-value --secret-id tos/rds/master
  ssl: { rejectUnauthorized: false },
})

const migration = `
-- 1. integration_vendors
CREATE TABLE IF NOT EXISTS integration_vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  slug            VARCHAR(50)  NOT NULL UNIQUE,
  vertical        VARCHAR(20)  NOT NULL,
  endpoint_url    TEXT         NOT NULL,
  auth_type       VARCHAR(20)  NOT NULL,
  secret_arn      TEXT         NOT NULL,
  docs_url        TEXT,
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
  schema_coverage JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_vendors_vertical ON integration_vendors(vertical);
CREATE INDEX IF NOT EXISTS idx_integration_vendors_status   ON integration_vendors(status);

-- 2. integration_adapters
CREATE TABLE IF NOT EXISTS integration_adapters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID    NOT NULL REFERENCES integration_vendors(id),
  version          INT     NOT NULL DEFAULT 1,
  param_mappings   JSONB   NOT NULL,
  response_path    TEXT    NOT NULL,
  field_mappings   JSONB   NOT NULL,
  transform_config JSONB,
  is_active        BOOLEAN NOT NULL DEFAULT FALSE,
  validated_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_adapters_vendor ON integration_adapters(vendor_id);
CREATE INDEX IF NOT EXISTS idx_integration_adapters_active ON integration_adapters(vendor_id, is_active);

-- 3. integration_jobs
CREATE TABLE IF NOT EXISTS integration_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID        NOT NULL REFERENCES integration_vendors(id),
  triggered_by     VARCHAR(20) NOT NULL,
  triggered_by_ref TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'running',
  log              TEXT,
  error_detail     TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_jobs_vendor ON integration_jobs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_integration_jobs_status ON integration_jobs(status);
`

async function run() {
  try {
    await client.connect()
    console.log('Connected to RDS')
    await client.query(migration)
    console.log('Migration complete - 3 tables created')

    // Verify
    const res = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'integration_%'
      ORDER BY table_name
    `)
    console.log('Tables:', res.rows.map(r => r.table_name).join(', '))
  } catch (err) {
    console.error('Migration failed:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
