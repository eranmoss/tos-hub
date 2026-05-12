-- Gold dataset for dedup engine precision/recall/F1 evaluation

CREATE TABLE IF NOT EXISTS hub_dedup_gold_pairs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_a            UUID NOT NULL REFERENCES hub_static_inventory(id),
  id_b            UUID NOT NULL REFERENCES hub_static_inventory(id),
  band            VARCHAR NOT NULL CHECK (band IN ('high_dup','medium_dup','borderline','near_miss','clear_distinct')),
  emb_sim         FLOAT,
  fuzzy_sim       FLOAT,
  label           VARCHAR CHECK (label IN ('DUPLICATE','DISTINCT')),
  label_source    VARCHAR CHECK (label_source IN ('llm','human','engine')),
  label_reason    TEXT,
  labeled_at      TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(id_a, id_b)
);

CREATE TABLE IF NOT EXISTS hub_dedup_eval_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_snapshot JSONB NOT NULL,
  total_pairs     INTEGER NOT NULL,
  true_positives  INTEGER NOT NULL DEFAULT 0,
  false_positives INTEGER NOT NULL DEFAULT 0,
  true_negatives  INTEGER NOT NULL DEFAULT 0,
  false_negatives INTEGER NOT NULL DEFAULT 0,
  precision_val   FLOAT,
  recall_val      FLOAT,
  f1_val          FLOAT,
  per_band        JSONB DEFAULT '{}',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
