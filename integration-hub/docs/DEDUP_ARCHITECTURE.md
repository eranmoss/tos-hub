# Experience Dedup Architecture

## The Problem

Multiple suppliers sell the same real-world experience under different titles:

```
Bridgify:              "Barcelona: Sagrada Familia Skip-the-Line Entry Ticket & Tour"
HotelBeds Activities:  "Skip the Line Sagrada Familia Express - Fully Guided Tour"
Bridgify:              "Sagrada Familia Guided Tour with Skip the Line Ticket"
```

These are the same product. Showing all three wastes screen space, confuses
travelers, and makes price comparison impossible. Duplicates can exist
**across suppliers** and **within the same supplier**.

---

## Approach: OR-Gate Multi-Signal with Differentiator Veto + LLM Judge

Four layers working together:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DECISION PIPELINE                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Step 0: CITY GATE                                                  │
│  Different city → always DISTINCT (never compared)                  │
│                                                                     │
│  Step 1: DIFFERENTIATOR VETO  ← NEW                                │
│  Scan both titles for differentiator words.                         │
│  If same category but different words → DISTINCT (veto all rules)   │
│                                                                     │
│    "Gaudi Tour by Bike" vs "Gaudi Walking Tour"                     │
│    → transport: [bike] ≠ [walking] → VETOED → DISTINCT              │
│                                                                     │
│  Step 2: OR-GATE (any rule sufficient)                              │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────────┐      │
│  │ Fuzzy ≥ 0.90   │ │ Embed ≥ 0.85   │ │ Embed≥0.75 AND     │      │
│  │                 │ │ (0.90 if cat   │ │ Fuzzy≥0.55         │      │
│  │                 │ │  mismatch)     │ │ (mutual confirm)   │      │
│  └───────┬────────┘ └───────┬────────┘ └─────────┬──────────┘      │
│          └──────────────────┼────────────────────┘                  │
│                             ▼                                       │
│                     ANY fires → DUPLICATE                           │
│                                                                     │
│  Step 3: FALLBACK                                                   │
│  embed < 0.65 ────────────────────────────→ DISTINCT                │
│  0.65 ≤ embed < 0.85 (borderline) ────────→ LLM JUDGE              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Signal Details

### 0. Differentiator Veto (Keyword-Based)

A pool of **differentiator words** grouped by category. If both titles
contain words from the same category but they don't overlap, the pair
is DISTINCT — regardless of how similar the embeddings or fuzzy scores are.

```
┌──────────────────────────────────────────────────────────────────────┐
│                     DIFFERENTIATOR WORD POOL                         │
├────────────┬─────────────────────────────────────────────────────────┤
│ Category   │ Words                                                   │
├────────────┼─────────────────────────────────────────────────────────┤
│ Transport  │ bike, e-bike, segway, bus, boat, kayak, catamaran,     │
│            │ helicopter, walking, sailing, scooter, vespa, jet ski,  │
│            │ horseback, tuk-tuk, gondola, hot air balloon, cable car,│
│            │ ferry, yacht, raft, paddleboard, SUP                    │
├────────────┼─────────────────────────────────────────────────────────┤
│ Time       │ sunset, sunrise, morning, evening, night, daytime,     │
│            │ after dark, twilight, dawn                               │
├────────────┼─────────────────────────────────────────────────────────┤
│ Format     │ workshop, class, cooking, lesson, tasting, show,       │
│            │ concert, flamenco, performance, masterclass, demo       │
├────────────┼─────────────────────────────────────────────────────────┤
│ Scope      │ combo, highlights, express, comprehensive, full-day,   │
│            │ half-day, multi-day                                     │
├────────────┼─────────────────────────────────────────────────────────┤
│ Venue      │ museum, stadium, rooftop, underground, cave, vineyard, │
│            │ winery, brewery, market, bazaar                         │
└────────────┴─────────────────────────────────────────────────────────┘
```

**How it works:**

```
Title A: "Barcelona Gaudi Tour by Bike"
Title B: "Barcelona Gaudi Walking Tour"

Extract differentiators:
  A → transport: [bike]
  B → transport: [walking]

Same category, different words → VETOED → DISTINCT
(Even though embedding similarity = 0.89)
```

**What it catches that embeddings miss:**

