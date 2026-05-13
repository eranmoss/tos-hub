-- Generic vendor code translation table.
-- Maps vendor-specific numeric/string codes to human-readable labels.
-- Works across all suppliers: HotelBeds facilities, Viator categories, Duffel cabin classes, etc.

CREATE TABLE IF NOT EXISTS hub_vendor_codes (
  id              SERIAL PRIMARY KEY,
  supplier_slug   VARCHAR NOT NULL,
  code_type       VARCHAR NOT NULL,        -- e.g. 'facility', 'facility_group', 'board', 'category', 'room_type'
  code            VARCHAR NOT NULL,        -- the vendor's raw code value
  group_code      VARCHAR,                 -- optional parent/group code (e.g. facilityGroupCode for HotelBeds)
  label           VARCHAR NOT NULL,        -- human-readable name in English
  description     TEXT,                    -- optional longer description
  metadata        JSONB,                   -- any extra vendor-specific fields
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(supplier_slug, code_type, code, group_code)
);

CREATE INDEX IF NOT EXISTS idx_vendor_codes_lookup
  ON hub_vendor_codes (supplier_slug, code_type, code);

CREATE INDEX IF NOT EXISTS idx_vendor_codes_group
  ON hub_vendor_codes (supplier_slug, code_type, group_code);
