-- Dashboard auth + agent schema (partner-dashboard Phase 1)

-- Extend hub_tenants with email + api_key_preview (rotate endpoint exposes only masked)
ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS email VARCHAR;
ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS api_key_preview VARCHAR;
ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS notification_email VARCHAR;
CREATE INDEX IF NOT EXISTS idx_hub_tenants_email ON hub_tenants(email);

-- Magic link tokens
CREATE TABLE IF NOT EXISTS hub_auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  VARCHAR NOT NULL UNIQUE,
  tenant_id   VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  used        BOOLEAN DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Saved prompts
CREATE TABLE IF NOT EXISTS hub_saved_prompts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  label        VARCHAR NOT NULL,
  prompt_text  TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Agent conversations
CREATE TABLE IF NOT EXISTS hub_agent_conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  messages     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hub_agent_conversations_tenant
  ON hub_agent_conversations(tenant_id, updated_at DESC);

-- Error message on transactions (for row-expand view)
ALTER TABLE hub_transactions ADD COLUMN IF NOT EXISTS error_message TEXT;