| Pair | Embedding | Without Veto | With Veto |
|------|-----------|-------------|-----------|
| "Gaudi Tour by Bike" ↔ "Gaudi Walking Tour" | 0.89 | DUPLICATE ❌ | DISTINCT ✓ |
| "Sunset Catamaran" ↔ "Morning Catamaran" | 0.91 | DUPLICATE ❌ | DISTINCT ✓ |
| "Tapas Cooking Class" ↔ "Tapas Tasting Tour" | 0.87 | DUPLICATE ❌ | DISTINCT ✓ |
| "Half-Day City Tour" ↔ "Full-Day City Tour" | 0.93 | DUPLICATE ❌ | DISTINCT ✓ |

**What it correctly ignores** (no conflict → continues to OR-gate):

| Pair | Differentiators | Result |
|------|----------------|--------|
| "Sagrada Familia Tour" ↔ "Sagrada Familia Guided Tour" | no transport words in either | no veto |
| "Sunset Sailing Cruise" ↔ "Sunset Catamaran Cruise" | time: both [sunset] ✓ | no veto |
| "Walking Food Tour" ↔ "Walking Tapas Tour" | transport: both [walking] ✓ | no veto |

**Key design choice:** the veto only fires when BOTH titles have a word
in the SAME category but they DON'T overlap. If only one title mentions
a differentiator, no veto — "Sagrada Familia" vs "Sagrada Familia by Bike"
still goes through the OR-gate (and likely matches on embedding).

---

### 1. Embedding Similarity (Semantic)

- Model: **MiniLM-L6-v2** via `@xenova/transformers` (runs locally, zero API cost)
- 384-dimensional vectors, cosine similarity
- Input: raw title + city (`"Sagrada Familia Guided Tour | barcelona"`)
- Catches meaning: "Hop-On Hop-Off Bus" ≈ "City Tour Hop-On Hop-Off" (0.92)

### 2. Fuzzy Text Match (Lexical)

- Fuse.js on **normalized** titles (stopwords stripped: "tour", "ticket", etc.)
- Catches near-exact text: "Barcelona Tapas Tour" ≈ "Barcelona Old Town Tapas Tour" (0.91)
- Normalization only for fuzzy — embeddings use raw titles

### 3. LLM Judge (Borderline Cases)

- Model: **Claude Haiku** (cheapest, fastest)
- Only for pairs in the uncertain band (embedding 0.65-0.85, no other rule fired, no veto)
- Batched: 20 pairs per API call
- Prompt: "Would a traveler buying both do the same activity twice?"
- Fallback: on LLM error → DISTINCT (safe default)

### Why OR-Gate, Not Weighted Average?

Weighted average **penalizes** complementary signals:

| Pair | Embedding | Fuzzy | Weighted (0.6/0.2/0.2) |
|------|-----------|-------|------------------------|
| "Hop-On Hop-Off Bus Tour" ↔ "City Tour Hop-On Hop-Off" | 0.92 | 0.45 | 0.64 ❌ |
| "Barcelona Tapas Tour" ↔ "Old Town Tapas Walking Tour" | 0.71 | 0.91 | 0.61 ❌ |

Both are obvious duplicates. Both fail a 0.85 weighted threshold.
The OR-gate catches both: the first via embedding, the second via fuzzy.

---

## Clustering: Greedy with Coherence Check

After pairwise decisions, duplicates are grouped into clusters:

```
Edges (sorted by score descending):
  A ↔ B  (0.95)  →  Cluster 1: {A, B}
  B ↔ C  (0.91)  →  Check: is C similar to ALL of {A, B}?
                      cosine(C, A) = 0.88 ✓  cosine(C, B) = 0.91 ✓
                      → Cluster 1: {A, B, C}
  C ↔ D  (0.87)  →  Check: is D similar to ALL of {A, B, C}?
                      cosine(D, A) = 0.52 ✗  ← BLOCKED
                      → D stays independent
```

**Without coherence check**: A↔B↔C↔D chains transitively.
"Private Walking Tour" → "Hop-On Hop-Off" → "Hop-On + Camp Nou" → "Camp Nou"
all end up in one cluster. This actually happened in V1.

**With coherence check** (min 0.70 similarity to ALL members):
Each cluster stays tight. Max cluster size capped at 10.

---

## Full Decision Flow (Visual)

