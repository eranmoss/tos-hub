-- Layer 2.5: Static Inventory Cache + Offline Dedup + Sync Tracking
-- See integration-hub_PRD.md Section 3B.6

CREATE TABLE IF NOT EXISTS hub_static_inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug       VARCHAR NOT NULL REFERENCES hub_suppliers(supplier_slug),
  supplier_raw_ref    VARCHAR NOT NULL,
  type                VARCHAR NOT NULL,
  title               VARCHAR NOT NULL,
  description         TEXT,
  latitude            FLOAT,
  longitude           FLOAT,
  city                VARCHAR,
  country             VARCHAR,
  timezone            VARCHAR,
  category            VARCHAR,
  duration_minutes    INTEGER,
  vehicle_class       VARCHAR,
  star_rating         FLOAT,
  image_urls          TEXT[],
  amenities           TEXT[],
  meal_plans          TEXT[],
  route_origin        VARCHAR,
  route_destination   VARCHAR,
  raw_content         JSONB,
  is_active           BOOLEAN DEFAULT true,
  last_synced_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(supplier_slug, supplier_raw_ref)
);

CREATE INDEX IF NOT EXISTS idx_static_inventory_geo
  ON hub_static_inventory (latitude, longitude) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_static_inventory_supplier_type
  ON hub_static_inventory (supplier_slug, type) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_static_inventory_category
  ON hub_static_inventory (category) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS hub_dedup_pairs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  inventory_id_a      UUID NOT NULL REFERENCES hub_static_inventory(id),
  inventory_id_b      UUID NOT NULL REFERENCES hub_static_inventory(id),
  composite_score     FLOAT NOT NULL,
  decision            VARCHAR NOT NULL,
  signal_location     FLOAT,
  signal_name         FLOAT,
  signal_duration     FLOAT,
  signal_category     FLOAT,
  computed_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, inventory_id_a, inventory_id_b)
);

CREATE INDEX IF NOT EXISTS idx_dedup_pairs_tenant_a
  ON hub_dedup_pairs (tenant_id, inventory_id_a);

CREATE TABLE IF NOT EXISTS hub_sync_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug       VARCHAR NOT NULL,
  status              VARCHAR DEFAULT 'RUNNING'
                      CHECK (status IN ('RUNNING','COMPLETE','FAILED')),
  records_fetched     INTEGER DEFAULT 0,
  records_upserted    INTEGER DEFAULT 0,
  records_deactivated INTEGER DEFAULT 0,
  records_errored     INTEGER DEFAULT 0,
  started_at          TIMESTAMPTZ DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  error_message       TEXT
);

CREATE TABLE IF NOT EXISTS hub_sync_errors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id         UUID NOT NULL REFERENCES hub_sync_jobs(id),
  supplier_raw_ref    VARCHAR,
  error_message       TEXT NOT NULL,
  raw_record          JSONB,
  created_at          TIMESTAMPTZ DEFAULT now()
);
