-- TOS Integration Hub — initial schema (16 tables)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS hub_tenants (
  tenant_id        VARCHAR PRIMARY KEY,
  name             VARCHAR NOT NULL,
  tier             VARCHAR NOT NULL CHECK (tier IN ('ENTERPRISE','GROWTH','STARTER')),
  rate_limit_rpm   INTEGER DEFAULT 60,
  schema_profile   VARCHAR DEFAULT 'standard',
  api_key_hash     VARCHAR NOT NULL,
  default_cancellation_policy VARCHAR DEFAULT 'NON_REFUNDABLE',
  dedup_strategy   VARCHAR DEFAULT 'LOWEST_PRICE',
  preferred_supplier VARCHAR,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_credentials_map (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  supplier_slug    VARCHAR NOT NULL,
  secret_path      VARCHAR NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_transactions (
  txn_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  supplier_slug    VARCHAR NOT NULL,
  operation        VARCHAR NOT NULL,
  status           VARCHAR NOT NULL,
  latency_ms       INTEGER,
  source           VARCHAR DEFAULT 'LIVE',
  request_hash     VARCHAR,
  response_hash    VARCHAR,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_schema_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug    VARCHAR NOT NULL,
  field_source     VARCHAR NOT NULL,
  field_target     VARCHAR NOT NULL,
  transform_fn     VARCHAR,
  version          VARCHAR DEFAULT '1.0',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_dedup_config (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  config_json      JSONB NOT NULL,
  label            VARCHAR,
  is_active        BOOLEAN DEFAULT true,
  test_mode        BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_dedup_test_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL,
  session_id       UUID,
  option_id_a      UUID NOT NULL,
  option_id_b      UUID NOT NULL,
  signal_location  FLOAT,
  signal_name      FLOAT,
  signal_duration  FLOAT,
  signal_category  FLOAT,
  composite_score  FLOAT NOT NULL,
  decision         VARCHAR NOT NULL,
  strategy_applied VARCHAR,
  agent_reasoning  TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_prompts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key          VARCHAR UNIQUE NOT NULL,
  category            VARCHAR NOT NULL CHECK (category IN ('INVENTORY','INTEGRATION','PRICING','POLICY')),
  trigger_condition   VARCHAR NOT NULL,
  prompt_template     TEXT NOT NULL,
  escalate_to_human   BOOLEAN DEFAULT false,
  response_schema     JSONB,
  is_active           BOOLEAN DEFAULT true,
  version             VARCHAR DEFAULT '1.0',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_escalations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID,
  tenant_id        VARCHAR NOT NULL,
  prompt_key       VARCHAR NOT NULL,
  trigger_data     JSONB NOT NULL,
  status           VARCHAR DEFAULT 'PENDING' CHECK (status IN ('PENDING','RESOLVED','EXPIRED')),
  resolution       JSONB,
  resolved_by      VARCHAR,
  resolved_at      TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL,
  task_type        VARCHAR NOT NULL,
  status           VARCHAR DEFAULT 'IN_PROGRESS',
  checkpoint       JSONB,
  result           JSONB,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_webhooks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  event_type       VARCHAR NOT NULL,
  endpoint_url     VARCHAR NOT NULL,
  secret_hash      VARCHAR NOT NULL,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hotel_content (
  hotel_code       VARCHAR PRIMARY KEY,
  supplier_slug    VARCHAR NOT NULL,
  name             VARCHAR,
  description      TEXT,
  star_rating      FLOAT,
  latitude         FLOAT,
  longitude        FLOAT,
  country_code     VARCHAR,
  city             VARCHAR,
  timezone         VARCHAR,
  image_urls       TEXT[],
  cached_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_suppliers (
  supplier_slug      VARCHAR PRIMARY KEY,
  name               VARCHAR NOT NULL,
  categories         VARCHAR[] NOT NULL,
  base_url_sandbox   VARCHAR,
  base_url_prod      VARCHAR,
  documentation_url  VARCHAR,
  support_contact    VARCHAR,
  auth_type          VARCHAR NOT NULL,
  rate_limit_rpm     INTEGER DEFAULT 60,
  response_format    VARCHAR DEFAULT 'JSON',
  supports_webhooks  BOOLEAN DEFAULT false,
  is_active          BOOLEAN DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_tenant_suppliers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  supplier_slug      VARCHAR NOT NULL REFERENCES hub_suppliers(supplier_slug),
  sla_tier           VARCHAR NOT NULL,
  preferred_for_cats VARCHAR[],
  is_active          BOOLEAN DEFAULT true,
  activated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_onboarding_sessions (
  session_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          VARCHAR NOT NULL,
  path               VARCHAR NOT NULL CHECK (path IN ('API','PROMPT')),
  status             VARCHAR DEFAULT 'IN_PROGRESS'
                     CHECK (status IN ('IN_PROGRESS','VALIDATED','PROMOTED','FAILED','EXPIRED')),
  manifest_json      JSONB,
  docs_fetched_url   VARCHAR,
  docs_content_hash  VARCHAR,
  validation_report  JSONB,
  retry_count        INTEGER DEFAULT 0,
  promoted_at        TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ DEFAULT now() + INTERVAL '72 hours',
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_integration_tests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug      VARCHAR NOT NULL REFERENCES hub_suppliers(supplier_slug),
  tenant_id          VARCHAR NOT NULL,
  search_params      JSONB NOT NULL,
  expected_min_count INTEGER DEFAULT 1,
  test_booking_ref   VARCHAR,
  last_run_at        TIMESTAMPTZ,
  last_run_status    VARCHAR,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_tool_contracts (
  contract_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name        VARCHAR UNIQUE NOT NULL,
  version          VARCHAR NOT NULL DEFAULT '1.0.0',
  input_schema     JSONB NOT NULL,
  output_schema    JSONB NOT NULL,
  auth_scope       VARCHAR[] NOT NULL,
  rate_limit_rpm   INTEGER,
  executor         VARCHAR NOT NULL CHECK (executor IN ('sync_lambda','managed_agent','bridgify_direct')),
  sla_ms           INTEGER,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);
