# TOS Intelligence Pipeline — Technical Documentation

> Full documentation of the deduplication, attraction clustering, evaluation,
> and gold dataset benchmarking systems in the WanderVault Integration Hub.

---

## Table of Contents

1. [Pipeline Overview](#1-pipeline-overview)
2. [Embedding Generation](#2-embedding-generation)
3. [Deduplication Engine](#3-deduplication-engine)
4. [Attraction Clustering](#4-attraction-clustering)
5. [Evaluation Dashboard](#5-evaluation-dashboard)
6. [Gold Dataset Benchmark](#6-gold-dataset-benchmark)
7. [Ranking Engine](#7-ranking-engine)
8. [Job Tracking](#8-job-tracking)
9. [Database Schema](#9-database-schema)
10. [Configuration](#10-configuration)

---

## 1. Pipeline Overview

The intelligence pipeline transforms raw supplier inventory into a
deduplicated, clustered, scored catalog. It runs as a series of
background jobs triggered from the partner dashboard.

### Execution Order

```
┌─────────────────────────────────────────────────────────────┐
│                   INGESTION LAYER                           │
│                                                             │
│  1. Supplier Sync    → raw records into hub_static_inventory│
│  2. Enrich Activities→ backfill descriptions/images from    │
│                        Hotelbeds Content API                │
│  3. Build Embeddings → MiniLM-L6 vectors for every record  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   DEDUP LAYER                               │
│                                                             │
│  4. Dedup Precompute → rule-based duplicate detection       │
│  5. LLM Judge        → Claude resolves uncertain pairs      │
│  6. Geo Review       → Claude validates geo-distant pairs   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   CLUSTERING LAYER                          │
│                                                             │
│  7. Attraction Cluster → group experiences by landmark      │
│  8. Attraction Validate→ LLM validates cluster quality      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   QUALITY LAYER                             │
│                                                             │
│  9. Eval Dashboard    → live stats, scorecard, coverage     │
│ 10. Gold Dataset      → P/R/F1 benchmark for dedup engine   │
│ 11. Ranking Engine    → multi-signal scoring at query time  │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/sync/build-embeddings.js` | Sentence embedding generation |
| `src/sync/enrich-activities.js` | Hotelbeds content enrichment |
| `src/sync/dedup-precompute.js` | Core dedup engine (3 phases) |
| `src/sync/attraction-cluster.js` | Attraction clustering + validation |
| `src/dedup/config.js` | Dedup config loading + merge |
| `src/dedup/gold-dataset.js` | Gold dataset sampling, labeling, eval |
| `src/catalog/ranker.js` | Multi-signal ranking engine |
| `src/jobs/tracker.js` | Job lifecycle tracking |
| `src/dashboard/routes.js` | API endpoints for all operations |

### Trigger Points

All pipeline steps are triggered via the partner dashboard Intelligence
page or directly through API endpoints. There is no automatic scheduler
in Phase 1 — all runs are manual.

| Dashboard Section | Button | Endpoint | Job Type |
|-------------------|--------|----------|----------|
| Dedup | Run Dedup | POST `/v1/dashboard/dedup/run` | `dedup` |
| Dedup | LLM Judge | POST `/v1/dashboard/dedup/llm-judge` | `llm_judge` |
| Dedup | Geo Review | POST `/v1/dashboard/dedup/geo-review` | `geo_review` |
| Dedup | Build Embeddings | POST `/v1/dashboard/embeddings/run` | `embeddings` |
| Dedup | Enrich Descriptions | POST `/v1/dashboard/enrich/activities` | `enrich` |
| Attractions | Cluster Attractions | POST `/v1/dashboard/attractions/cluster` | `attraction_cluster` |
| Attractions | Validate Attractions | POST `/v1/dashboard/attractions/validate` | `attraction_validate` |
| Eval | Sample Gold Pairs | POST `/v1/dashboard/gold-dataset/sample` | — (sync) |
| Eval | Label with LLM | POST `/v1/dashboard/gold-dataset/label` | `gold_label` |
| Eval | Run Eval | POST `/v1/dashboard/gold-dataset/eval` | — (sync) |

---

## 2. Embedding Generation

**File:** `src/sync/build-embeddings.js`
**Model:** `Xenova/all-MiniLM-L6-v2` (384-dimensional, local inference via Transformers.js)

### What It Does

Generates sentence embeddings for every record in `hub_static_inventory`
that doesn't already have one. These vectors power semantic similarity
in the dedup engine.

### Input Construction

Each record's embedding input is built by concatenating:

```
{title} | {city} | {country} | {category} | {route_origin} | {description (first 200 chars)}
```

Fields are joined with `|` delimiters. Missing fields are skipped.

### Processing

- **Batch size:** 50 records per batch
- **Model:** Mean pooling + L2 normalization
- **Storage:** JSON-stringified float array in `hub_static_inventory.embedding`
- **Idempotent:** Only processes records where `embedding IS NULL`

### When to Run

- After any supplier sync (new records lack embeddings)
- After enrichment (updated descriptions invalidate old embeddings —
  `enrich-activities.js` sets `embedding = NULL` on enriched records)

---

## 3. Deduplication Engine

**File:** `src/sync/dedup-precompute.js`

The dedup engine identifies duplicate experience listings across
suppliers and marks them with a shared `canonical_id`. It operates
in three distinct phases.

### Phase 1: Rule-Based Precompute

**Function:** `precomputeDedup(tenantId, {onProgress})`

#### Step 1 — Candidate Pair Finding

Groups records by city, then finds similar pairs within each city
using two strategies based on city size:

| City Size | Strategy | Complexity |
|-----------|----------|------------|
| ≤ 200 records | In-memory all-pairs cosine | O(n²) |
| > 200 records | pgvector IVFFlat KNN | O(n × k) |

For KNN: each record queries its 30 nearest neighbors using the
IVFFlat index with 16 probes. Pairs above the uncertainty threshold
(default 0.70) become candidates.

**Concurrency:**
- Large cities (100+ records): sequential (saturate all connections)
- Small cities: batched in groups of 4 (`CITY_CONCURRENCY`)
- KNN queries within a city: batched in groups of 10 (`KNN_CONCURRENCY`)

#### Step 2 — Decision Logic

For each candidate pair, the `decide()` function combines multiple signals:

```
┌─────────────────────────────────────────────────────┐
│                   decide(embSim, fuzzySim, a, b)    │
│                                                     │
│  1. Compute distinctness score (keyword conflicts)  │
│     → If distinctness ≥ 0.50 → DISTINCT (exit)     │
│                                                     │
│  2. rawSim = max(embSim, fuzzySim)                  │
│     effectiveSim = rawSim - distinctness             │
│                                                     │
│  3. Check price conflict (>50% delta → demote)      │
│  4. Check duration conflict (>50% delta → DISTINCT)  │
│  5. Apply category mismatch penalty (-0.05)          │
│                                                     │
│  6. Final thresholds:                               │
│     effectiveSim ≥ 0.85 → DUPLICATE                 │
│     effectiveSim ≥ 0.70 → UNCERTAIN                 │
│     effectiveSim <  0.70 → DISTINCT                  │
└─────────────────────────────────────────────────────┘
```

##### Distinctness Scoring

The engine extracts structured keywords from titles to detect
products that are linguistically similar but experientially different:

| Category | Example Keywords | Weight |
|----------|-----------------|--------|
| transport | bike, kayak, helicopter, segway, gondola | 0.40 |
| level | summit, rooftop, observation deck, all floors | 0.40 |
| format | workshop, cooking class, tasting, flamenco show | 0.35 |
| scope | combo, half-day, full-day, express | 0.30 |
| venue | museum, vineyard, rooftop, cave | 0.30 |
| meal | dinner, wine tasting, picnic, afternoon tea | 0.30 |
| addon | seine cruise, louvre, versailles, disneyland | 0.30 |
| time | sunset, sunrise, morning, evening, night | 0.25 |
| product | skip-the-line ticket, private tour, audio guide | 0.25 |
| group_size | private, small group, VIP, shared | 0.20 |

If both titles contain keywords in the same category but with
*different* values (e.g. "bike tour" vs "walking tour"), the
distinctness score increases by that category's weight.

**Asymmetric categories** (level, meal, addon, product, scope):
when only one title has keywords in these categories, a half-weight
penalty applies.

**Suffix divergence bonus:** if two titles share a common prefix
(≥2 words) but diverge in their tails with low similarity (<0.40),
an additional 0.25 penalty applies.

##### Override Rules

| Condition | Override |
|-----------|---------|
| Distinctness ≥ 0.50 | → DISTINCT (regardless of similarity) |
| Duration delta ≥ 50% | → DISTINCT (even above dup threshold) |
| Price delta ≥ 50% | DUPLICATE demoted to → UNCERTAIN |
| Category mismatch | Thresholds tightened by 0.05 |

##### Text Normalization

Before comparison, titles pass through `normalize()`:
- Lowercase
- Strip non-alphanumeric characters
- Remove 38 stop words: `tour`, `experience`, `visit`, `skip`, `the`,
  `a`, `an`, `in`, `of`, `and`, `with`, `from`, `for`, `to`, `by`,
  `at`, `on`, `or`, `line`, `access`, `priority`, `guided`, `private`,
  `group`, `day`, `half`, `full`, `ticket`, `trip`, `excursion`,
  `entry`, `admission`, `small`, `ride`, `pass`, `option`, `included`,
  `free`

Fuzzy matching uses Fuse.js on normalized text, returning a 0–1 score.

#### Step 3 — Clustering

DUPLICATE edges are sorted by score (highest first) and grouped into
clusters via greedy connected-component merging:

- Two unlinked records → new cluster
- One linked, one unlinked → add to existing cluster (if < max size)
- Both linked to different clusters → skip (no merge)

Maximum cluster size: 10 (configurable via `max_cluster_size`).

#### Step 4 — Canonical Selection

Within each cluster, the canonical record is selected by `pickCanonical()`:

1. **Prefer Bridgify** supplier (more detailed content)
2. **Content quality score:** description (+2), images (+1), duration (+1), coordinates (+1)
3. Highest score wins

Non-canonical records get `canonical_id` set to the canonical's ID.
At search time, only canonical records are returned.

### Phase 2: LLM Judge

**Function:** `llmJudgePass(tenantId)`

Processes pairs that Phase 1 classified as UNCERTAIN (embedding
similarity between 0.70 and 0.85 after all adjustments).

#### Flow

1. Query all canonical (unlinked) records with UNCERTAIN-range similarity
2. Sort by embedding similarity descending (hardest cases first)
3. Batch by 20, send to Claude Haiku with context:
   - Titles, suppliers, city, categories
   - Embedding and fuzzy similarity scores
4. Claude returns DUPLICATE or DISTINCT for each pair
5. For DUPLICATE decisions: check cluster size cap, then set `canonical_id`

#### LLM Budget

- Model: `claude-haiku-4-5-20251001`
- Input cost: $0.80/M tokens
- Output cost: $4.00/M tokens
- Budget: `DEDUP_LLM_BUDGET_USD` env var (default $3.00)
- When exhausted: remaining pairs default to DISTINCT

#### LLM Prompt Strategy

```
You are a travel product deduplication judge.
DUPLICATE = traveler buying both would do the same activity twice.
DISTINCT = different activities, even if related.
When in doubt, lean DISTINCT.
```

### Phase 3: Geo Review

**Function:** `llmGeoReview({onProgress})`

Post-processing pass that validates geographically distant pairs.

#### Flow

1. Find all pairs sharing a `canonical_id` where members are > 50km apart
2. Batch by 20, send to Claude with distance and context
3. Claude decides:
   - **KEEP_PAIRED** — legitimate (multi-day tour, large attraction area)
   - **SPLIT** — incorrectly grouped (same name, different cities)
4. On SPLIT: set `canonical_id = NULL` to unlink
5. Same budget tracking as LLM Judge

### Data Flow Summary

```
hub_static_inventory
  ├── embedding (from build-embeddings.js)
  ├── canonical_id = NULL (initial state)
  │
  │  Phase 1: precomputeDedup()
  │  ├── Sets canonical_id for DUPLICATE clusters
  │  └── Leaves UNCERTAIN pairs unlinked
  │
  │  Phase 2: llmJudgePass()
  │  ├── Resolves UNCERTAIN → DUPLICATE or DISTINCT
  │  └── Sets canonical_id for new duplicates
  │
  │  Phase 3: llmGeoReview()
  │  └── Clears canonical_id for geo-invalid pairs
  │
  └── Final state:
      canonical_id = own id → canonical record (shown in search)
      canonical_id = other id → duplicate (hidden in search)
      canonical_id = NULL → unclustered record (shown in search)
```

---

## 4. Attraction Clustering

**File:** `src/sync/attraction-cluster.js`

Attraction clustering groups experience listings that reference the
same real-world landmark or venue (e.g., all "Colosseum" tours under
one attraction entity).

### Phase 1: Clustering

**Function:** `clusterAttractions({onProgress})`

#### Pass 1 — Geographic Clustering

Uses a grid-based spatial index to find co-located records:

- **Cell size:** ~200m (0.0018 degrees)
- Each record checks a 3×3 grid of neighboring cells
- Records within 200m of an existing cluster join it
- Records farther away start a new cluster

This is O(n) with constant-factor neighbor checks.

#### Pass 2 — Phrase Extraction (per geo-cluster)

Within each geographic cluster, the engine extracts landmark phrases:

1. **Tokenize** each title (filter expanded stop word list of 60+ words)
2. **Generate n-grams** (1 to 4 words)
3. **Filter** phrases appearing in < 3 titles (`MIN_PHRASE_COUNT`)
4. **Filter** junk phrases via `FILTER_OUT` set (80+ terms like "all", "walk", "national", "fun")
5. **Rank** by word count (longer = more specific), then by frequency
6. **Greedy assignment**: best phrases first, each experience assigned to at most one phrase

#### Pass 3 — City-Wide Scan

Repeats phrase extraction for unassigned records across the entire city.
Catches venues where suppliers assign inconsistent or generic coordinates.

#### Upsert

For each phrase with ≥ 3 matching experiences:

```sql
INSERT INTO hub_attractions (name, display_name, city, country,
  latitude, longitude, category, experience_count, unique_product_count, image_url)
ON CONFLICT (name, city) DO UPDATE
```

- **display_name:** Proper-cased version of the phrase
- **latitude/longitude:** Centroid of member coordinates
- **category:** Most frequent category among members
- **experience_count:** Total linked records
- **unique_product_count:** `COUNT(DISTINCT supplier_slug || '::' || title)`
  — collapses event date slots into one product
- **image_url:** From highest-rated member

Member records get `attraction_id` set in `hub_static_inventory`.

### Phase 2: LLM Validation

**Function:** `validateAttractions(tenantId)`

Reviews attraction clusters for quality using Claude Haiku.

#### Flow

1. Fetch attractions with ≥ 3 experiences
2. Batch by 30, send sample titles + category + city to Claude
3. Claude classifies each as:
   - **VALID** — real landmark or venue
   - **QUESTIONABLE** — ambiguous, needs human review
   - **INVALID** — generic term incorrectly clustered
4. Actions:
   - INVALID → unlink all members, delete attraction
   - QUESTIONABLE → create escalation in `hub_escalations`
   - VALID → no action

#### Budget

- Model: Claude Haiku
- Budget: `ATTRACTION_LLM_BUDGET_USD` env var (default $2.00)

### Unique Product Count

Event-type suppliers (StubHub, LiveTickets) list each performance date
as a separate inventory record. A "Wizard of Oz" show with 600 dates
from 2 suppliers creates 1,200 records but only 2 unique products.

```
unique_product_count = COUNT(DISTINCT supplier_slug || '::' || title)
```

This metric appears in the Eval dashboard's "Largest Clusters" table
to distinguish genuine variety from date-slot inflation.

---

## 5. Evaluation Dashboard

**Frontend:** `partner-dashboard/src/components/EvalDashboard.jsx`
**API:** GET `/v1/dashboard/eval/stats`

### Quality Scorecard

Six metrics graded A–D based on configurable thresholds:

| Metric | Formula | A | B | C | D |
|--------|---------|---|---|---|---|
| Embedding Coverage | embeddings / total active | ≥95% | ≥80% | ≥50% | <50% |
| Dedup Category Match | same-cat pairs / all pairs | ≥80% | ≥60% | ≥40% | <40% |
| Price Tightness | 100 - median price spread % | ≥80% | ≥60% | ≥40% | <40% |
| Geo Tightness | 100 - (median_m / 100) | ≥90% | ≥70% | ≥50% | <50% |
| Attraction City Match | single-city / total clusters | ≥99% | ≥95% | ≥90% | <90% |
| Attraction Coverage | linked / total experiences | ≥50% | ≥20% | ≥5% | <5% |

### Sections

**Inventory Overview:**
- Total records (active vs soft-deleted)
- Supplier count, city count
- Embedding coverage percentage
- Per-field data coverage bars (rating, reviews, price, duration, description, images)

**Dedup Quality:**
- Cluster count, duplicates hidden
- Category match rate across dedup pairs
- Cross-supplier pair percentage
- Price spread within clusters (median, P90, avg)
- Geo spread within clusters (median, avg, P90, P99)
- Cluster size distribution histogram

**Attraction Clusters:**
- Total clusters, experiences linked, coverage %
- City consistency (% single-city clusters)
- Category consistency (avg categories per cluster)
- Size distribution histogram
- Top 10 largest clusters with unique product count

### Data Source

All stats are computed live from 13 parallel SQL queries against
`hub_static_inventory`, `hub_attractions`, and aggregations thereof.
No pre-computed cache — stats always reflect current data state.

---

## 6. Gold Dataset Benchmark

**Backend:** `src/dedup/gold-dataset.js`
**Frontend:** `partner-dashboard/src/components/GoldDatasetEval.jsx`

The gold dataset provides a ground-truth benchmark for measuring
dedup engine precision, recall, and F1.

### Step 1: Stratified Sampling

**Function:** `sampleGoldPairs()` — samples 200 pairs across 5 bands.

| Band | Similarity Range | % of Total | Target | Cross-Supplier |
|------|-----------------|------------|--------|----------------|
| high_dup | 0.90–1.00 | 20% | 40 pairs | Yes |
| medium_dup | 0.85–0.90 | 20% | 40 pairs | Yes |
| borderline | 0.70–0.85 | 25% | 50 pairs | Yes |
| near_miss | 0.60–0.70 | 20% | 40 pairs | Yes |
| clear_distinct | < 0.40 (cross-city) | 15% | 30 pairs | Yes |

Pairs are randomly selected within each band using `ORDER BY random()`.
All pairs are cross-supplier (different `supplier_slug` on each side).
Clear distinct pairs are additionally cross-city.

### Step 2: LLM Labeling

**Function:** `labelGoldPairs({onProgress})`

Each unlabeled pair is sent to Claude Haiku in batches of 10 with
full product context (titles, suppliers, categories, prices, durations,
city, embedding similarity).

The LLM prompt asks for ground-truth labels:

> DUPLICATE = a traveler buying both would do the same activity twice.
> DISTINCT = different activities, even if related.
> Be precise. This is a benchmark — errors compound.

Labels are stored with source (`llm`) and reason text.

### Step 3: Engine Evaluation

**Function:** `evalGoldDataset(thresholdOverrides)`

Replays the engine's `decide()` function on every labeled pair:

1. Load current dedup config (or use threshold overrides from UI sliders)
2. For each pair, compute:
   - Fuzzy similarity via `fuzzyScore(normalize(title_a), normalize(title_b))`
   - Run `decide(embSim, fuzzySim, a, b, thresholds)`
3. Compare engine decision to gold label:
   - Engine DUPLICATE + Label DUPLICATE → **True Positive**
   - Engine DUPLICATE + Label DISTINCT → **False Positive**
   - Engine DISTINCT + Label DISTINCT → **True Negative**
   - Engine DISTINCT + Label DUPLICATE → **False Negative**
4. Compute overall and per-band: Precision, Recall, F1
5. Save snapshot to `hub_dedup_eval_runs`

### Threshold Tuning

The UI provides two sliders:
- **Duplicate threshold** (0.60–0.95, default 0.85)
- **Uncertain threshold** (0.50–0.85, default 0.70)

Adjusting these and re-running eval shows how P/R/F1 change,
enabling parameter sweeps without modifying code.

### Eval Run History

Each eval run is persisted with its config snapshot, allowing
comparison across different threshold settings over time.

### Confusion Matrix Interpretation

| Outcome | Meaning | Business Impact |
|---------|---------|-----------------|
| True Positive | Engine correctly merged a duplicate | Good — reduces redundancy |
| False Positive | Engine merged two different products | Bad — hides unique product |
| True Negative | Engine correctly kept two distinct items | Good — preserves variety |
| False Negative | Engine missed a real duplicate | Minor — shows redundant result |

**Priority:** minimize False Positives (hiding unique products is
worse than showing a duplicate).

---

## 7. Ranking Engine

**File:** `src/catalog/ranker.js`

Scores and sorts search results using a weighted multi-signal model.
Applied at query time after dedup filtering.

### Scoring Signals

| Signal | Weight | Computation | Fallback |
|--------|--------|-------------|----------|
| Semantic relevance | 0.55 | From search/recommendation score (0–1) | 0 |
| Popularity | 0.15 | log(bookings + reviews + 1) / log(10000) | 0.30 |
| Rating | 0.10 | Bayesian: (rating/5)×conf + fallback×(1-conf) | 0.50 |
| Margin | 0.10 | min(1, commission_rate / 30) | 0.30 |
| Availability | 0.07 | Binary from availability map | 0.50 |
| Supplier priority | 0.03 | preferred=1.0, normal=0.5, deprioritized=0.0 | 0.50 |

**Rating confidence:** `min(1, review_count / 50)` — below 50 reviews,
rating regresses toward the fallback value.

### Data Reality

Current inventory has 0% coverage for `review_count` and no
`booking_count` or `commission_rate` columns. This means popularity
and margin signals use constant fallbacks with zero differentiation.
Effective ranking is driven by semantic (55%), rating (10%), and
availability (7%).

### Configuration

Weights and fallbacks are configurable per-tenant via the
Ranking Config Editor in the Intelligence page. Stored in
`hub_ranking_config` as JSONB.

---

## 8. Job Tracking

**File:** `src/jobs/tracker.js`

All pipeline operations run as tracked jobs with progress reporting,
cancellation support, and timeout safeguards.

### Job Lifecycle

```
RUNNING  →  COMPLETE  (success)
RUNNING  →  FAILED    (error)
RUNNING  →  CANCELLED (user-initiated)
```

### Key Function: `runTracked(jobType, slug, fn)`

Wraps any async function with job lifecycle:

1. Insert `hub_sync_jobs` record (status=RUNNING)
2. Pass `(jobId, progressCallback)` to the wrapped function
3. Progress callback updates `progress_pct` and `progress_detail`
4. On success: mark COMPLETE
5. On `JobCancelledError`: return `{cancelled: true}`
6. On error: mark FAILED with error message

### Timeout Safeguard

`completeJob` has a 15-second timeout via `Promise.race`. If the
DB connection hangs (known issue with `pool.end()`), a fallback
direct SQL update marks the job complete. This prevents jobs from
being stuck in RUNNING state indefinitely.

### Job Types

| Type | Description |
|------|-------------|
| `sync` | Supplier inventory sync |
| `dedup` | Dedup precompute (Phase 1) |
| `llm_judge` | LLM judge pass (Phase 2) |
| `geo_review` | Geo review pass (Phase 3) |
| `embeddings` | Embedding generation |
| `enrich` | Hotelbeds content enrichment |
| `attraction_cluster` | Attraction clustering |
| `attraction_validate` | Attraction validation |
| `gold_label` | Gold dataset LLM labeling |

### Dashboard Integration

The Jobs tab in the Intelligence page shows all jobs with:
- Status (RUNNING/COMPLETE/FAILED/CANCELLED)
- Progress percentage and detail
- Elapsed time
- Cancel button for running jobs
- Restart button for completed/failed jobs

---

## 9. Database Schema

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `hub_static_inventory` | All supplier records | `id`, `title`, `supplier_slug`, `city`, `category`, `embedding` (vector), `canonical_id` (dedup), `attraction_id` (clustering), `price_from`, `duration_minutes`, `is_active` |
| `hub_attractions` | Attraction clusters | `name`, `display_name`, `city`, `experience_count`, `unique_product_count`, `image_url` |
| `hub_dedup_config` | Per-tenant dedup configuration | `tenant_id`, `config_json` (JSONB), `is_active` |
| `hub_dedup_gold_pairs` | Gold dataset pairs | `id_a`, `id_b`, `band`, `emb_sim`, `label`, `label_source`, `label_reason` |
| `hub_dedup_eval_runs` | Eval run snapshots | `config_snapshot`, `precision_val`, `recall_val`, `f1_val`, `per_band` (JSONB) |
| `hub_ranking_config` | Per-tenant ranking weights | `tenant_id`, `config_json` (JSONB), `is_active` |
| `hub_sync_jobs` | Job tracking | `job_type`, `status`, `progress_pct`, `progress_detail`, `started_at`, `completed_at` |
| `hub_escalations` | Human review queue | `prompt_key`, `trigger_data`, `status`, `resolution` |

### Key Relationships

```
hub_static_inventory.canonical_id → hub_static_inventory.id  (dedup link)
hub_static_inventory.attraction_id → hub_attractions.id       (cluster link)
hub_dedup_gold_pairs.id_a → hub_static_inventory.id           (gold pair)
hub_dedup_gold_pairs.id_b → hub_static_inventory.id           (gold pair)
```

### Indexes

```sql
-- Embedding search (pgvector IVFFlat)
CREATE INDEX ON hub_static_inventory USING ivfflat (embedding vector_cosine_ops)
  WHERE is_active = true AND embedding IS NOT NULL;

-- Geographic search
CREATE INDEX idx_static_inventory_geo
  ON hub_static_inventory (latitude, longitude) WHERE is_active = true;

-- Dedup pair lookup
CREATE UNIQUE INDEX ON hub_dedup_gold_pairs (id_a, id_b);

-- Active config per tenant
CREATE UNIQUE INDEX idx_ranking_config_active
  ON hub_ranking_config (tenant_id) WHERE is_active = true;
```

---

## 10. Configuration

### Dedup Config

**File:** `config/dedup.default.json` (committed to repo)
**Override:** `hub_dedup_config` table per tenant

| Parameter | Default | Description |
|-----------|---------|-------------|
| `thresholds.embedding_duplicate` | 0.85 | Min effective similarity for DUPLICATE |
| `thresholds.embedding_uncertain` | 0.70 | Min effective similarity for UNCERTAIN |
| `thresholds.max_cluster_size` | 10 | Max records per dedup cluster |

### Environment Variables

| Variable | Default | Used By |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | — | LLM Judge, Geo Review, Gold Labeling, Attraction Validation |
| `DEDUP_LLM_BUDGET_USD` | 3.00 | LLM Judge, Geo Review budget cap |
| `ATTRACTION_LLM_BUDGET_USD` | 2.00 | Attraction Validation budget cap |
| `DATABASE_URL` | — | All database operations |

### LLM Cost Model

All LLM operations use Claude Haiku (`claude-haiku-4-5-20251001`):

| Operation | Typical Pairs | Est. Cost |
|-----------|--------------|-----------|
| LLM Judge (Phase 2) | ~500–2000 uncertain pairs | $0.50–$2.00 |
| Geo Review (Phase 3) | ~200–2000 distant pairs | $0.20–$1.50 |
| Gold Labeling | 200 pairs (one-time) | $0.10–$0.20 |
| Attraction Validation | ~1000–3000 clusters | $0.30–$1.00 |

Budget tracking is per-run (resets each invocation). When budget is
exhausted mid-run, remaining pairs default to the conservative choice
(DISTINCT for dedup, skip for validation).
