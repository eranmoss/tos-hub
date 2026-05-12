# Catalog Business Ranking — Intelligence Layer

## Principle

Semantic search finds the RIGHT set. Business ranking decides the ORDER within that set.

Never let commercial signals overpower relevance. Flow:
1. pgvector returns top 100 candidates (relevance filter)
2. Business ranker scores each candidate on commercial/product signals
3. Return top 20 ordered by final_score

---

## Final Score Formula

```
final_score =
  semantic_score * 0.55
+ popularity_score * 0.15
+ rating_score * 0.10
+ margin_score * 0.10
+ availability_score * 0.07
+ supplier_priority_score * 0.03
```

All component scores normalized 0–1.

---

## Component Scores

### semantic_score (weight: 0.55)
- Source: pgvector cosine similarity
- Already 0–1 (embedding <=> distance converted to similarity)
- This is the dominant signal — ensures relevance is never overridden

### popularity_score (weight: 0.15)
- Source: `booking_count`, `click_count`, `conversion_rate`
- Formula: `log(bookings + 1) / log(max_bookings + 1)` (log-normalized)
- Fallback: 0.3 (neutral) when no data
- Future: track clicks/impressions in `hub_item_stats` table

### rating_score (weight: 0.10)
- Source: `rating` (0–5), `review_count`
- Formula: `(rating / 5.0) * confidence` where `confidence = min(1, review_count / 50)`
- Low review count → score regresses toward 0.5 (Bayesian average)
- Fallback: 0.5 when no rating

### margin_score (weight: 0.10)
- Source: `commission_rate`, `estimated_margin_usd`
- Formula: `commission_pct / max_commission_pct` normalized 0–1
- Fallback: 0.3 (neutral)
- Future: per-supplier commission config in `hub_supplier_commercial`

### availability_score (weight: 0.07)
- 1.0 = confirmed available (availability checked, slots > 0)
- 0.5 = unknown (not checked yet)
- 0.0 = unavailable (checked, no slots)
- Only relevant when dates are provided; defaults to 0.5 otherwise

### supplier_priority_score (weight: 0.03)
- Source: `hub_tenant_suppliers.preferred_for_cats`, tenant config
- 1.0 = preferred supplier for this category
- 0.5 = standard supplier
- 0.0 = deprioritized supplier
- Smallest weight — tiebreaker only

---

## Composite Grouping (alternative view)

```
final_score =
  relevance_score (0.55)     ← semantic similarity
+ trust_score (0.10)         ← rating + reviews (Bayesian)
+ commercial_score (0.10)    ← margin + commission
+ popularity_score (0.15)    ← bookings + clicks
+ availability_score (0.07)  ← live availability signal
+ quality_score (0.03)       ← supplier priority + content quality
```

---

## Data Sources (current vs future)

| Signal | Available Now | Source |
|--------|-------------|--------|
| semantic_score | Yes | pgvector similarity |
| rating | Yes | `hub_static_inventory.rating` |
| review_count | Yes | `hub_static_inventory.review_count` |
| price_from | Yes | `hub_static_inventory.price_from` |
| supplier_slug | Yes | `hub_static_inventory.supplier_slug` |
| is_event | Yes | `hub_static_inventory.is_event` |
| booking_count | No | needs `hub_item_stats` table |
| click_count | No | needs `hub_item_stats` table |
| commission_rate | No | needs `hub_supplier_commercial` table |
| availability | Partial | via lifecycle API call |
| content_quality | No | could derive from description length + image count |
| image_quality | No | needs scoring pipeline |

---

## MVP Implementation (with current data)

Start with what we have:

```
final_score =
  semantic_score * 0.55
+ rating_score * 0.15
+ review_score * 0.10
+ content_score * 0.10
+ supplier_priority * 0.05
+ availability * 0.05
```

Where:
- `rating_score` = `(rating / 5.0) * min(1, review_count / 50)` or 0.5 if null
- `review_score` = `min(1, log(review_count + 1) / log(1000))` or 0.3 if null
- `content_score` = `(has_description ? 0.4 : 0) + (has_images ? 0.3 : 0) + (has_duration ? 0.15 : 0) + (has_price ? 0.15 : 0)`
- `supplier_priority` = from tenant config or 0.5
- `availability` = 0.5 (unknown) until checked

---

## Architecture

```
POST /v1/catalog/query (or /semantic)
        ↓
  pgvector top 100 (semantic_score >= 0.25)
        ↓
  src/catalog/ranker.js  ←  business intelligence layer
        ↓
  reordered top 20 with final_score
        ↓
  response
```

The ranker is a pure function: `rank(candidates, tenantConfig) → scored & sorted results`

No side effects, no DB writes, no API calls. Just scoring math on the data already fetched.

---

## Future Signals (add incrementally)

1. **hub_item_stats** — track impressions, clicks, bookings, conversions per item
2. **hub_supplier_commercial** — commission rates, margin tiers per supplier
3. **Content quality scoring** — description richness, image count/resolution
4. **Refund rate** — penalize items with high refund/cancel rates
5. **Freshness** — recently synced items get a small boost
6. **Personalization** — user history influences ranking (requires user context)
