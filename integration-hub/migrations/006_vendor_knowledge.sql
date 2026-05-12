-- Vendor knowledge system (Phase 2)
-- Three layers:
--   hub_category_knowledge   — cross-vendor patterns per CTS type (HOTEL, EXPERIENCE, TRANSFER…)
--   hub_vendor_knowledge     — per-supplier accumulated knowledge (auth quirks, response shape, gotchas)
--   hub_knowledge_events     — observations that may update knowledge (normalize fail, sync error, etc.)

CREATE TABLE IF NOT EXISTS hub_category_knowledge (
  category        VARCHAR PRIMARY KEY,
  knowledge_md    TEXT NOT NULL,
  knowledge_json  JSONB NOT NULL DEFAULT '{}',
  version         INTEGER NOT NULL DEFAULT 1,
  source_vendors  TEXT[] DEFAULT '{}',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_vendor_knowledge (
  supplier_slug   VARCHAR PRIMARY KEY,
  category        VARCHAR NOT NULL,
  knowledge_md    TEXT NOT NULL,
  knowledge_json  JSONB NOT NULL DEFAULT '{}',
  pending_update  JSONB,
  version         INTEGER NOT NULL DEFAULT 1,
  generated_by    VARCHAR NOT NULL DEFAULT 'llm',
  generated_at    TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hub_vendor_knowledge_category ON hub_vendor_knowledge(category);

CREATE TABLE IF NOT EXISTS hub_knowledge_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug   VARCHAR NOT NULL,
  tenant_id       VARCHAR,
  event_type      VARCHAR NOT NULL,         -- normalize_fail | sync_error | integration_complete | manual
  payload         JSONB NOT NULL DEFAULT '{}',
  proposed_update JSONB,
  status          VARCHAR NOT NULL DEFAULT 'PENDING', -- PENDING | APPLIED | DISMISSED | FAILED
  applied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hub_knowledge_events_slug ON hub_knowledge_events(supplier_slug, status);
CREATE INDEX IF NOT EXISTS idx_hub_knowledge_events_status ON hub_knowledge_events(status);
