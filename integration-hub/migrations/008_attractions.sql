-- Attraction/POI clustering: group experiences under real-world landmarks
-- discovered automatically from inventory title frequency + geo proximity.

CREATE TABLE IF NOT EXISTS hub_attractions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR NOT NULL,
  display_name     VARCHAR NOT NULL,
  city             VARCHAR NOT NULL,
  country          VARCHAR,
  latitude         FLOAT,
  longitude        FLOAT,
  category         VARCHAR,
  experience_count INTEGER DEFAULT 0,
  image_url        TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, city)
);

CREATE INDEX IF NOT EXISTS idx_attractions_city
  ON hub_attractions (city);

CREATE INDEX IF NOT EXISTS idx_attractions_geo
  ON hub_attractions (latitude, longitude);

ALTER TABLE hub_static_inventory
  ADD COLUMN IF NOT EXISTS attraction_id UUID REFERENCES hub_attractions(id);

CREATE INDEX IF NOT EXISTS idx_static_inventory_attraction
  ON hub_static_inventory (attraction_id) WHERE attraction_id IS NOT NULL;
