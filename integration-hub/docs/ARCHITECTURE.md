# TOS Integration Hub — Architecture Document
## Version 1.1 | April 2026 | WanderVault

---

## 1. What This Is

The Integration Hub is the L4 execution layer of the Travel Operating System (TOS). It is the single gateway through which all external supplier APIs flow into TOS. It handles the full travel product lifecycle:

1. **Integration** — onboard new suppliers via manifest + sandbox validation
2. **Discovery** — sync supplier catalogs, deduplicate, serve via semantic search
3. **Availability** — real-time availability checks against supplier APIs
4. **Booking** — execute bookings with supplier-specific flows (server-to-server or redirect)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  INTEGRATION     DISCOVERY          AVAILABILITY       BOOKING           │
│  ────────────    ─────────          ────────────       ───────           │
│  Onboard         Nightly Sync       POST catalog/      POST catalog/     │
│  Manifest        → Embed            :id/availability   :id/book          │
│  Validate        → Dedup                                                 │
│  Provision       → Catalog API      Live supplier      Supplier-specific │
│                  → Semantic Search   call per item      checkout flow     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        INTEGRATION HUB                                │
│                                                                       │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────────────────┐    │
│  │ Express    │  │ Catalog API    │  │ Dashboard API            │    │
│  │ Server     │  │ (public)       │  │ (JWT-protected)          │    │
│  │ :3000      │  │ /v1/catalog/*  │  │ /v1/dashboard/*          │    │
│  └─────┬──────┘  └────────┬───────┘  └──────────┬───────────────┘    │
│        │                  │                      │                    │
│  ┌─────▼──────────────────▼──────────────────────▼───────────────┐    │
│  │                    SHARED SERVICES                             │    │
│  │                                                               │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐   │    │
│  │  │ Lifecycle    │  │ Sync Workers │  │ Dedup Engine      │   │    │
│  │  │ Router       │  │ (per-supplier│  │ (OR-gate + LLM)   │   │    │
│  │  │              │  │  nightly)    │  │                    │   │    │
│  │  └──────┬───────┘  └──────┬───────┘  └─────────┬─────────┘   │    │
│  │         │                 │                     │             │    │
│  │  ┌──────▼─────────────────▼─────────────────────▼─────────┐   │    │
│  │  │              PostgreSQL 16 + pgvector                   │   │    │
│  │  │  hub_static_inventory (300K+ records, 384-dim vectors)  │   │    │
│  │  │  hub_dedup_pairs · hub_sync_jobs · hub_credentials_map  │   │    │
│  │  │  hub_tenants · hub_tenant_suppliers · hub_transactions  │   │    │
│  │  └────────────────────────────────────────────────────────┘   │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐    │
│  │                    SUPPLIER ADAPTERS                           │    │
│  │  ┌──────────┐ ┌────────────────┐ ┌────────────────────────┐   │    │
│  │  │ Bridgify │ │ HotelBeds      │ │ HotelBeds              │   │    │
│  │  │ Exp.     │ │ Hotels         │ │ Activities + Transfers │   │    │
│  │  └──────────┘ └────────────────┘ └────────────────────────┘   │    │
│  └───────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### Tech Stack
| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20.x, ES modules |
| Framework | Express |
| Database | PostgreSQL 16 + pgvector (WSL, port 5433) |
| Embedding | MiniLM-L6-v2 via @xenova/transformers (384-dim, local) |
| LLM | Claude Haiku (dedup borderline judgment, ~$3/month) |
| Dashboard | React + Vite (localhost:5173) |

---

## 3. Integration — Supplier Onboarding

### 3.1 Onboarding Flow

New suppliers are integrated through a manifest-driven onboarding pipeline with 8 conversation stages, automated sandbox validation, and provisioning.

```
┌───────────────────────────────────────────────────────────────────┐
│                    ONBOARDING PIPELINE                             │
│                                                                    │
│  1. MANIFEST SUBMISSION                                            │
│     POST /v1/integrations/onboard                                  │
│     Partner submits integration manifest (JSON):                   │
│       • supplier: name, slug, categories, base_url                 │
│       • auth: type (API_KEY|HMAC_SHA256|OAUTH2|BASIC),             │
│              credential_fields, signature_algorithm                 │
│       • operations: search, detail, availability, book, cancel     │
│       • cts_mapping: field_mappings[], status_mappings              │
│       • test_suite: sandbox_search_params                          │
│                                                                    │
│  2. MANIFEST VALIDATION (Zod schema)                               │
│     Required: supplier.name, slug, categories, base_url_sandbox    │
│     Required: auth.type, credential_fields                         │
│     Required: operations.search + operations.book                  │
│     Required: cts_mapping.field_mappings (min 1)                   │
│                                                                    │
│  3. AUTO-MAPPER (optional)                                         │
│     POST /v1/integrations/onboard/:id/auto-map                    │
│     Probes the supplier's sandbox API with test credentials        │
│     Matches response fields → CTS targets by string similarity     │
│     Returns proposed field_mappings for human review               │
│                                                                    │
│  4. SANDBOX VALIDATION — 6 steps                                   │
│     POST /v1/integrations/onboard/:id/confirm                     │
│     ┌──────┬────────────────────┬──────────┬──────────────────┐    │
│     │ Step │ Test               │ Required │ Retries          │    │
│     ├──────┼────────────────────┼──────────┼──────────────────┤    │
│     │  1   │ Auth (HTTP 200)    │ Yes      │ 3                │    │
│     │  2   │ Search (results≥1) │ Yes      │ 3                │    │
│     │  3   │ CTS normalize >95% │ Yes      │ 3 (no API call)  │    │
│     │  4   │ Detail fetch       │ No       │ 2                │    │
│     │  5   │ Booking test       │ No       │ 2                │    │
│     │  6   │ Cancel simulation  │ No       │ 2                │    │
│     └──────┴────────────────────┴──────────┴──────────────────┘    │
│     Steps 1-3 MUST pass. Steps 4-6 may be UNTESTED.               │
│                                                                    │
│  5. PROVISIONING — 9 steps (on promotion)                          │
│     POST /v1/integrations/onboard/:id/promote                     │
│     1. INSERT hub_suppliers                                        │
│     2. INSERT hub_schema_mappings                                  │
│     3. Store credentials (pgp_sym_encrypt)                         │
│     4. INSERT hub_tool_contracts                                   │
│     5. INSERT hub_dedup_config (SHOW_ALL default)                  │
│     6. INSERT hub_integration_tests                                │
│     7. INSERT hub_tenant_suppliers                                 │
│     8. Send completion email (Resend)                              │
│     9. Log NEW_INTEGRATION_PROVISIONED                             │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 Onboarding API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/integrations/onboard` | POST | Submit manifest, returns session_id |
| `/v1/integrations/onboard/:id` | GET | Poll session status + validation report |
| `/v1/integrations/onboard/:id/manifest` | PATCH | Update manifest during session |
| `/v1/integrations/onboard/:id/auto-map` | POST | Auto-map supplier fields → CTS |
| `/v1/integrations/onboard/:id/confirm` | POST | Trigger sandbox validation |
| `/v1/integrations/onboard/:id/promote` | POST | Provision to production |
| `/v1/integrations` | GET | List active integrations |
| `/v1/integrations/:slug` | DELETE | Deactivate integration |

### 3.3 Credential Management

Credentials never leave the encrypted store:
```
Partner provides creds in onboarding wizard
  → pgp_sym_encrypt(creds, MASTER_KEY) → hub_credentials_map
  → Sync workers call getSecret(tenantId, supplierSlug)
  → pgp_sym_decrypt at runtime → used for one API call → discarded
```

### 3.4 Phase 1 Suppliers

| Supplier | Type | Records | Auth | Status |
|----------|------|---------|------|--------|
| **Bridgify** | EXPERIENCE | ~30K | API Key (OAuth2 client credentials) | Active |
| **HotelBeds Hotels** | HOTEL | ~238K | HMAC-SHA256 per request | Active |
| **HotelBeds Activities** | EXPERIENCE | ~2,390 | HMAC-SHA256 per request | Active (API intermittent) |
| **HotelBeds Transfers** | TRANSFER | ~200 | HMAC-SHA256 per request | Active |

HotelBeds HMAC signature (computed on every request):
```js
const ts = Math.floor(Date.now() / 1000).toString();
const sig = createHash('sha256').update(API_KEY + SECRET + ts).digest('hex');
// Required headers: X-Api-Key, X-Signature, X-Timestamp
```

---

## 4. Discovery — Sync, Dedup, Search

### 4.1 Nightly Sync Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                     NIGHTLY SYNC FLOW                        │
│                                                              │
│  Supplier Content API                                        │
│       │                                                      │
│       ▼                                                      │
│  Sync Worker (src/sync/<supplier>.js)                        │
│       │  • Fetch in pages of 1000                            │
│       │  • Normalize to CTS static shape                     │
│       │  • Upsert into hub_static_inventory                  │
│       │    (ON CONFLICT supplier_slug, supplier_raw_ref       │
│       │     DO UPDATE)                                       │
│       │  • Soft-delete stale records (is_active = false)     │
│       │  • Log progress to hub_sync_jobs                     │
│       ▼                                                      │
│  Build Embeddings (src/sync/build-embeddings.js)             │
│       │  • MiniLM-L6-v2: "{title} | {city} | {category}     │
│       │    | {description first 200 chars}"                  │
│       │  • 384-dim vector stored in embedding column         │
│       ▼                                                      │
│  Dedup Engine (src/sync/dedup-precompute.js)                 │
│       │  • City gate → Differentiator veto → OR-gate rules   │
│       │  • Borderline → LLM Judge (Claude Haiku, batched)    │
│       │  • Cluster → Pick canonical (Bridgify preferred)     │
│       │  • Non-canonical: SET canonical_id = winner.id       │
│       ▼                                                      │
│  Ready for search: WHERE canonical_id IS NULL                │
└─────────────────────────────────────────────────────────────┘
```

**What gets synced vs. what stays live:**

| Data | Source | Cached? | Refresh |
|------|--------|---------|---------|
| Hotel name, photos, amenities, stars | HotelBeds Content API | Yes | Nightly |
| Experience name, duration, category | Bridgify / HotelBeds | Yes | Nightly |
| Transfer routes, vehicle types | HotelBeds Transfers | Yes | Nightly |
| Room rates, rateKeys | HotelBeds Booking API | **Never** (contract) | Per search |
| Experience pricing | Bridgify | `price_from` cached | Nightly |
| Live availability | All suppliers | **Never** | Per request |

**Soft Delete Guard**: `base-sync.js` skips deactivation when 0 records fetched — prevents inventory wipe on auth failure.

### 4.2 Dedup Engine

Detects when multiple suppliers sell the same real-world product (e.g., "Barcelona Sagrada Familia Tour" from both Bridgify and HotelBeds).

```
  Record A + Record B (same city)
       │
       ▼
  DIFFERENTIATOR VETO — keyword-based
  "bike tour" vs "walking tour" → DISTINCT (skip all rules)
  Categories: transport, time-of-day, format, scope, venue
       │ no conflict
       ▼
  OR-GATE (any one sufficient):
    • Fuzzy name ≥ 0.90       → DUPLICATE
    • Embedding ≥ 0.85        → DUPLICATE
    • Emb ≥ 0.75 + Fuz ≥ 0.55 → DUPLICATE (mutual confirmation)
       │ none fired
       ▼
  Embedding < 0.65            → DISTINCT
  0.65 - 0.85 (borderline)   → LLM JUDGE (Claude Haiku, 20 pairs/batch)
```

**Canonical selection**: Bridgify preferred → then highest data completeness (description +2, images +1, duration +1, coordinates +1). Non-canonical records get `canonical_id` set; search filters them with `WHERE canonical_id IS NULL`.

**Results (31K inventory)**: 11,206 duplicates (35.3%), 5,477 clusters, 20,532 unique products.

### 4.3 Discovery API — Search & Browse

```
  Consumer UI                         Integration Hub
  ──────────                         ───────────────
  
  SEMANTIC SEARCH                     GET /v1/catalog/search?q=walking+food+tours+Rome
  "walking food tours Rome"
       │                                   1. Embed query → 384-dim vector (~40ms)
       │                                   2. pgvector cosine search (~12ms)
       │                                   3. Filter: type, city, category, min_score
       │                                   4. Return ranked results with score
       ◀─────── < 75ms ──────────────     Total: < 75ms
  
  STRUCTURED BROWSE                   GET /v1/catalog/browse?type=HOTEL&city=Barcelona&sort=rating
  "Hotels in Barcelona by rating"
       │                                   1. SQL query with WHERE/ORDER BY
       │                                   2. Sort: rating | price | reviews | recent
       │                                   3. Pagination via page + limit
       ◀─────── < 30ms ──────────────     Total: < 30ms
  
  FACET FILTERS                       GET /v1/catalog/cities?type=EXPERIENCE
       │                              GET /v1/catalog/categories?type=HOTEL
       ◀──────────────────────────     Returns {city, count}[] or {category, count}[]
```

**Full Catalog API Surface:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/catalog/search?q=...` | GET | Semantic search (pgvector cosine distance) |
| `/v1/catalog/browse?type=&city=&sort=` | GET | Structured browse with sort/filter |
| `/v1/catalog/cities?type=` | GET | City facets with counts |
| `/v1/catalog/categories?type=` | GET | Category facets with counts |
| `/v1/catalog/:id` | GET | Single item detail + raw_content |
| `/v1/catalog/:id/availability` | POST | Check live availability (see §5) |
| `/v1/catalog/:id/book` | POST | Initiate booking (see §6) |

---

## 5. Availability — Live Supplier Checks

When a user selects a product and wants to check availability, the catalog API routes the request to the correct supplier handler based on `supplier_slug`.

```
┌──────────────────────────────────────────────────────────────────────┐
│                    AVAILABILITY FLOW                                   │
│                                                                       │
│  Consumer UI                                                          │
│  ─────────────                                                        │
│  User picks dates on detail page                                      │
│       │                                                               │
│       ▼                                                               │
│  POST /hub/v1/catalog/:id/availability                                │
│       │  body: { date_from, date_to, adults }                         │
│       │                                                               │
│  ┌────▼───────────────────────────────────────────────────────────┐   │
│  │  Catalog API                                                    │   │
│  │  1. Load inventory row (id → supplier_slug, raw_content)       │   │
│  │  2. Resolve default tenant                                      │   │
│  │  3. Route to lifecycle handler by supplier_slug                 │   │
│  └────┬───────────────────────────────────────────────────────────┘   │
│       │                                                               │
│       ├─── bridgify ───────────────────────────────────────────────┐  │
│       │    GET /attractions/products/availability/{uuid}/          │  │
│       │    params: date_from, date_to                              │  │
│       │    Returns: slots[] with {date, times[]}                   │  │
│       │    ID resolution: rawContent.uuid preferred over rawRef    │  │
│       │                                                           │  │
│       ├─── hotelbeds-hotels ───────────────────────────────────────┤  │
│       │    POST /hotels (search with single hotel code filter)    │  │
│       │    body: { stay: {checkIn, checkOut}, occupancies,        │  │
│       │            hotels: { hotel: [code] } }                    │  │
│       │    Returns: rooms[] with rates[] + rateKeys               │  │
│       │    ⚠ Rate keys expire ~15 min — must checkrates before    │  │
│       │      booking                                              │  │
│       │    ⚠ Sandbox has limited availability — popular cities    │  │
│       │      (Mallorca, Barcelona, London) work best              │  │
│       │                                                           │  │
│       ├─── hotelbeds-activities ───────────────────────────────────┤  │
│       │    GET /activities?code={code}&dateFrom=X&dateTo=X        │  │
│       │    Returns: activities[] with modalities[] + rates[]      │  │
│       │                                                           │  │
│       └─── hotelbeds-transfers ───────────────────────────────────┘  │
│            GET /availability/{lang}/from/{type}/{code}/to/...        │
│            Path-based params (not query params)                       │
│            Requires IATA (airport) or ATLAS (hotel code)             │
│            Returns: services[] with vehicle, price, rateKey          │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  RESPONSE FORMAT (all suppliers)                                │   │
│  │  {                                                              │   │
│  │    ok: true/false,                                              │   │
│  │    data: { ... supplier-specific availability ... },            │   │
│  │    next_payload_hint: { ... pre-filled params for book step }   │   │
│  │  }                                                              │   │
│  └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### Availability by Supplier — Detail

#### Bridgify Experiences
```
Input:  { date_from: "2026-05-01", date_to: "2026-05-08" }
Call:   GET /attractions/products/availability/{uuid}/?date_from=...&date_to=...
Output: { slots: [{ date: "2026-05-01", times: ["09:00","11:00","14:00"] }, ...] }
UI:     Shows selectable date/time slots
```

#### HotelBeds Hotels
```
Input:  { stay: { checkIn: "2026-05-01", checkOut: "2026-05-03" },
          occupancies: [{ rooms: 1, adults: 2, children: 0 }] }
Call:   POST /hotel-api/1.2/hotels  (single hotel code filter)
Output: { hotels: [{ rooms: [{ rates: [{ rateKey: "...", net: "125.00" }] }] }] }
UI:     Shows room types with live prices
⚠ Rate keys expire ~15 min. CheckRates mandatory before book.
⚠ Contract prohibits caching rates — always live.
```

#### HotelBeds Activities
```
Input:  { code: "E-123", dateFrom: "2026-05-01", dateTo: "2026-05-08" }
Call:   GET /activities?code=E-123&dateFrom=...&dateTo=...
Output: { activities: [{ modalities: [{ rates: [{ rateKey: "..." }] }] }] }
UI:     Shows modality options with pricing
```

#### HotelBeds Transfers
```
Input:  { fromType: "IATA", fromCode: "PMI", toType: "ATLAS",
          toCode: "1234", outbound: "2026-05-01T12:00:00", adults: 2 }
Call:   GET /availability/en/from/IATA/PMI/to/ATLAS/1234/2026-05-01T12:00:00/2/0/0
Output: { services: [{ transferType: "PRIVATE", vehicle: {...}, price: {...}, rateKey: "..." }] }
UI:     Shows vehicle options with prices
```

---

## 6. Booking — Supplier-Specific Checkout Flows

After availability is confirmed, the user proceeds to book. Each supplier has a fundamentally different booking model.

```
┌──────────────────────────────────────────────────────────────────────┐
│                       BOOKING FLOW                                    │
│                                                                       │
│  Consumer UI                                                          │
│  ─────────────                                                        │
│  User clicks "Book Now"                                               │
│       │                                                               │
│       ▼                                                               │
│  POST /hub/v1/catalog/:id/book                                       │
│       │                                                               │
│  ┌────▼───────────────────────────────────────────────────────────┐   │
│  │  BRIDGIFY EXPERIENCES — Redirect-based checkout                 │   │
│  │                                                                 │   │
│  │  There is NO server-to-server booking API.                      │   │
│  │                                                                 │   │
│  │  1. Fetch product detail to get order_webpage URL               │   │
│  │     GET /attractions/products/{uuid}/                           │   │
│  │  2. Extract order_webpage from response                         │   │
│  │     (or fall back to raw_content.order_webpage from sync)       │   │
│  │  3. Return { booking_mode: "redirect", order_webpage: URL }     │   │
│  │  4. Consumer UI opens URL in new tab                            │   │
│  │  5. User completes checkout on Bridgify's hosted page           │   │
│  │                                                                 │   │
│  │  ⚠ Some products don't have order_webpage — they aren't         │   │
│  │    bookable online. Returns { status: "unavailable" }           │   │
│  │  ⚠ Cancellation handled on Bridgify's platform, not via API    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  HOTELBEDS HOTELS — Server-to-server with rate key validation   │   │
│  │                                                                 │   │
│  │  1. CHECKRATES (mandatory — rate key may have expired)          │   │
│  │     POST /hotel-api/1.2/checkrates                              │   │
│  │     body: { rooms: [{ rateKey }] }                              │   │
│  │     → Validates price hasn't changed >5%, returns fresh rate    │   │
│  │                                                                 │   │
│  │  2. BOOK                                                        │   │
│  │     POST /hotel-api/1.2/bookings                                │   │
│  │     body: {                                                     │   │
│  │       holder: { name, surname },                                │   │
│  │       rooms: [{                                                 │   │
│  │         rateKey: "...",                                          │   │
│  │         paxes: [{ roomId: 1, type: "AD", name, surname }]      │   │
│  │       }]                                                        │   │
│  │     }                                                           │   │
│  │     → Returns booking_reference                                 │   │
│  │                                                                 │   │
│  │  3. CANCEL (optional)                                           │   │
│  │     DELETE /hotel-api/1.2/bookings/{reference}                  │   │
│  │     → Returns cancellation_cost + status                        │   │
│  │                                                                 │   │
│  │  ⚠ CREATES REAL BOOKINGS even in sandbox                       │   │
│  │  ⚠ Rate keys expire ~15 min after search                       │   │
│  │  ⚠ Net (wholesale) pricing — B2B rate, markup applied by L5    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  HOTELBEDS ACTIVITIES — Server-to-server with modality codes    │   │
│  │                                                                 │   │
│  │  1. BOOK                                                        │   │
│  │     POST /bookings                                              │   │
│  │     body: {                                                     │   │
│  │       holder: { name, surname },                                │   │
│  │       activities: [{                                            │   │
│  │         code: "E-123", modality: "MOD-1",                       │   │
│  │         from: "2026-05-01", to: "2026-05-01",                   │   │
│  │         paxes: [{ age: 30 }, { age: 30 }],                      │   │
│  │         rateKey: "..."                                           │   │
│  │       }]                                                        │   │
│  │     }                                                           │   │
│  │     → Returns booking_reference                                 │   │
│  │                                                                 │   │
│  │  2. CANCEL                                                      │   │
│  │     DELETE /bookings/{reference}                                │   │
│  │                                                                 │   │
│  │  ⚠ Activity API currently returning 403 on sandbox (temporary)  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  HOTELBEDS TRANSFERS — Server-to-server with passenger manifest │   │
│  │                                                                 │   │
│  │  1. BOOK                                                        │   │
│  │     POST /bookings                                              │   │
│  │     body: {                                                     │   │
│  │       holder: { name, surname, email, phone },                  │   │
│  │       clientReference: "TOS-T-{timestamp}",                     │   │
│  │       transfers: [{                                             │   │
│  │         rateKey: "...",                                          │   │
│  │         transferDetails: [{                                     │   │
│  │           direction: "ARRIVAL",                                  │   │
│  │           type: "FLIGHT",                                        │   │
│  │           code: "IB3915"  ← flight number for pickup            │   │
│  │         }]                                                      │   │
│  │       }]                                                        │   │
│  │     }                                                           │   │
│  │     → Returns booking_reference                                 │   │
│  │                                                                 │   │
│  │  2. CANCEL                                                      │   │
│  │     DELETE /bookings/{reference}                                │   │
│  │                                                                 │   │
│  │  ⚠ Outbound + return are separate API calls, linked by trip_id │   │
│  │  ⚠ Requires IATA/ATLAS codes, not destination codes from sync  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.1 Lifecycle Testing Results (April 2026)

| Supplier | Detail | Availability | Book | Cancel | Status |
|----------|--------|-------------|------|--------|--------|
| Bridgify | ✅ | ✅ | ✅ (redirect) | N/A | Full flow working |
| HotelBeds Hotels | ✅ | ✅ | ✅ | ✅ | Full cycle verified |
| HotelBeds Activities | ✅ | ⏸ 403 | ⏸ | ⏸ | API intermittent |
| HotelBeds Transfers | ✅ | ✅ | ✅ | ✅ | Full cycle verified |

### 6.2 Lifecycle Router

All lifecycle steps are dispatched through a single router:

```js
// src/lifecycle/router.js
runLifecycleStep({ tenantId, slug, step, rawRef, rawContent, payload })
//   slug  → routes to handler: bridgify | hotelbeds-hotels | hotelbeds-activities | hotelbeds-transfers
//   step  → calls handler method: detail | availability | book | cancel
```

Every handler returns a consistent shape:
```json
{
  "ok": true,
  "data": { ... },
  "next_payload_hint": { ... },
  "error": null
}
```

`next_payload_hint` pre-fills the payload for the next step (e.g., availability returns the rateKey needed for booking).

---

## 7. End-to-End User Flow

### 7.1 Experience Booking (Bridgify)

```
User opens TOS Integration Hub home page
  │
  ├── Home shows experience grid (GET /v1/catalog/browse?type=EXPERIENCE&sort=rating)
  │   Cards show title, city, rating, duration, "From $45.00"
  │
  ├── User searches "food tours Barcelona"
  │   → sessionStorage.setItem('ih_search_query', 'food tours Barcelona')
  │   → Navigate to results page
  │   → GET /v1/catalog/search?q=food+tours+Barcelona&limit=24
  │   → Results with match score badges, type tabs
  │
  ├── User clicks an experience card
  │   → sessionStorage.setItem('ih_item_snapshot', JSON.stringify(item))
  │   → Navigate to detail page with ?id=UUID
  │   → Snapshot renders instantly, GET /v1/catalog/{id} refreshes
  │
  ├── Detail page shows: hero image, badges, meta grid, price,
  │   description, gallery, and BOOKING SECTION:
  │   ┌─────────────────────────────────────────────┐
  │   │ 🎟️ Check Availability & Book                │
  │   │ From: [2026-05-01]  To: [2026-05-08]        │
  │   │ Adults: [2]  [Check Availability]            │
  │   └─────────────────────────────────────────────┘
  │
  ├── User clicks "Check Availability"
  │   → POST /hub/v1/catalog/{id}/availability
  │     body: { date_from: "2026-05-01", date_to: "2026-05-08" }
  │   → Bridgify handler calls availability API
  │   → Returns slots: [{ date: "2026-05-01", times: ["09:00","14:00"] }, ...]
  │   → UI shows selectable date/time slot cards
  │
  ├── User selects a slot and clicks "Book Now"
  │   → POST /hub/v1/catalog/{id}/book
  │   → Bridgify handler fetches product detail → extracts order_webpage URL
  │   → Returns { booking_mode: "redirect", order_webpage: "https://..." }
  │   → window.open(order_webpage, '_blank')
  │   → User completes checkout on Bridgify's hosted page
  │
  └── Done. Booking managed entirely on Bridgify's platform.
```

### 7.2 Hotel Booking (HotelBeds)

```
User opens TOS Integration Hub home page
  │
  ├── Home shows hotel grid (GET /v1/catalog/browse?type=HOTEL&sort=rating)
  │   Cards show name, city, star rating, amenity chips
  │   NO PRICES — "Search dates for live pricing"
  │
  ├── User clicks a hotel card → detail page
  │   ┌─────────────────────────────────────────────┐
  │   │ 🏨 Search Room Rates                        │
  │   │ Check-in: [2026-05-01]  Check-out: [05-03]  │
  │   │ Guests: [2]  [Search Rooms]                  │
  │   └─────────────────────────────────────────────┘
  │
  ├── User clicks "Search Rooms"
  │   → POST /hub/v1/catalog/{id}/availability
  │     body: { stay: {checkIn, checkOut}, occupancies: [{rooms:1, adults:2}] }
  │   → HotelBeds handler: POST /hotels with hotel code filter
  │   → Returns rooms with rate keys + live prices
  │   → UI shows room types with pricing
  │
  ├── (Future) User selects a room → book step
  │   → CheckRates to validate rate key
  │   → POST /bookings with holder + paxes + rateKey
  │   → Returns booking_reference
  │
  └── Cancel: DELETE /bookings/{reference}
```

---

## 8. Database Schema

PostgreSQL 16 with pgvector extension. Database: `tos_integration_hub`.

### Core Tables

```
hub_static_inventory          — 300K+ records, CTS-shaped content + 384-dim embedding
  id (UUID PK)
  supplier_slug, supplier_raw_ref (UNIQUE together)
  type (HOTEL | EXPERIENCE | TRANSFER)
  title, description, city, country, latitude, longitude
  category, duration_minutes, star_rating, vehicle_class
  image_urls[], amenities[], meal_plans[]
  embedding vector(384)       — MiniLM-L6-v2 semantic vector
  price_from, price_currency  — cached pricing (experiences/transfers only)
  rating, review_count
  canonical_id                — points to canonical record (NULL = is canonical)
  raw_content (JSONB)         — full supplier response preserved
  is_active, last_synced_at

hub_dedup_pairs               — pre-computed duplicate decisions
  inventory_id_a, inventory_id_b
  composite_score, decision (DUPLICATE | UNCERTAIN)
  signal_location, signal_name, signal_duration, signal_category

hub_sync_jobs                 — sync run tracking
  supplier_slug, status (RUNNING | COMPLETE | FAILED)
  records_fetched, records_upserted, records_deactivated, records_errored

hub_credentials_map           — encrypted supplier credentials
  tenant_id, supplier_slug
  (pgp_sym_encrypt with MASTER_KEY)

hub_tenants                   — multi-tenant config
  tenant_id, name, tier, rate_limit_rpm, api_key_hash, dedup_strategy

hub_tenant_suppliers          — tenant ↔ supplier linkage
  tenant_id, supplier_slug, sla_tier, is_active

hub_transactions              — booking/operation audit log
hub_sync_errors               — per-record sync failure log
hub_onboarding_sessions       — integration onboarding state machine
hub_prompts                   — 15 prompt templates for agent decisions
hub_escalations               — human review queue
agent_sessions                — Claude agent session tracking
```

### Indexes
```sql
CREATE INDEX idx_embedding USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_geo ON hub_static_inventory (latitude, longitude) WHERE is_active = true;
CREATE INDEX idx_supplier_type ON hub_static_inventory (supplier_slug, type) WHERE is_active = true;
```

---

## 9. Authentication

| Consumer | Auth | Implementation |
|----------|------|----------------|
| TOS consumer pages | None (public catalog API) | `/v1/catalog/*` — no auth |
| Partner dashboard | JWT (magic link or dev-login) | `src/middleware/jwt-auth.js` |
| Core API (B2B) | API Key (bcrypt-hashed) | `src/middleware/auth.js` |
| Admin endpoints | Admin key (env var) | Header: `X-Admin-Key` |
| Webhooks | Webhook secret (SHA256) | Header: `X-Webhook-Secret` |

---

## 10. Business Logic Rules

### Pricing
- **Experiences (Bridgify)**: `price_from` cached at sync → shown as "From $X" on browse
- **Hotels (HotelBeds)**: NEVER cache rates (contract). Browse shows "Search dates for live pricing". Live rates only after user picks dates.
- **Transfers**: Pricing cached at sync

### Dedup Strategy (configurable per tenant)
- `LOWEST_PRICE` (default) — surface the cheaper option when duplicates found
- `PREFERRED_SUPPLIER` — always show preferred supplier's version
- `SHOW_ALL` — show both with linkage metadata

### HotelBeds Image URLs
Stored as relative paths (e.g. `17/170950/170950a_hb_ro_095.jpg`). Consumer components prepend CDN base: `http://photos.hotelbeds.com/giata/bigger/` when URL doesn't start with `http`.

### HotelBeds Amenities
Stored as raw JSON facility objects. Components group by `facilityGroupCode` and map to human-readable labels (10=General, 20=Activities, 30=Food&Drink, 40=Entertainment, 50=Health, 60=Internet, 70=Parking, 73=Transport, 80=Business, 90=Room).

### Tenant Isolation
Every DB query includes `tenant_id`. Suppliers scoped per-tenant via `hub_tenant_suppliers`. Credentials scoped per-tenant via `hub_credentials_map`.

---

## 11. File Map

```
integration_hub/
├── src/
│   ├── index.js                    — Express app, all route mounting
│   ├── db/client.js                — Postgres connection pool
│   ├── catalog/routes.js           — Public catalog API (search, browse, availability, book)
│   ├── dashboard/routes.js         — Partner dashboard API (JWT-protected)
│   ├── middleware/
│   │   ├── auth.js                 — API key, admin, webhook auth
│   │   ├── jwt-auth.js             — JWT verification
│   │   └── rate-limit.js           — Per-tenant rate limiting
│   ├── auth/
│   │   ├── jwt.js                  — JWT sign/verify
│   │   └── magic-link.js           — Email magic link auth
│   ├── lifecycle/
│   │   ├── router.js               — Dispatch to handler by supplier_slug
│   │   └── handlers/
│   │       ├── bridgify.js         — Redirect-based checkout
│   │       ├── hotelbeds-hotels.js — CheckRates + book + cancel
│   │       ├── hotelbeds-activities.js — Modality-based booking
│   │       └── hotelbeds-transfers.js  — Passenger manifest booking
│   ├── sync/
│   │   ├── base-sync.js            — Shared sync logic
│   │   ├── bridgify-experiences.js
│   │   ├── hotelbeds-hotels.js
│   │   ├── hotelbeds-experiences.js
│   │   ├── hotelbeds-transfers.js
│   │   ├── build-embeddings.js     — Batch MiniLM embedding generator
│   │   └── dedup-precompute.js     — Full dedup engine
│   ├── search/pipeline.js          — Two-stage search (local + live reprice)
│   ├── suppliers/
│   │   ├── bridgify/experiences.js — Bridgify API client
│   │   └── hotelbeds/
│   │       ├── hmac.js             — HMAC-SHA256 signature
│   │       ├── hotels.js           — Hotels API client
│   │       ├── activities.js       — Activities API client
│   │       └── transfers.js        — Transfers API client
│   ├── onboarding/
│   │   ├── manifest.js             — Zod manifest validation
│   │   ├── validation.js           — 6-step sandbox validation
│   │   ├── provisioning.js         — 9-step production provisioning
│   │   └── auto-mapper.js          — Probe + match supplier fields → CTS
│   ├── infra/
│   │   ├── secrets.js              — Encrypted credential store
│   │   └── notify.js               — Email notifications (Resend)
│   └── prompts/library.js          — Prompt template evaluation
├── config/
│   └── dedup.default.json          — Default dedup thresholds
├── docs/
│   ├── ARCHITECTURE.md             — This document
│   ├── DEDUP_ARCHITECTURE.md       — Detailed dedup design
│   └── SEMANTIC_CATALOG_API.md     — Semantic search design
└── partner-dashboard/              — React SPA (separate Vite project)
    └── src/pages/
        ├── Overview.jsx            — Metrics dashboard
        ├── Integrations.jsx        — Supplier sync management
        ├── Inventory.jsx           — Browse/filter inventory
        └── Intelligence.jsx        — Dedup review + LLM judge
```
