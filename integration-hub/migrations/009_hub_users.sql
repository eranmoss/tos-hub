-- 009: User-tenant model — users belong to tenants

CREATE TABLE hub_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR NOT NULL,
  name        VARCHAR,
  tenant_id   VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  role        VARCHAR NOT NULL DEFAULT 'admin'
              CHECK (role IN ('admin', 'viewer')),
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(email, tenant_id)
);

CREATE INDEX idx_hub_users_email ON hub_users (LOWER(email));
CREATE INDEX idx_hub_users_tenant ON hub_users (tenant_id);

-- Seed users from existing tenant emails
INSERT INTO hub_users (email, name, tenant_id, role)
SELECT email, name, tenant_id, 'admin'
FROM hub_tenants
WHERE email IS NOT NULL;

-- Link auth tokens to users
ALTER TABLE hub_auth_tokens ADD COLUMN user_id UUID REFERENCES hub_users(id);
