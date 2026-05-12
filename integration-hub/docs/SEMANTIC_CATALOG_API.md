# TOS Semantic Catalog API — Design Document
## Version 1.0 | April 2026

---

## 1. What This Is

A single, natural-language search endpoint that serves deduplicated travel
inventory (experiences, hotels, transfers) using pgvector semantic similarity.

Instead of rigid filters like `category=FOOD&city=Barcelona`, the UI sends
plain English queries:

```
"top 10 attractions in Barcelona"
"romantic beachfront hotel in Cancun"
"walking food tours Rome"
"airport transfer Heathrow to central London"
```

The API understands intent, matches against stored embeddings, and returns
ranked results — no query parsing, no filter construction on the frontend.

---

## 2. Architecture

```
┌──────────────┐     ┌──────────────────────────────┐
│   UI / TOS   │     │   Integration Hub             │
│   Component  │────▶│   GET /v1/catalog/search      │
│              │     │       ?q=...&limit=10         │
└──────────────┘     │       &type=EXPERIENCE        │
                     │       &date_from=2026-05-01   │
                     │                               │
                     │   1. Embed query (MiniLM)     │
                     │   2. pgvector cosine search   │
                     │   3. Apply structured filters │
                     │   4. Return ranked results    │
                     └──────────────────────────────┘
```

### Flow

1. **Embed** — the query string is embedded using the same MiniLM-L6-v2
   model that built the inventory embeddings (384 dimensions)
2. **Search** — pgvector `<=>` cosine distance finds the nearest matches
   in `hub_static_inventory` where `canonical_id IS NULL` (deduplicated)
3. **Filter** — structured params (type, dates, guests) narrow results
4. **Return** — CTS-shaped results ranked by semantic similarity

---

## 3. API Surface

### 3.1 Semantic Search

```
GET /v1/catalog/search
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| q | string | Yes | Natural language query |
| type | string | No | EXPERIENCE, HOTEL, TRANSFER (default: all) |
| limit | int | No | Max results (default: 20, max: 100) |
| page | int | No | Pagination (default: 1) |
| date_from | date | No | Availability start (YYYY-MM-DD) |
| date_to | date | No | Availability end (YYYY-MM-DD) |
| guests | int | No | Number of guests/passengers |
| rooms | int | No | Number of rooms (HOTEL only) |
| city | string | No | Hard filter — restrict to this city |
| min_score | float | No | Minimum similarity (default: 0.30) |

**Response:**
```json
{
  "results": [
    {
      "id": "uuid",
      "type": "EXPERIENCE",
      "title": "Gothic Quarter Walking Tour",
      "description": "...",
      "city": "Barcelona",
      "country": "Spain",
      "category": "CULTURE",
      "duration_minutes": 120,
      "supplier_slug": "bridgify",
      "latitude": 41.385,
      "longitude": 2.173,
      "image_urls": ["..."],
      "star_rating": null,
      "score": 0.87
    }
  ],
  "total": 42,
  "page": 1,
  "pages": 3,
  "limit": 20,
  "query_embedding_ms": 45,
  "search_ms": 12
}
```

### 3.2 Item Detail

```
GET /v1/catalog/:id
```

Returns full record including `raw_content` for supplier-specific data.
No embedding needed — direct ID lookup.

### 3.3 City List

```
GET /v1/catalog/cities
```

Returns all cities with record counts. Used for filter dropdowns.
No embedding needed.

### 3.4 Category List

```
GET /v1/catalog/categories?type=EXPERIENCE
```

Returns distinct categories for a given type. Used for filter chips.

---

## 4. Embedding Strategy

### 4.1 What Gets Embedded

**Inventory records** (at sync time):
```
{title} | {city} | {category} | {description first 200 chars}
```

**Search queries** (at query time):
```
{raw query text}
```

Both use the same model (MiniLM-L6-v2, 384 dimensions) so they share
the same vector space.

### 4.2 Why This Works

MiniLM maps semantically similar text to nearby vectors:
- "walking food tour Rome" → near "Roman Street Food Walking Experience"
- "luxury beach hotel Cancun" → near "Beachfront 5-Star Resort Cancun"
- "top attractions Barcelona" → near "Sagrada Familia Guided Tour"

The model understands synonyms, related concepts, and intent without
explicit keyword matching.

### 4.3 Model Loading

The MiniLM model (~23MB) loads once at server startup and stays in memory.
First query takes ~2s (model init), subsequent queries take ~40-50ms
for embedding.

```js
// Loaded once at startup
let embedder = null;
const getEmbedder = async () => {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
};
```

---

## 5. pgvector Query

### 5.1 Core Search Query

```sql
SELECT
  id, type, title, description, city, country, category,
  duration_minutes, star_rating, latitude, longitude,
  image_urls, supplier_slug, vehicle_class, amenities,
  1 - (embedding <=> $1) AS score
FROM hub_static_inventory
WHERE is_active = true
  AND canonical_id IS NULL
  AND embedding IS NOT NULL
  AND 1 - (embedding <=> $1) >= $2     -- min_score threshold
  AND ($3::varchar IS NULL OR type = $3)
  AND ($4::varchar IS NULL OR LOWER(city) = LOWER($4))