```
              ┌──────────┐
              │ Record A │
              │ Record B │
              │ same city│
              └────┬─────┘
                   │
          ┌────────▼────────┐
          │ DIFFERENTIATOR  │
          │ VETO            │     "bike" vs "walking"
          │                 ├───→ DISTINCT (skip all rules)
          │ conflict found? │
          └────────┬────────┘
                   │ no conflict
          ┌────────▼────────┐
          │ EMBED TITLES    │
          │ (MiniLM-L6)     │     local, ~0.3ms/title
          │ cosine(A, B)    │
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │ FUZZY SCORE     │
          │ (Fuse.js)       │     normalized titles
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │ OR-GATE RULES   │
          │                 │
          │ fuzzy ≥ 0.90 ──────→ DUPLICATE
          │ embed ≥ 0.85 ──────→ DUPLICATE
          │ emb≥.75+fuz≥.55 ──→ DUPLICATE
          │ embed < 0.65 ──────→ DISTINCT
          │                 │
          │ none fired:     │
          │ 0.65-0.85       ├───→ LLM JUDGE
          └─────────────────┘     (Claude Haiku, batched)
                                       │
                                  ┌────▼────┐
                                  │DUPLICATE│
                                  │   or    │
                                  │DISTINCT │
                                  └─────────┘
```

---

## Canonical Selection

One record per cluster becomes the canonical (shown to users). Others get
`canonical_id` set and are filtered from search results via
`WHERE canonical_id IS NULL`.

Priority order:
1. **Bridgify** supplier preferred (richer data, better descriptions)
2. If same supplier: highest data completeness score:
   - description: +2
   - images: +1
   - duration: +1
   - coordinates: +1

---

## Pipeline: Initial Setup vs Daily Updates

### Initial Setup (one-time)

```
┌─────────────────────────────────────────────────────────┐
│                    INITIAL FULL SYNC                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Sync all suppliers → hub_static_inventory           │
│     (Bridgify + HotelBeds Activities)                   │
│                                                         │
│  2. Load embedding model (MiniLM-L6, ~30MB)             │
│                                                         │
│  3. For each city:                                      │
│     a. Embed ALL titles (N titles → N vectors)          │
│     b. Differentiator veto on all pairs (instant)       │
│     c. Compare remaining pairs: embedding + fuzzy       │
│     d. OR-gate rules → DUPLICATE / DISTINCT / UNCERTAIN │
│     e. LLM judge on UNCERTAIN pairs (batched)           │
│     f. Greedy cluster with coherence check              │
│     g. Set canonical_id on non-canonical records        │
│                                                         │
│  Total time: ~5 min for 31K records                     │
│  Estimated for 100K: ~45 min                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Daily Incremental Update

```
┌─────────────────────────────────────────────────────────┐
│                 DAILY INCREMENTAL SYNC                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Sync suppliers (nightly) — upsert new/changed       │
│     records, soft-delete removed ones                   │
│                                                         │
│  2. Identify CHANGED records:                           │
│     WHERE updated_at > last_dedup_run                   │
│     OR created_at > last_dedup_run                      │
│                                                         │
│  3. For each affected city:                             │
│     a. Load existing embeddings from cache              │
│     b. Embed ONLY new/changed titles                    │
│     c. Differentiator veto (instant, no cost)           │
│     d. Compare new records against ALL city records     │
│        (not all-vs-all — just new-vs-existing)          │
│     e. Run OR-gate + LLM on new pairs only              │
│     f. Update clusters incrementally                    │
│                                                         │
│  Typical daily delta: 1-5% of inventory                 │
│  Estimated time: 2-5 min                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Key optimization**: cache embeddings in a new column (`embedding FLOAT[]`)
on `hub_static_inventory`. Recompute only for changed titles. This turns
daily dedup from O(N^2) to O(delta * N_city).

---

## Cost Estimates at 100K Scale

### Assumptions

| Parameter | Value |
|-----------|-------|
| Total attractions | 100,000 |
| Cities | ~600 |
| Avg records per city | ~167 |
| Largest cities | ~2,000 records |
| Daily new/changed records | 1-5% (~1,000-5,000) |
| Uncertain band rate | ~4% of eligible pairs (after veto removes ~15%) |

### Component Costs

| Component | Technology | Cost | Notes |
|-----------|-----------|------|-------|
| Embedding | MiniLM-L6 (local) | **$0** | Runs on CPU, no API |
| Pairwise comparison | Cosine + Fuse.js | **$0** | Pure compute |
| Differentiator veto | String matching | **$0** | Instant, pre-filters ~15% of pairs |
| LLM Judge | Claude Haiku | **$0.0001/pair** | Only borderline pairs |

### Embedding (MiniLM-L6 — local, zero API cost)

| Scenario | Records to Embed | Time Estimate |
|----------|-----------------|---------------|
| Initial full run | 100,000 | ~15 min |
| Daily incremental | 1,000-5,000 | ~1-2 min |

### Pairwise Comparisons (CPU — zero API cost)

