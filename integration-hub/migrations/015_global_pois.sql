-- Global POI registry: canonical attractions that all suppliers map into.
-- "One Eiffel Tower" — every supplier's version maps to a single canonical entry.

-- Layer 1: Canonical attractions (supplier-agnostic)
CREATE TABLE IF NOT EXISTS hub_global_pois (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR NOT NULL,
  display_name        VARCHAR,
  city                VARCHAR NOT NULL,
  country             VARCHAR,
  latitude            FLOAT NOT NULL,
  longitude           FLOAT NOT NULL,
  category_id         VARCHAR,
  description         TEXT,
  image_url           TEXT,
  experience_count    INTEGER DEFAULT 0,
  source              VARCHAR DEFAULT 'auto',
  confidence          FLOAT DEFAULT 1.0,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, city)
);

CREATE INDEX IF NOT EXISTS idx_global_pois_geo
  ON hub_global_pois (latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_global_pois_city
  ON hub_global_pois (city);

-- Layer 2: Supplier-specific attraction → global POI mapping
CREATE TABLE IF NOT EXISTS hub_supplier_pois (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug       VARCHAR NOT NULL,
  supplier_poi_ref    VARCHAR NOT NULL,
  supplier_poi_name   VARCHAR,
  global_poi_id       UUID REFERENCES hub_global_pois(id),
  match_confidence    FLOAT,
  match_method        VARCHAR,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(supplier_slug, supplier_poi_ref)
);

CREATE INDEX IF NOT EXISTS idx_supplier_pois_global
  ON hub_supplier_pois (global_poi_id) WHERE global_poi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_pois_supplier
  ON hub_supplier_pois (supplier_slug);

-- Canonical category taxonomy (all suppliers map into this)
CREATE TABLE IF NOT EXISTS hub_canonical_categories (
  id          VARCHAR PRIMARY KEY,
  display     VARCHAR NOT NULL,
  parent_id   VARCHAR REFERENCES hub_canonical_categories(id),
  level       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Per-supplier category → canonical mapping
CREATE TABLE IF NOT EXISTS hub_category_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug     VARCHAR NOT NULL,
  supplier_cat_id   VARCHAR NOT NULL,
  supplier_cat_name VARCHAR,
  canonical_cat_id  VARCHAR NOT NULL REFERENCES hub_canonical_categories(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(supplier_slug, supplier_cat_id)
);

-- Link inventory records to global POIs
ALTER TABLE hub_static_inventory
  ADD COLUMN IF NOT EXISTS global_poi_id UUID REFERENCES hub_global_pois(id);

CREATE INDEX IF NOT EXISTS idx_static_inventory_global_poi
  ON hub_static_inventory (global_poi_id) WHERE global_poi_id IS NOT NULL;
