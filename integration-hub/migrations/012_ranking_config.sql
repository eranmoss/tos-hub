-- Ranking engine configuration per tenant
CREATE TABLE IF NOT EXISTS hub_ranking_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  config_json   JSONB NOT NULL,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_config_active
  ON hub_ranking_config (tenant_id) WHERE is_active = true;