| Scenario | Comparisons | Time Estimate |
|----------|-------------|---------------|
| Initial full run | ~8.4M (sum of N*(N-1)/2 per city) | ~30 min |
| Daily incremental | ~250K (delta * avg_city_size) | ~2 min |

### LLM Judge (Claude Haiku — API cost)

**Pricing**: Haiku input $0.80/MTok, output $4.00/MTok

Each batch prompt (20 pairs):
- Input: ~600 tokens (titles + instructions)
- Output: ~400 tokens (JSON decisions)
- Cost per batch: $0.00048 + $0.0016 = **$0.002**
- Cost per pair: **$0.0001**

**Impact of differentiator veto on LLM volume:**

| Without veto | With veto | Reduction |
|-------------|-----------|-----------|
| Barcelona: 5,037 uncertain | 4,261 uncertain | -15% |
| Est. 100K total: ~60,000 | ~42,000 | -30% (compounds across cities) |

| Scenario | Uncertain Pairs | LLM Batches | Cost |
|----------|----------------|-------------|------|
| Initial full run (all cities) | ~42,000 | 2,100 | **$4.20** |
| Daily incremental | ~400-1,500 | 20-75 | **$0.04-$0.15** |
| Monthly (30 days) | — | — | **$1.20-$4.50** |

### Total Cost Summary

| | Initial (one-time) | Daily | Monthly |
|-|-------------------|-------|---------|
| Embeddings | $0 | $0 | $0 |
| Comparisons | $0 | $0 | $0 |
| Differentiator veto | $0 | $0 | $0 |
| LLM Judge | $4.20 | $0.04-$0.15 | $1.20-$4.50 |
| Compute (t3.medium) | included | included | included |
| **Total** | **~$4** | **~$0.10** | **~$3/mo** |

### Cost Management Strategies

1. **Differentiator veto** (already active): eliminates ~15-30% of uncertain
   pairs before they reach the LLM. Zero cost, instant.

2. **Narrow the LLM band**: Tightening from 0.65-0.85 to 0.75-0.85 cuts
   uncertain pairs by ~60%. The 0.65-0.75 band is mostly DISTINCT anyway.

3. **Cache LLM decisions**: Store pair decisions in `hub_dedup_pairs`.
   If both titles unchanged since last run, skip LLM.

4. **Cap per city**: `_llm_max_pairs` config limits LLM calls per city.
   Process highest-confidence uncertain pairs first (sorted by embedding score).

5. **Skip small cities**: Cities with < 5 records rarely have duplicates
   worth LLM-judging. OR-gate rules handle the obvious ones.

---

## Configuration (Partner Dashboard)

All thresholds are tenant-configurable via the Intelligence screen:

| Setting | Default | Controls |
|---------|---------|----------|
| Embedding duplicate threshold | 0.85 | Min similarity for auto-DUPLICATE |
| Embedding uncertain threshold | 0.70 | Floor for LLM band |
| Max cluster size | 10 | Prevents mega-clusters |
| Strategy | LOWEST_PRICE | How to pick winner when duplicate found |
| Uncertain behavior | SHOW_BOTH | SHOW_BOTH / ESCALATE / AGENT_DECIDE |

Setting `uncertain_behavior` to `AGENT_DECIDE` activates the LLM judge.
`SHOW_BOTH` shows both products (no LLM cost). `ESCALATE` flags for
human review.

The differentiator word pool is defined in code (`DIFFERENTIATORS` in
`dedup-precompute.js`). It can be extended without changing thresholds
or retraining models.

---

## Current Results (31K inventory)

| Metric | Before Veto | After Veto | Delta |
|--------|-------------|------------|-------|
| Total records | 31,738 | 31,738 | — |
| Duplicates found | 11,471 (36.1%) | 11,206 (35.3%) | -265 false positives removed |
| Clusters | 5,534 | 5,477 | -57 |
| Unique after dedup | 20,267 | 20,532 | +265 products preserved |
| Uncertain pairs (Barcelona) | 5,037 | 4,261 | -776 (-15%) |
| Processing time | ~4.5 min | ~4.8 min | negligible |

---

## File Map

```
src/sync/dedup-precompute.js   — main engine (veto + OR-gate + LLM + clustering)
src/dedup/config.js            — config loader (default + tenant merge)
src/dedup/engine.js            — legacy V1 scoring (kept for reference)
src/search/pipeline.js         — Stage 1 query: WHERE canonical_id IS NULL
config/dedup.default.json      — default thresholds
test-dedup-embeddings.js       — offline test harness (12 hand-picked pairs)
docs/DEDUP_ARCHITECTURE.md     — this document
```
