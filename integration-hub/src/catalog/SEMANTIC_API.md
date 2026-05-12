# Catalog Semantic API — Design

## Overview

The semantic endpoint (`POST /v1/catalog/semantic`) is a thin orchestration layer that translates natural language into atomic API calls and aggregates their responses.

It does NOT implement its own search logic. It decomposes intent, delegates to atomic endpoints, and returns a unified result.

---

## Atomic APIs (the real implementation)

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /v1/catalog/query` | `{ q, type, city, category, limit }` | Vector-ranked results |
| `POST /v1/catalog/availability` | `{ ids, date_from, date_to }` | Which IDs have availability |
| `GET /v1/catalog/:id` | item ID | Full item detail |
| `GET /v1/catalog/:id/occurrences` | event item ID | All date occurrences |
| `GET /v1/catalog/cities` | optional type | City list |
| `GET /v1/catalog/categories` | optional type | Category list |
| `GET /v1/catalog/browse` | structured filters | Paginated results |
| `POST /v1/catalog/:id/book` | booking payload | Booking result |

---

## Semantic Endpoint

### `POST /v1/catalog/semantic`

**Input:**
```json
{
  "text": "live music events in New York between March and April 2027"
}
```

**Step 1 — Intent Extraction**

Uses LLM (Claude Haiku) to parse the text into structured intent:

```json
{
  "search_query": "live music",
  "city": "New York",
  "type": "EXPERIENCE",
  "category": null,
  "dates": { "from": "2027-03-01", "to": "2027-04-30" },
  "sort_preference": null,
  "limit": 20
}
```

Extraction rules:
- `search_query`: the core semantic search terms (what the user wants to do/see)
- `city`: location mentioned, normalized to city name
- `type`: inferred from context (events/shows → EXPERIENCE, hotels → HOTEL, airport transfers → TRANSFER)
- `category`: specific category if mentioned (food, culture, sport, etc.)
- `dates`: any date range mentioned, resolved to ISO dates
- `sort_preference`: if user says "cheapest" → price, "best rated" → rating
- `limit`: if user says "top 5" → 5, otherwise default 20

**Step 2 — Query (atomic call)**

Calls `POST /v1/catalog/query` with extracted params:
```json
{
  "q": "live music",
  "city": "New York",
  "type": "EXPERIENCE",
  "limit": 20
}
```

Returns ranked candidates with `is_event` flag on each.

**Step 3 — Availability (conditional, atomic call)**

Only if `dates` were extracted AND results contain `is_event: true` items:

Calls `POST /v1/catalog/availability` with event IDs + date range:
```json
{
  "ids": ["uuid-1", "uuid-2", "uuid-3", ...],
  "date_from": "2027-03-01",
  "date_to": "2027-04-30"
}
```

Returns which events have availability in that window.

**Step 4 — Merge & Rank**

- Events without availability in the date range → removed from results
- Events with availability → promoted, annotated with slot count
- Non-event experiences → kept as-is (always available, book any date)
- Final sort: available events first (by slot count), then non-events (by relevance)

**Output:**
```json
{
  "results": [
    {
      "id": "uuid-1",
      "title": "Jazz at Lincoln Center",
      "city": "New York",
      "category": "Shows & Performances",
      "is_event": true,
      "relevance": 0.82,
      "availability": {
        "available": true,
        "slot_count": 3,
        "slots": [...]
      },
      "price_from": 45.00,
      "price_currency": "USD",
      "supplier_slug": "stubhub",
      "image_urls": [...]
    },
    {
      "id": "uuid-2",
      "title": "NYC Underground Music Walking Tour",
      "city": "New York",
      "category": "Music & Nightlife",
      "is_event": false,
      "relevance": 0.78,
      "price_from": 55.00,
      ...
    }
  ],
  "total": 47,
  "meta": {
    "original_text": "live music events in New York between March and April 2027",
    "extracted_intent": {
      "search_query": "live music",
      "city": "New York",
      "dates": { "from": "2027-03-01", "to": "2027-04-30" }
    },
    "steps_executed": ["intent_extraction", "query", "availability_check", "merge"],
    "timing": {
      "intent_ms": 320,
      "query_ms": 85,
      "availability_ms": 1200,
      "total_ms": 1605
    }
  }
}
```

---

## What the semantic layer does NOT do

- No direct DB queries — everything goes through atomic APIs
- No booking — returns results; caller uses `POST /v1/catalog/:id/book` separately
- No caching — each request is stateless
- No session/context — each call is independent (conversation context is the caller's responsibility)

---

## Cost & Latency

| Step | Latency | Cost |
|------|---------|------|
| Intent extraction (Haiku) | ~300ms | ~$0.0003 per call |
| Query (vector search) | ~50-100ms | free (local) |
| Availability (Bridgify API) | ~200-1500ms | free (API quota) |
| **Total** | **~600-2000ms** | **~$0.0003** |

Availability is the slowest step and only runs when dates are present + events found. Most queries without dates return in <500ms.

---

## When to use which endpoint

| Use case | Endpoint |
|----------|----------|
| User types free text in a search box | `POST /v1/catalog/semantic` |
| App has structured filters (dropdowns, date pickers) | `GET /v1/catalog/browse` or `POST /v1/catalog/query` |
| App needs to check if specific items are bookable on dates | `POST /v1/catalog/availability` |
| App displays item detail page | `GET /v1/catalog/:id` |
| App shows "10 dates available" for an event | `GET /v1/catalog/:id/occurrences` |
| App completes a booking | `POST /v1/catalog/:id/book` |

The semantic endpoint is for AI agents and natural language UIs. Structured apps should call atomic APIs directly.
