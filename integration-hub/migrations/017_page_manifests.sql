-- Phase 4: Travel Shell Runtime
-- Page manifests for TravelShellRenderer + component registry

CREATE TABLE hub_page_manifests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT        NOT NULL REFERENCES hub_tenants(tenant_id) ON DELETE CASCADE,
  slug         TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  manifest     JSONB       NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_hub_page_manifests_tenant ON hub_page_manifests (tenant_id);
CREATE INDEX idx_hub_page_manifests_active  ON hub_page_manifests (tenant_id, is_active);

CREATE TABLE hub_component_registry (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL UNIQUE,
  category            TEXT        NOT NULL,
  description         TEXT,
  schema              JSONB       NOT NULL DEFAULT '{}',
  datasource_bindings JSONB,
  thumbnail_url       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: all Phase 2/3 Web Components
INSERT INTO hub_component_registry (name, category, description, schema, datasource_bindings) VALUES
  ('tos-header',               'layout',      'Sticky navigation header with logo and nav links', '{"attrs":[]}', NULL),
  ('tos-footer',               'layout',      'Site footer with navigation columns',              '{"attrs":[]}', NULL),
  ('tos-hero',                 'layout',      'Full-width hero banner with search input',         '{"attrs":["headline","subheading","bg-image"]}', NULL),
  ('tos-section-title',        'layout',      'Section heading with optional view-all link',      '{"attrs":["title","view-all-href"]}', NULL),
  ('tos-search-bar',           'search',      'Query + destination + type search bar',            '{"attrs":["type","query","destination"]}', NULL),
  ('tos-search-results',       'search',      'Search results grid from catalog API',             '{"attrs":["type","query","limit"]}', '{"api":"/v1/catalog/search"}'),
  ('tos-hotel-card',           'hotels',      'Hotel product card',                               '{"attrs":["product-id"]}', '{"api":"/v1/catalog/:id"}'),
  ('tos-hotel-carousel',       'hotels',      'Horizontal scrolling hotel carousel',              '{"attrs":["city","limit"]}', '{"api":"/v1/catalog/browse"}'),
  ('tos-hotel-detail',         'hotels',      'Full hotel detail view with booking panel',        '{"attrs":["product-id"]}', '{"api":"/v1/catalog/:id"}'),
  ('tos-experience-card',      'experiences', 'Experience product card with category badge',      '{"attrs":["product-id"]}', '{"api":"/v1/catalog/:id"}'),
  ('tos-experience-carousel',  'experiences', 'Horizontal scrolling experience carousel',        '{"attrs":["city","limit"]}', '{"api":"/v1/catalog/browse"}'),
  ('tos-experience-detail',    'experiences', 'Full experience detail view with booking panel',   '{"attrs":["product-id"]}', '{"api":"/v1/catalog/:id"}'),
  ('tos-poi-card',             'pois',        'Point of interest compact card',                   '{"attrs":["product-id"]}', '{"api":"/v1/catalog/pois"}'),
  ('tos-poi-grid',             'pois',        '2x4 responsive POI grid',                          '{"attrs":["city","limit"]}', '{"api":"/v1/catalog/pois"}'),
  ('tos-booking-form',         'booking',     'Guest details form and booking submission',        '{"attrs":["product-id"]}', '{"api":"/v1/catalog/:id/book"}'),
  ('tos-booking-confirmation', 'booking',     'Booking confirmation with reference display',      '{"attrs":["booking-ref","product-title"]}', NULL),
  ('tos-agent-chat',           'agent',       'Consumer travel assistant chat widget',             '{"attrs":["destination","product-title","current-page","position"]}', NULL)
ON CONFLICT (name) DO UPDATE SET
  category            = EXCLUDED.category,
  description         = EXCLUDED.description,
  schema              = EXCLUDED.schema,
  datasource_bindings = EXCLUDED.datasource_bindings;