ORDER BY embedding <=> $1
LIMIT $5 OFFSET $6
```

### 5.2 Index Strategy

```sql
-- IVFFlat index for approximate nearest neighbor
-- lists = sqrt(total_records) is a good starting point
CREATE INDEX idx_static_inventory_embedding
  ON hub_static_inventory
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 500);
```

**Performance at scale:**
| Records | Query Time (IVFFlat) | Recall |
|---------|---------------------|--------|
| 30K | ~5ms | 98%+ |
| 300K | ~12ms | 95%+ |
| 1M | ~25ms | 92%+ |

For 300K records, IVFFlat with 500 lists provides excellent speed/recall
tradeoff. If recall needs to be higher, switch to HNSW index:

```sql
CREATE INDEX idx_static_inventory_embedding_hnsw
  ON hub_static_inventory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 6. Type-Specific Behavior

### 6.1 Experiences
- Semantic search is the primary interface
- Dates are optional — used for availability filtering downstream
- Categories (FOOD, CULTURE, SPORT, etc.) available as optional hard filter
- Duration shown in results

### 6.2 Hotels
- Semantic search finds the right properties
- `checkin`, `checkout`, `rooms`, `guests` passed through for live pricing
- Star rating and amenities included in results
- Live pricing via supplier API is a separate step (not in catalog)

### 6.3 Transfers
- Simple structured queries: origin → destination + date + passengers
- Embeddings available but less useful (transfers are route-based)
- Falls back to standard filters if semantic match is weak
- Vehicle class shown in results

---

## 7. Query Examples

| User Query | Type | How It Works |
|-----------|------|-------------|
| "top attractions Barcelona" | EXPERIENCE | Semantic match → ranked by similarity to popular sightseeing experiences |
| "walking food tour Rome" | EXPERIENCE | Matches both "walking" and "food" concepts semantically |
| "romantic hotel with pool Santorini" | HOTEL | "romantic" + "pool" map to boutique/luxury hotels with pool amenity |
| "kid friendly activities London" | EXPERIENCE | "kid friendly" semantically near family/children experiences |
| "airport shuttle Heathrow" | TRANSFER | Matches transfers with Heathrow as origin/destination |
| "cooking class Tuscany" | EXPERIENCE | Matches cooking workshops in Tuscan cities |
| "cheap hostel Amsterdam" | HOTEL | "cheap" + "hostel" maps to budget accommodations |
| "sunset boat trip Dubrovnik" | EXPERIENCE | Matches evening/sunset + boat/sailing in Dubrovnik |

---

## 8. Performance Budget

| Step | Target | Notes |
|------|--------|-------|
| Query embedding | < 50ms | MiniLM on CPU, model pre-loaded |
| pgvector search | < 15ms | IVFFlat index on 300K records |
| DB round trip | < 5ms | localhost Postgres |
| JSON serialization | < 5ms | 20 results |
| **Total** | **< 75ms** | End-to-end, no live pricing |

Compare to current supplier API calls: 800-3000ms.

---

## 9. Embedding Maintenance

### 9.1 During Nightly Sync
New or updated records get embedded as part of the sync worker:

```
Sync worker fetches supplier data
  → Upserts into hub_static_inventory
  → If embedding IS NULL or content changed:
      compute embedding, UPDATE SET embedding = $1
```

### 9.2 Re-embedding
If the model changes or embedding strategy is updated, run:
```bash
node src/sync/build-embeddings.js EXPERIENCE
node src/sync/build-embeddings.js HOTEL
```

This overwrites all embeddings. Dedup should be re-run afterward.

### 9.3 Embedding Coverage

| Type | Records | Embedded | Status |
|------|---------|----------|--------|
| EXPERIENCE | ~31K | 31,738 | Complete |
| HOTEL | ~258K | In progress | ~3hrs first run |
| TRANSFER | ~24K | Not started | After hotels |

---

## 10. Future Enhancements

### 10.1 LLM Re-ranking (Phase 2)
For premium queries, add an optional LLM re-ranker after pgvector:
1. pgvector returns top 50 candidates
2. LLM re-ranks based on query intent + result metadata
3. Return top 20

Cost: ~$0.001/query with Haiku. Only for complex queries where
semantic similarity alone isn't enough.

### 10.2 Hybrid Search (Phase 2)
Combine semantic + keyword search for better precision:
```sql
-- Semantic score
(1 - (embedding <=> query_vec)) * 0.7
+
-- Keyword score (ts_rank)
ts_rank(to_tsvector(title || ' ' || description), plainto_tsquery($1)) * 0.3
AS combined_score
```

Requires adding a `tsvector` column and GIN index.

### 10.3 Personalization (Phase 3)
Store user preference embeddings based on click/booking history.
Blend user vector with query vector for personalized ranking.

### 10.4 Multi-language (Phase 3)
MiniLM supports ~50 languages. Queries in Spanish, French, German etc.
will partially work already. For full multi-language support, switch to
a multilingual model (paraphrase-multilingual-MiniLM-L12-v2, 384 dims —
same vector size, drop-in replacement).

---

## 11. Migration from Current API

The existing structured catalog endpoints remain available:

| Current | Semantic | Notes |
|---------|----------|-------|
| `/v1/catalog/search?city=X&category=Y` | `/v1/catalog/search?q=Y+in+X` | Both work |
| `/v1/catalog/:id` | `/v1/catalog/:id` | Unchanged |
| `/v1/catalog/cities` | `/v1/catalog/cities` | Unchanged |

The structured params (city, type) can be combined with semantic search
as hard filters. The frontend can progressively migrate from structured
to semantic without breaking anything.
