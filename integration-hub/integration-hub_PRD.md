# TOS Integration Hub — Product Requirements Document
# Version 2.0 | May 2026 | WanderVault / EMOSS Consulting
# Optimised for Claude Code — authoritative specification

---

## 1. What This Is

The TOS Integration Hub is the L4 execution layer of the Travel Operating
System. It is the single gateway through which all external supplier APIs,
OTA connections, and B2B partner integrations flow into TOS.

### Phase 1 — Delivered (April 2026)
Four integrations across two providers:
- Bridgify Experiences
- HotelBeds Hotels
- HotelBeds Experiences (Tours & Activities)
- HotelBeds Transfers

### Phase 1.5 — Delivered (May 2026)
Extended supplier coverage, intelligence pipeline, partner dashboard, and
self-service onboarding:
- Viator Experiences (Partner API v2, direct)
- Ticketmaster Events (Discovery API, 12-country coverage)
- Duffel Flights (search-on-demand, 22 hub airports × 3 date offsets)
- Full intelligence pipeline: embedding generation → dedup pre-compute →
  LLM judge → attraction clustering → global POI matching → taxonomy sync
- Partner dashboard (React SPA): Overview, Inventory, Transactions,
  Intelligence (dedup/attractions/taxonomy/ranking/eval), System Log, Settings
- Self-service onboarding wizard (9-step) with auto-analysis, sandbox
  validation, credential storage, auto-mapper (deterministic + LLM gap-fill),
  knowledge generation, and auto-sync trigger on promotion
- Public catalog API: semantic search (MiniLM-L6-v2 + pgvector), browse,
  detail, availability, booking — no auth required
- Business ranking engine (6 weighted signals: semantic, popularity, rating,
  margin, availability, supplier priority)
- Gold dataset evaluation framework (stratified sampling, LLM labelling,
  precision/recall/F1 per confidence band)

### Phase 2 — Current (Section 14)
Connect the consumer-facing travel UI to the hub's catalog and booking APIs.
Replace direct-to-supplier calls and mock data with the hub's two-stage
search pipeline, semantic search, and unified booking flow.

---

## 2. TOS Layer Model

| Layer | Owner | Role |
|-------|-------|------|
| L5 | TOS | Intelligence, decisioning |
| L4 | Integration Hub | Execution, orchestration ← THIS COMPONENT |
| L3 | Bridgify | Normalization, schema translation |
| L2 | Bridgify | Connectivity, protocol adapters |
| L1 | Suppliers | Raw APIs (HotelBeds, Bridgify, etc.) |

---

## 3. Architecture Components

### 3.1 API Layer (Express)
- Single entry point for all inbound calls
- Auth: X-Api-Key header validated via bcrypt against hub_tenants.api_key_hash
- Rate limiting: per-tenant from hub_tenants.rate_limit_rpm
- All 19 endpoints defined in Section 10

### 3.2 Router / Dispatch (OpenClaw logic)
- Loads tenant config from hub_tenants (throws if tenant_id missing)
- Classifies task: SYNC | ASYNC | SCHEDULED
- SYNC → Executor (sync.js) — supplier_count <= 2, complexity LOW
- ASYNC → Managed Agent (Claude API) — supplier_count > 2 OR complexity HIGH
- SCHEDULED → triggered by internal scheduler (no cloud scheduler dependency)
- Emits structured JSON log on every dispatch

### 3.3 Executor (Sync)
- Handles: search, detail, availability, book, get, cancel
- For SEARCH: executes two-stage pipeline (see Section 3B.3)
  Stage 1: local filter against hub_static_inventory
  Stage 2: live reprice batched call to supplier
- For BOOK/CANCEL/GET: direct supplier call (no local cache involved)
- Fetches credentials via getSecret() adapter — never AWS SDK directly
- Runs normalization pipeline on live responses
- Writes to hub_transactions (always with tenant_id)
- Returns CTS-normalized response (static content + live pricing merged)

### 3.4 Normalization Pipeline
Four stages applied to every supplier response:
1. PARSE — apply field mappings from mappings/ files
2. ENRICH — resolve codes, infer timezone, preserve supplier_raw_ref
3. NORMALIZE — USD conversion, UTC timestamps, CTS enum mapping
4. VALIDATE — Zod schema validation, log failures, never silently drop

### 3.5 Database (Postgres)
- Connection via DATABASE_URL env var only — never hardcoded
- All queries include WHERE tenant_id = $1 — throw if tenantId missing
- Full schema in Section 9

### 3.6 Secrets Adapter (src/infra/secrets.js)
- Local (NODE_ENV !== 'production'): reads process.env
- Production: reads AWS Secrets Manager
- AWS SDK imported dynamically only in this file — never elsewhere
- All other code calls getSecret(path) — cloud-agnostic interface

### 3.7 Notify Adapter (src/infra/notify.js)
- Wraps Resend API
- Used for: onboarding completion, validation failures, escalations,
  disruption alerts
- Per-tenant sender identity configured in hub_tenants

---

## 3B. Static Inventory Cache — Architecture

### 3B.1 Design Principle

The Integration Hub maintains a local static inventory cache in Postgres
for all Phase 1 suppliers. This cache stores supplier content data that
changes infrequently (hotel names, descriptions, coordinates, experience
categories, transfer routes). Live pricing and availability are always
fetched on-demand — they are never cached.

This hybrid model is both contractually required (HotelBeds TOS prohibits
caching live pricing) and architecturally sound — serving search results
from local data reduces latency from ~3s to ~500ms and enables offline
browsing during supplier outages.

### 3B.2 What Is Cached vs. What Is Always Live

| Data Type | Source | Storage | Refresh |
|-----------|--------|---------|---------|
| Hotel name, description, photos, geo, amenities, star rating | HotelBeds Content API | hub_static_inventory | Nightly full sync |
| Experience name, description, category, duration, location | HotelBeds Activities API / Bridgify | hub_static_inventory | Nightly full sync |
| Transfer routes, vehicle types, origin/destination | HotelBeds Transfers API | hub_static_inventory | Nightly full sync |
| Live room rates, rateKey | HotelBeds Booking API | Never stored | Per search |
| Live availability, seats | All booking APIs | Never stored | Per search |
| Cancellation policies | All booking APIs | Never stored | Per search |
| Booking confirmation | All booking APIs | hub_transactions | At booking time |

### 3B.3 Two-Stage Search Pipeline

Every search request goes through two stages:

```
Stage 1 — Local Filter (target: < 30ms)
  Input: search params (location, category, dates, occupancy, tenant_id)
  Query: hub_static_inventory
    WHERE supplier_slug IN (tenant's approved suppliers)
    AND type = requested_type
    AND is_active = true
    AND geo within radius (PostGIS or haversine)
    AND category matches (if specified)
  Output: up to 100 candidate records with supplier_raw_ref values

Stage 2 — Live Reprice (target: 300-600ms)
  Input: candidate supplier_raw_refs grouped by supplier
  Action: one batched live API call per supplier
  Output: live pricing + availability per candidate
  Merge: attach price/availability to static record
  Filter: remove candidates with no availability

Return: merged CTS results (static content + live pricing)
```

For experiences and transfers where pricing is less volatile, Stage 1
results may be returned immediately with a "prices from X" indicator
while Stage 2 completes asynchronously. Hotels always wait for Stage 2
before returning results (rate key required for booking).

### 3B.4 Offline Dedup

Dedup is pre-computed nightly against the static inventory, not run
under user search latency.

The nightly sync worker, after inserting/updating hub_static_inventory,
runs the composite scoring model across all candidate pairs within the
same tenant's approved suppliers and stores results in hub_dedup_pairs.

At search time, Stage 1 joins hub_dedup_pairs to attach pre-computed
dedup decisions to candidate results. No scoring happens at query time.

```
Nightly:
  For each tenant:
    For each pair of active suppliers with overlapping categories:
      For each record in hub_static_inventory (supplier A):
        Find candidates in supplier B within location_radius_m
        Run composite scoring
        If score >= uncertain threshold: insert/update hub_dedup_pairs

Search time:
  Stage 1 query joins hub_dedup_pairs:
    If result has a pre-computed duplicate → apply strategy immediately
    If result has uncertain pair → return both with dedup metadata
```

### 3B.5 Sync Worker Design

One sync worker per supplier. Workers run independently on a nightly
schedule. Each worker is a standalone Node.js script in src/sync/.

```
src/sync/
  base-sync.js               ← shared sync logic (batch, upsert, error handling)
  hotelbeds-hotels.js        ← fetches HotelBeds Content API
  hotelbeds-experiences.js   ← fetches HotelBeds Activities API
  hotelbeds-transfers.js     ← fetches HotelBeds Transfers API
  bridgify-experiences.js    ← fetches Bridgify content endpoint
  dedup-precompute.js        ← runs after all content syncs complete
```

**Sync worker pattern (base-sync.js):**
```js
// Fetch in pages of 1000 records
// For each page:
//   1. Normalize each record to CTS static shape
//   2. Upsert into hub_static_inventory
//      (ON CONFLICT supplier_slug, supplier_raw_ref DO UPDATE)
//   3. Records not seen in this run → set is_active = false (soft delete)
//   4. Log progress to hub_sync_jobs
//   5. Log individual record errors to hub_sync_errors (do not abort)
// Never abort entire sync on single record failure
// Mark sync complete in hub_sync_jobs regardless of partial errors
```

**Soft delete logic:**
At start of sync, record all existing supplier_raw_refs for this supplier.
At end of sync, any ref not seen in the response → UPDATE is_active = false.
Never hard delete — preserves historical booking references.

### 3B.6 New DB Tables

```sql
-- Static inventory store — CTS-shaped content for all suppliers
CREATE TABLE hub_static_inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug       VARCHAR NOT NULL REFERENCES hub_suppliers(supplier_slug),
  supplier_raw_ref    VARCHAR NOT NULL,
  type                VARCHAR NOT NULL,  -- HOTEL | EXPERIENCE | TRANSFER
  title               VARCHAR NOT NULL,
  description         TEXT,
  latitude            FLOAT,
  longitude           FLOAT,
  city                VARCHAR,
  country             VARCHAR,
  timezone            VARCHAR,
  category            VARCHAR,           -- experience_category for EXPERIENCE
  duration_minutes    INTEGER,           -- EXPERIENCE
  vehicle_class       VARCHAR,           -- TRANSFER
  star_rating         FLOAT,             -- HOTEL
  image_urls          TEXT[],
  amenities           TEXT[],            -- HOTEL
  meal_plans          TEXT[],            -- HOTEL (supported board codes)
  route_origin        VARCHAR,           -- TRANSFER (IATA or location code)
  route_destination   VARCHAR,           -- TRANSFER
  raw_content         JSONB,             -- full supplier response preserved
  is_active           BOOLEAN DEFAULT true,
  last_synced_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(supplier_slug, supplier_raw_ref)
);

-- Indexes for search performance
CREATE INDEX idx_static_inventory_geo
  ON hub_static_inventory (latitude, longitude)
  WHERE is_active = true;

CREATE INDEX idx_static_inventory_supplier_type
  ON hub_static_inventory (supplier_slug, type)
  WHERE is_active = true;

CREATE INDEX idx_static_inventory_category
  ON hub_static_inventory (category)
  WHERE is_active = true;

-- Pre-computed dedup pairs
CREATE TABLE hub_dedup_pairs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  inventory_id_a      UUID NOT NULL REFERENCES hub_static_inventory(id),
  inventory_id_b      UUID NOT NULL REFERENCES hub_static_inventory(id),
  composite_score     FLOAT NOT NULL,
  decision            VARCHAR NOT NULL,  -- DUPLICATE | UNCERTAIN
  signal_location     FLOAT,
  signal_name         FLOAT,
  signal_duration     FLOAT,
  signal_category     FLOAT,
  computed_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, inventory_id_a, inventory_id_b)
);

CREATE INDEX idx_dedup_pairs_tenant_a
  ON hub_dedup_pairs (tenant_id, inventory_id_a);

-- Sync job tracking
CREATE TABLE hub_sync_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug       VARCHAR NOT NULL,
  status              VARCHAR DEFAULT 'RUNNING'
                      CHECK (status IN ('RUNNING','COMPLETE','FAILED')),
  records_fetched     INTEGER DEFAULT 0,
  records_upserted    INTEGER DEFAULT 0,
  records_deactivated INTEGER DEFAULT 0,
  records_errored     INTEGER DEFAULT 0,
  started_at          TIMESTAMPTZ DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  error_message       TEXT
);

-- Per-record sync errors (never abort sync on single failure)
CREATE TABLE hub_sync_errors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id         UUID NOT NULL REFERENCES hub_sync_jobs(id),
  supplier_raw_ref    VARCHAR,
  error_message       TEXT NOT NULL,
  raw_record          JSONB,
  created_at          TIMESTAMPTZ DEFAULT now()
);
```

### 3B.7 Search Pipeline Implementation

```js
// src/search/pipeline.js

export const search = async (params, tenant) => {

  // Stage 1 — Local filter
  const candidates = await db.query(`
    SELECT
      si.*,
      dp.composite_score as dedup_score,
      dp.decision as dedup_decision,
      dp.inventory_id_b as dedup_pair_id
    FROM hub_static_inventory si
    LEFT JOIN hub_dedup_pairs dp
      ON dp.inventory_id_a = si.id
      AND dp.tenant_id = $1
    JOIN hub_tenant_suppliers ts
      ON ts.supplier_slug = si.supplier_slug
      AND ts.tenant_id = $1
      AND ts.is_active = true
    WHERE si.type = $2
      AND si.is_active = true
      AND (
        6371000 * acos(
          cos(radians($3)) * cos(radians(si.latitude)) *
          cos(radians(si.longitude) - radians($4)) +
          sin(radians($3)) * sin(radians(si.latitude))
        )
      ) <= $5
    LIMIT 100
  `, [tenant.id, params.type, params.lat, params.lng, params.radius_m]);

  if (candidates.rows.length === 0) return [];

  // Stage 2 — Live reprice
  const bySupplier = groupBy(candidates.rows, 'supplier_slug');
  const liveResults = await Promise.all(
    Object.entries(bySupplier).map(([slug, records]) =>
      repriceFromSupplier(slug, records, params, tenant)
    )
  );

  // Merge static + live
  return mergePricedResults(candidates.rows, liveResults.flat(), tenant);
};
```

### 3B.8 Estimated Static Inventory Size

| Supplier | Type | Est. Records | Sync Duration |
|----------|------|-------------|---------------|
| HotelBeds Hotels | HOTEL | ~300,000 | 2-4 hours |
| HotelBeds Experiences | EXPERIENCE | ~18,000 | 15-30 min |
| HotelBeds Transfers | TRANSFER | ~24,000 routes | 20-40 min |
| Bridgify Experiences | EXPERIENCE | TBC | TBC |
| **Total** | | **~342,000+** | **~5 hours max** |

Postgres with correct indexes handles this comfortably. No separate
search infrastructure (Elasticsearch etc.) needed for Phase 1.

### 3B.9 Failure Modes

| Scenario | Search Behaviour | Booking Behaviour |
|----------|-----------------|-------------------|
| Supplier API down | Stage 1 returns static results with "live prices unavailable" flag | Blocked — cannot book without live price |
| Partial supplier failure | Results from healthy suppliers returned | Only healthy suppliers bookable |
| Sync worker fails | Stale static data served (last successful sync) | Live pricing still works |
| DB slow | Stage 1 degraded — reduce candidate limit to 20 | Unaffected |

### 3B.10 Licensing Boundaries

**What we CAN cache per HotelBeds contract:**
- Hotel names, descriptions, photos, coordinates, amenities
- Activity names, descriptions, categories, duration
- Transfer routes and vehicle types

**What we CANNOT cache:**
- Room rates or rateKeys
- Live availability counts
- Cancellation policies (these change with rate)
- Any field returned by the Booking API (not Content API)

Bridgify: confirm caching rights with Bridgify technical contact.
Add TODO in sync worker until confirmed.


---

## 4. Supplier Integrations

### 4.1 Bridgify — Experiences

| Field | Value |
|-------|-------|
| Auth | API Key — header: X-Api-Key |
| Sandbox base URL | TBC — set via BRIDGIFY_BASE_URL env var |
| Env vars | BRIDGIFY_API_KEY, BRIDGIFY_BASE_URL |
| CTS type | EXPERIENCE |
| supplier_slug | bridgify |

**Operations:**

| Operation | Method | Endpoint | Execution |
|-----------|--------|----------|-----------|
| search | GET | /experiences/search | Sync |
| detail | GET | /experiences/:id | Sync |
| availability | GET | /experiences/:id/availability | Sync |
| book | POST | /bookings | Sync |
| get | GET | /bookings/:ref | Sync |
| cancel | DELETE | /bookings/:ref | Sync |

**CTS Field Mappings:**

| Supplier Field | CTS Field | Transform |
|----------------|-----------|-----------|
| id | supplier_raw_ref | none |
| title | title | none |
| duration_minutes | duration_minutes | integer |
| category | experience_category | map via hub_schema_mappings |
| price.amount | price.original_amount | none |
| price.currency | price.original_currency | none |
| price.amount | price.amount_usd | convert via fx.js |
| location.lat | origin.latitude | float |
| location.lng | origin.longitude | float |
| location.city | origin.city | none |
| location.country | origin.country | none |
| status | availability.status | AVAILABLE→CONFIRMED, LIMITED→LOW_AVAILABILITY, UNAVAILABLE→SOLD_OUT |
| cancellation.free_until | policies.cancellation.free_until | ISO8601 |
| cancellation.penalties | policies.cancellation.penalty_schedule | array map |

---

### 4.2 HotelBeds — Experiences (Tours & Activities)

| Field | Value |
|-------|-------|
| Auth | HMAC-SHA256 per request |
| Sandbox base URL | https://api.test.hotelbeds.com/activity-api/1.0 |
| Production base URL | https://api.hotelbeds.com/activity-api/1.0 |
| Env vars | HOTELBEDS_API_KEY, HOTELBEDS_SECRET_KEY |
| CTS type | EXPERIENCE |
| supplier_slug | hotelbeds-activities |

**HMAC Signature (computed on every request):**
```js
import { createHash } from 'crypto';
const ts = Math.floor(Date.now() / 1000).toString();
const sig = createHash('sha256')
  .update(API_KEY + SECRET_KEY + ts).digest('hex');
// Required headers: X-Api-Key, X-Signature, X-Timestamp
```

**Operations:**

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| search | GET | /activities | Returns modalities array |
| detail | GET | /activities/:activityCode | Full description + media |
| availability | GET | /activities?date=... | Per-modality availability |
| book | POST | /bookings | Returns bookingReference |
| confirm | POST | /bookings/:ref/confirmation | Two-step: book then confirm |
| get | GET | /bookings/:ref | Booking status |
| cancel | DELETE | /bookings/:ref | Returns cancellation status |

**CTS Field Mappings:**

| Supplier Field | CTS Field | Notes |
|----------------|-----------|-------|
| activityCode | supplier_raw_ref | Required for book + confirm |
| modality.name | title | Each modality = separate CTSTravelOption |
| modality.duration.value | duration_minutes | Convert hours to minutes if needed |
| category.code | experience_category | Map via hub_schema_mappings |
| modality.amounts[0].amount | price.original_amount | EUR |
| — | price.original_currency | Hardcode "EUR" |
| modality.amounts[0].amount | price.amount_usd | Convert via fx.js |
| location.longitude | origin.longitude | float |
| location.latitude | origin.latitude | float |
| location.description | origin.city | Extract city from description |
| cancellationPolicies | policies.cancellation.penalty_schedule | Map hoursBeforeDateTime + penalty% |
| modality.availabilityQuota | availability.seats | integer |

**Important:** Each modality within an activity response is a separate
CTSTravelOption. If an activity has 3 modalities, emit 3 CTSTravelOption
objects, all sharing the same activityCode as supplier_raw_ref.

---

### 4.3 HotelBeds — Hotels

| Field | Value |
|-------|-------|
| Auth | HMAC-SHA256 (same utility as Activities) |
| Booking API sandbox | https://api.test.hotelbeds.com/hotel-api/1.2 |
| Content API sandbox | https://api.test.hotelbeds.com/hotel-content-api/1.0 |
| Booking API production | https://api.hotelbeds.com/hotel-api/1.2 |
| Env vars | HOTELBEDS_API_KEY, HOTELBEDS_SECRET_KEY |
| CTS type | HOTEL |
| supplier_slug | hotelbeds-hotels |

**Operations:**

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| search | POST | /hotel-api/1.2/hotels | Returns rooms per hotel |
| content | GET | /hotel-content-api/1.0/hotels/:code | Static — cache 24hr in hotel_content |
| checkrates | POST | /hotel-api/1.2/checkrates | MANDATORY before every book |
| book | POST | /hotel-api/1.2/bookings | |
| get | GET | /hotel-api/1.2/bookings/:ref | |
| cancel | DELETE | /hotel-api/1.2/bookings/:ref | |

**CTS Field Mappings:**

| Supplier Field | CTS Field | Notes |
|----------------|-----------|-------|
| hotel.rooms[].rates[].rateKey | supplier_raw_ref | CRITICAL: expires ~15min |
| hotel.name | title | from content cache |
| hotel.rooms[].rates[].boardCode | meal_plan | RO/BB/HB/FB/AI |
| hotel.rooms[].rates[].net | price.net_amount_usd | B2B net rate |
| hotel.rooms[].rates[].net | price.amount_usd | Use net for B2B |
| hotel.rooms[].rates[].currency | price.original_currency | |
| hotel.latitude | origin.latitude | from content |
| hotel.longitude | origin.longitude | from content |
| hotel.countryCode | origin.country | |
| hotel.city.content | origin.city | |
| hotel.rooms[].rates[].cancellationPolicies | policies.cancellation.penalty_schedule | |
| hotel.rooms[].rates[].rooms | availability.rooms | integer |

**Rate Key Expiry Rule:**
rateKey must be re-validated via checkrates if > 10 minutes have passed
since the search. Always call checkrates immediately before book.

**Caching Rules:**
- hotel_content (static): cache in RDS hotel_content table, TTL 24hr.
  Query hotel_content first; only call Content API on cache miss.
- Rate keys: NEVER cache. Always from live search → checkrates → book.
- Search results: no caching in Phase 1. Add TODO comment.

**Net Pricing for B2B:**
HotelBeds returns net (wholesale) rates for B2B API partners.
Set price.net_amount_usd = hotel.rooms[].rates[].net
Set price.markup_applied = false
Set price.amount_usd = price.net_amount_usd (L5 applies markup)

---

### 4.4 HotelBeds — Transfers

| Field | Value |
|-------|-------|
| Auth | HMAC-SHA256 (same utility) |
| Sandbox base URL | https://api.test.hotelbeds.com/transfer-api/1.0 |
| Production base URL | https://api.hotelbeds.com/transfer-api/1.0 |
| Env vars | HOTELBEDS_API_KEY, HOTELBEDS_SECRET_KEY |
| CTS type | TRANSFER |
| supplier_slug | hotelbeds-transfers |

**Operations:**

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| search | GET | /transfers/availability | |
| detail | GET | /transfers/:id | Vehicle + route detail |
| book | POST | /bookings | Requires passenger manifest |
| get | GET | /bookings/:ref | |
| cancel | DELETE | /bookings/:ref | |
| return_search | GET | /transfers/availability | Separate call, link via trip_id |

**CTS Field Mappings:**

| Supplier Field | CTS Field | Notes |
|----------------|-----------|-------|
| transfer.id | supplier_raw_ref | |
| transfer.category | type | SHUTTLE→SHARED_TRANSFER, PRIVATE→PRIVATE_TRANSFER, LUXURY→LUXURY_TRANSFER |
| transfer.vehicle.code | vehicle_class | SEDAN, VAN, MINIBUS, BUS |
| transfer.price.totalAmount | price.original_amount | |
| transfer.price.currency | price.original_currency | |
| transfer.price.totalAmount | price.amount_usd | convert via fx.js |
| transfer.origin.code | origin.iata_code | if airport |
| transfer.origin.type | origin.type | AIRPORT/HOTEL/COORDINATES |
| transfer.destination.code | destination.iata_code | if airport |
| transfer.vehicle.maxPax | availability.max_passengers | |
| transfer.cancellationPolicies | policies.cancellation.penalty_schedule | |
| — | transfer_meta.trip_id | UUID generated by TOS at search time |
| flightNumber (booking param) | transfer_meta.inbound_flight | |
| transfer.pickupInformation.type | transfer_meta.pickup_type | MEET_AND_GREET / CURBSIDE |

**Return Transfer Rule:**
Outbound and return transfers are separate API calls.
At search time, generate a UUID trip_id.
Set transfer_meta.trip_id = trip_id on both CTSTravelOption objects.
Set transfer_meta.return_trip_id on outbound, pointing to return option_id.

**Per-Passenger Equivalent:**
HotelBeds charges per vehicle. Compute and store:
per_passenger_equivalent = price.amount_usd / availability.max_passengers
Store in a supplementary display field (not core CTS — add as metadata).


### 4.5 Viator — Experiences (Added Phase 1.5)

| Field | Value |
|-------|-------|
| Auth | API Key — header: exp-api-key |
| Base URL | https://api.viator.com/partner |
| Env vars | VIATOR_API_KEY |
| CTS type | EXPERIENCE |
| supplier_slug | viator, viator-direct |

**Operations:** search, detail, availability, book, cancel.

**Key details:**
- Partner API v2 — entity hierarchy: destinations → attractions → products
- Product taxonomy: 5-level category tree (~300 categories)
- Sync: taxonomy → products by destination, paginated (1-500 per page)
- Two slugs: `viator` (via Bridgify), `viator-direct` (Partner API)
- Vendor knowledge: `config/vendors/viator-direct.json` + `.md`

### 4.6 Ticketmaster — Events (Added Phase 1.5)

| Field | Value |
|-------|-------|
| Auth | API Key — query param: `apikey` |
| Base URL | https://app.ticketmaster.com/discovery/v2 |
| Env vars | TICKETMASTER_API_KEY |
| CTS type | EXPERIENCE (events) |
| supplier_slug | ticketmaster |

**Operations:** search (read-only catalog; booking via external URL).

**Key details:**
- Discovery API — GET-only, query-param auth
- 12-country coverage: US, GB, CA, AU, DE, FR, ES, IT, NL, IE, MX, NZ
- Sync: 6 classification shards × 12 countries, sorted by relevance (desc)
- Pagination cap: pages 0–5 × 200 = 1,200 results per shard
- Rate limit: 5,000 requests/day (quota, not rpm)
- Events have occurrence dates — synced as `is_event = true` with date in
  `raw_content`
- Response envelope: `_embedded.events[]`
- Vendor knowledge: `config/vendors/ticketmaster.json` + `.md`

### 4.7 Duffel — Flights (Added Phase 1.5)

| Field | Value |
|-------|-------|
| Auth | Bearer token + `Duffel-Version: v2` header |
| Base URL | https://api.duffel.com |
| Env vars | DUFFEL_ACCESS_TOKEN |
| CTS type | FLIGHT |
| supplier_slug | duffel |

**Operations:** search (live offer requests; offers expire in minutes).

**Key details:**
- Search-on-demand API — no static catalog. Offers are live-priced and
  expire quickly (~30 minutes)
- Sync strategy: snapshot of popular routes for browse/discovery. 22 hub
  airports across 12 countries (same as Ticketmaster), all cross-hub pairs
  (231 routes), 3 date offsets (7/14/30 days), cheapest 5 offers per
  route+date. ~3,400 offers per sync run
- Economy cabin, one-way, single adult, max 1 connection
- Rate limit: 120 req/min; sync uses 600ms delay between requests
- Response envelope: `data.offers[]`
- For booking: user must search live (offers expire); cached data is
  browse-only
- Vendor knowledge: `config/vendors/duffel.json` + `.md`


---

## 5. Dedup Configuration

### 5.1 Default Config File
Path: /config/dedup.default.json (committed to repo — NOT in cloud storage)

```json
{
  "version": "1.0",
  "description": "TOS default dedup configuration for experience inventory",
  "strategy": "LOWEST_PRICE",
  "preferred_supplier": null,
  "thresholds": {
    "location_radius_m": 150,
    "name_similarity_min": 0.75,
    "duration_variance_pct": 20,
    "composite_score_duplicate": 0.80,
    "composite_score_uncertain": 0.60
  },
  "weights": {
    "location": 0.35,
    "name": 0.40,
    "duration": 0.15,
    "category": 0.10
  },
  "uncertain_behavior": "SHOW_BOTH",
  "test_mode": false,
  "test_log_destination": "rds"
}
```

### 5.2 Config Merge Logic
At agent session start, OpenClaw calls src/dedup/config.js:
1. Load /config/dedup.default.json (fs.readFileSync — sync OK at startup)
2. Query hub_dedup_config WHERE tenant_id = $1 AND is_active = true
3. If tenant row found: deep merge config_json on top of default
   (tenant values win field-by-field, not entire object replacement)
4. Return merged config object

### 5.3 Composite Scoring Implementation
```js
// src/dedup/engine.js
import Fuse from 'fuse.js';
import { getDistance } from 'geolib';

// Name normalization — strip before fuzzy matching
const STOP_WORDS = ['tour','experience','visit','skip','the','a','an',
  'line','access','priority','guided','private','group','day',
  'half','full','ticket','trip','excursion'];

export const normalizeName = (name) =>
  name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => !STOP_WORDS.includes(w))
    .join(' ')
    .trim();

export const scoreDedup = (a, b, cfg) => {
  // Location signal
  const distM = (a.origin?.latitude && b.origin?.latitude)
    ? getDistance(
        { lat: a.origin.latitude, lon: a.origin.longitude },
        { lat: b.origin.latitude, lon: b.origin.longitude }
      )
    : Infinity;
  const locationFires = distM <= cfg.thresholds.location_radius_m;

  // Name signal
  const fuse = new Fuse(
    [{ n: normalizeName(b.title || '') }],
    { keys: ['n'], includeScore: true, threshold: 1.0 }
  );
  const nameResult = fuse.search(normalizeName(a.title || ''));
  const rawSim = nameResult[0] ? 1 - nameResult[0].score : 0;
  const nameContributes = rawSim >= cfg.thresholds.name_similarity_min;

  // Duration signal
  const aDur = a.duration_minutes || 0;
  const bDur = b.duration_minutes || 0;
  const durationFires = aDur > 0 && bDur > 0 &&
    Math.abs(aDur - bDur) / Math.max(aDur, bDur)
      <= cfg.thresholds.duration_variance_pct / 100;

  // Category signal
  const categoryMatch = !!(a.experience_category &&
    a.experience_category === b.experience_category);

  const score =
    (locationFires    ? cfg.weights.location : 0) +
    (nameContributes  ? rawSim * cfg.weights.name : 0) +
    (durationFires    ? cfg.weights.duration : 0) +
    (categoryMatch    ? cfg.weights.category : 0);

  if (score >= cfg.thresholds.composite_score_duplicate) return 'DUPLICATE';
  if (score >= cfg.thresholds.composite_score_uncertain) return 'UNCERTAIN';
  return 'DISTINCT';
};
```

### 5.4 Strategy Outcomes

| Decision | Strategy | Action |
|----------|----------|--------|
| DUPLICATE | LOWEST_PRICE | Return lower price option. Log suppressed option to hub_transactions with status=DEDUP_SUPPRESSED |
| DUPLICATE | PREFERRED_SUPPLIER | Return preferred supplier option regardless of price. Log other as DEDUP_SUPPRESSED |
| DUPLICATE | SHOW_ALL | Return both. Set is_duplicate_of on higher-priced option pointing to lower-priced option_id |
| UNCERTAIN | SHOW_BOTH | Return both with dedup_score and candidate_pair_id (shared UUID linking the pair) |
| UNCERTAIN | ESCALATE | Write to hub_escalations. Return both to caller immediately with escalation_pending=true in meta |
| UNCERTAIN | AGENT_DECIDE | Apply inventory.dedup.uncertain prompt. Agent makes final DUPLICATE/DISTINCT call |
| DISTINCT | any | Return both independently. No linkage. |

**Test Mode:**
When cfg.test_mode = true, write every scoring decision to hub_dedup_test_log
regardless of outcome. Include all four signal values, composite score,
decision, and strategy_applied. Results returned to caller are unaffected.

---

## 6. Prompt Library

### 6.1 hub_prompts Table
See Section 9 for DDL. Key fields:
- prompt_key: unique dotted identifier
- category: INVENTORY | INTEGRATION | PRICING | POLICY
- trigger_condition: string evaluated by library.js against context
- prompt_template: parameterized text with {variable} slots
- escalate_to_human: if true, write to hub_escalations + notify

### 6.2 Trigger Condition Evaluation
src/prompts/library.js evaluates trigger_condition as a simple expression
against a context object. Use a safe eval approach — support these operators:
- Property access: context.dedup_score >= 0.60
- Comparisons: >, <, >=, <=, ===, !==
- Boolean: AND, OR, NOT
- Null checks: IS_NULL(context.duration_minutes)

### 6.3 Full Prompt Seed Data
Insert all 15 prompts in migrations/002_seed_prompts.sql:

```sql
INSERT INTO hub_prompts
  (prompt_key, category, trigger_condition, prompt_template,
   escalate_to_human, is_active) VALUES

-- INVENTORY PROMPTS

('inventory.dedup.uncertain',
 'INVENTORY',
 'context.dedup_score >= 0.60 AND context.dedup_score < 0.80 AND context.uncertain_behavior === "AGENT_DECIDE"',
 'Two experience results have a dedup score of {dedup_score} — uncertain range.
Product A: "{title_a}" from {supplier_a}, operator: {operator_a}
Product B: "{title_b}" from {supplier_b}, operator: {operator_b}
If the operator names match exactly (case-insensitive), treat as DUPLICATE.
Otherwise treat as DISTINCT. Return your decision as JSON:
{"decision": "DUPLICATE" | "DISTINCT", "reasoning": "..."}',
 false, true),

('inventory.experience.no_duration',
 'INVENTORY',
 'IS_NULL(context.duration_minutes) AND context.type === "EXPERIENCE"',
 'The experience "{title}" from {supplier} has no duration field.
Scan the description for duration mentions. Patterns to match:
- "X hours" or "X-hour" → X * 60 minutes
- "half day" → 240 minutes
- "full day" or "whole day" → 480 minutes
- "X minutes" → X minutes
Description: "{description}"
Return JSON: {"duration_minutes": <integer> | null, "source": "extracted" | "not_found"}',
 false, true),

('inventory.experience.zero_results',
 'INVENTORY',
 'context.result_count === 0 AND context.other_supplier_count > 0',
 'Supplier {supplier} returned 0 results for search in {destination}.
The other supplier returned {other_supplier_count} results.
Check if this is an expected coverage gap or an anomaly.
Known low-coverage suppliers for this region: {low_coverage_suppliers}
If this is an expected gap: return {"action": "LOG", "reason": "coverage_gap"}
If unexpected: return {"action": "FLAG", "reason": "SUPPLIER_ANOMALY"}',
 false, true),

('inventory.policy.missing_cancellation',
 'INVENTORY',
 'IS_NULL(context.cancellation_policy) AND context.operation === "normalize"',
 'The result "{title}" from {supplier} has no cancellation policy.
Tenant default policy: {tenant_default_policy}
TOS platform default: NON_REFUNDABLE
Apply in order: tenant default if set, else platform default.
Return JSON: {"policy_source": "TENANT_DEFAULT" | "PLATFORM_DEFAULT",
"policy": {"type": "NON_REFUNDABLE" | "FREE_CANCELLATION", "free_until": null}}',
 false, true),

('inventory.experience.category_mismatch',
 'INVENTORY',
 'context.category_a !== context.category_b AND context.decision === "DUPLICATE"',
 'Two confirmed duplicate experiences have different CTS categories.
Product A category: {category_a} (from {supplier_a})
Product B category: {category_b} (from {supplier_b})
Rules:
1. If one is more specific (e.g. FOOD vs CULTURE for a cooking class) → use more specific
2. If genuinely ambiguous → use Bridgify category as authoritative
3. Bridgify slug is "bridgify"
Return JSON: {"category": "<chosen_category>", "reason": "..."}',
 false, true),

-- INTEGRATION PROMPTS

('integration.supplier.high_latency',
 'INTEGRATION',
 'context.response_time_ms > 3000',
 'Supplier {supplier} response time is {response_time_ms}ms (threshold: 3000ms).
Other supplier has returned results: {other_results_available}
Rules:
- If other supplier has results: return partial results now, log latency event
- If this is the only supplier: wait up to 8000ms total, then timeout
Current elapsed time: {elapsed_ms}ms
Return JSON: {"action": "PARTIAL_RETURN" | "WAIT" | "TIMEOUT",
"reason": "..."}',
 false, true),

('integration.supplier.partial_results',
 'INTEGRATION',
 'context.results_truncated === true OR context.result_count < context.expected_min',
 'Supplier {supplier} returned truncated or insufficient results.
Result count: {result_count}, expected minimum: {expected_min}
Truncation flag: {results_truncated}
If result_count >= 3: return with meta.results_truncated = true
If result_count < 3: retry with relaxed params:
  - Expand location radius by 20%
  - Expand date range by +/- 1 day
Return JSON: {"action": "RETURN_PARTIAL" | "RETRY_RELAXED",
"relaxed_params": {...} | null}',
 false, true),

('integration.supplier.auth_failure',
 'INTEGRATION',
 'context.http_status === 401 OR context.http_status === 403',
 'Supplier {supplier} returned auth failure (HTTP {http_status}).
Immediately stop all calls to this supplier for this session.
Log auth_failure event. Return results from remaining suppliers only.
Return JSON: {"action": "STOP_SUPPLIER", "supplier": "{supplier}",
"session_note": "auth_failure — {supplier} excluded from results"}',
 true, true),

('integration.supplier.unexpected_format',
 'INTEGRATION',
 'context.normalization_failed === true',
 'Normalization failed for {failure_count} results from {supplier}.
Total results attempted: {total_count}
Failure rate: {failure_rate_pct}%
Failed fields: {failed_fields}
If failure_rate_pct > 20: escalate as SYSTEMATIC_FORMAT_CHANGE
If failure_rate_pct <= 20: exclude failed results, continue with passing ones
Return JSON: {"action": "EXCLUDE_FAILED" | "ESCALATE_SYSTEMATIC",
"excluded_count": {failure_count}}',
 false, true),

('integration.hotelbeds.rate_key_expiry_risk',
 'INTEGRATION',
 'context.supplier === "hotelbeds-hotels" AND context.minutes_since_search > 10',
 'HotelBeds rate key may have expired. Time since search: {minutes_since_search} minutes.
Rate keys expire after approximately 15 minutes.
Action: automatically trigger checkrates before proceeding to booking.
If checkrates shows price change > 5%: surface price change to caller before confirming.
If price unchanged or change <= 5%: proceed to booking silently.
Return JSON: {"action": "CHECKRATES_REQUIRED", "price_change_threshold_pct": 5}',
 false, true),

-- PRICING PROMPTS

('pricing.extreme_delta',
 'PRICING',
 'context.decision === "DUPLICATE" AND context.price_delta_pct > 40',
 'Confirmed duplicate products have a {price_delta_pct}% price difference.
Product A: "{title_a}" — {price_a} USD from {supplier_a}
Product B: "{title_b}" — {price_b} USD from {supplier_b}
This exceeds the 40% anomaly threshold.
Do NOT automatically suppress the higher price.
Return both with pricing_anomaly = true and delta_pct = {price_delta_pct}.
Return JSON: {"action": "FLAG_ANOMALY", "return_both": true,
"pricing_anomaly": true, "delta_pct": {price_delta_pct}}',
 false, true),

('pricing.fx_rate_missing',
 'PRICING',
 'IS_NULL(context.fx_rate) AND context.currency !== "USD"',
 'Cannot normalize price for "{title}" from {supplier}.
Currency {currency} has no FX rate in the local rate table.
Do NOT use a stale or estimated rate — this could cause pricing errors.
Halt normalization for this result only. Other results unaffected.
Return JSON: {"action": "HALT_RESULT", "reason": "UNKNOWN_CURRENCY",
"currency": "{currency}"}',
 true, true),

('pricing.net_retail_ambiguity',
 'PRICING',
 'context.supplier === "hotelbeds-hotels" AND context.net_flag_missing === true AND context.amount_usd > context.expected_max_usd',
 'HotelBeds hotel result for "{title}" has unexpectedly high amount: {amount_usd} USD.
Net rate flag is missing. Tenant tier: {tenant_tier}
If tenant tier is ENTERPRISE or GROWTH (B2B net pricing expected):
  flag as PRICING_TYPE_UNCERTAIN, include in results with warning
If tenant tier is STARTER:
  treat as retail price, no warning needed
Return JSON: {"action": "FLAG_UNCERTAIN" | "TREAT_AS_RETAIL",
"pricing_type": "UNCERTAIN" | "RETAIL"}',
 false, true),

-- POLICY PROMPTS

('policy.conflicting_cancellation',
 'POLICY',
 'context.decision === "DUPLICATE" AND context.policies_conflict === true',
 'Confirmed duplicate products have conflicting cancellation policies.
Policy A from {supplier_a}: free until {free_until_a}, penalties: {penalties_a}
Policy B from {supplier_b}: free until {free_until_b}, penalties: {penalties_b}
Apply the MORE RESTRICTIVE policy (earlier deadline, higher penalties).
Log both original policies in hub_transactions for audit.
Return JSON: {"chosen_policy": <more_restrictive_policy_object>,
"policy_source": "CONFLICT_RESOLVED_RESTRICTIVE",
"discarded_policy": <less_restrictive_policy_object>}',
 false, true),

('policy.free_cancellation_deadline_past',
 'POLICY',
 'context.free_until_is_past === true',
 'The free cancellation deadline for "{title}" has already passed.
free_until: {free_until} (now: {current_time})
Update availability.status to CANCELLATION_FEE_APPLIES.
Do not filter or hide the result — still return it.
Ensure the displayed cancellation policy reflects current state.
Return JSON: {"action": "UPDATE_STATUS",
"availability_status": "CANCELLATION_FEE_APPLIES"}',
 false, true);
```

---

## 7. Integration Onboarding Flow

### 7.1 Integration Manifest — Full Structure

```json
{
  "manifest_version": "1.0",
  "supplier": {
    "name": "string — display name",
    "slug": "string — URL-safe, lowercase, hyphens e.g. viator",
    "categories": ["EXPERIENCE"],
    "base_url_sandbox": "https://...",
    "base_url_production": "https://...",
    "documentation_url": "https://... (agent fetches this)",
    "support_contact": "string"
  },
  "auth": {
    "type": "API_KEY | HMAC_SHA256 | OAUTH2 | BASIC",
    "credential_fields": ["api_key"],
    "signature_algorithm": "SHA256",
    "signature_inputs": ["key", "secret", "timestamp"],
    "token_endpoint": null
  },
  "operations": {
    "search": {
      "method": "GET",
      "endpoint": "/path",
      "request_schema": {},
      "response_schema": {}
    },
    "detail":       { "method": "GET",    "endpoint": "/path/:id", "request_schema": {}, "response_schema": {} },
    "availability": { "method": "GET",    "endpoint": "/path",     "request_schema": {}, "response_schema": {} },
    "book":         { "method": "POST",   "endpoint": "/path",     "request_schema": {}, "response_schema": {} },
    "get":          { "method": "GET",    "endpoint": "/path/:ref","request_schema": {}, "response_schema": {} },
    "cancel":       { "method": "DELETE", "endpoint": "/path/:ref","request_schema": {}, "response_schema": {} }
  },
  "rate_limit_rpm": 60,
  "response_format": "JSON",
  "supports_webhooks": false,
  "webhook_events": [],
  "cts_mapping": {
    "type_value": "EXPERIENCE",
    "field_mappings": [
      { "source": "supplier.fieldName", "target": "CTS.fieldName", "transform": "fn_name | null" }
    ],
    "status_mappings": {
      "AVAILABLE": "CONFIRMED",
      "FULL": "SOLD_OUT"
    },
    "default_currency": "EUR",
    "category_mappings": {
      "SPORT": "SPORT",
      "CULTURE": "CULTURE"
    }
  },
  "execution_profile": {
    "sync_operations": ["search", "detail", "availability", "book", "get", "cancel"],
    "async_operations": [],
    "avg_response_time_ms": 800
  },
  "test_suite": {
    "sandbox_search_params": {},
    "expected_result_count_min": 1,
    "test_booking_ref": null
  },
  "tenant_config": {
    "tenant_id": "ALWAYS overwritten server-side with authenticated caller tenant_id",
    "sla_tier": "ENTERPRISE | GROWTH | STARTER",
    "preferred_for_categories": []
  }
}
```

**Required fields for validation (Zod):**
- supplier.name, supplier.slug, supplier.categories (min 1)
- supplier.base_url_sandbox
- auth.type, auth.credential_fields (min 1)
- operations must include at minimum: search AND book
- cts_mapping.field_mappings (min 1 entry)
- test_suite.sandbox_search_params (non-empty object)

### 7.2 API Onboarding Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /v1/integrations/onboard | POST | Submit manifest (partial or complete). Returns { session_id } |
| /v1/integrations/onboard/:id | GET | Poll session. Returns { status, manifest, validation_report } |
| /v1/integrations/onboard/:id/manifest | PATCH | Correct manifest fields during session |
| /v1/integrations/onboard/:id/confirm | POST | Trigger sandbox validation |
| /v1/integrations/onboard/:id/promote | POST | Promote to production (only if validation passed) |
| /v1/integrations | GET | List active integrations for tenant |
| /v1/integrations/:slug | DELETE | Deactivate integration |

### 7.3 Sandbox Validation Pipeline — 6 Steps

Each step has a retry budget. Between retries: diagnose the error type,
apply a targeted fix to the manifest or params, log the attempt.

| Step | Test | Pass Criteria | Retries | On Budget Exhausted |
|------|------|---------------|---------|---------------------|
| 1 | Auth — lightweight request | HTTP 200, no 401/403 | 3 | Write VALIDATION_FAILURE_REPORT, halt |
| 2 | Search — run sandbox_search_params | HTTP 200, results >= expected_min | 3 | Write report, halt |
| 3 | CTS normalization | > 95% of results pass Zod | 3 (no new API call) | Write report, halt |
| 4 | Detail fetch — first result | HTTP 200, enriched fields present | 2 | Mark OPTIONAL, continue |
| 5 | Booking test — by test_booking_ref | HTTP 200, normalizes to CTS | 2 | Mark UNTESTED, continue |
| 6 | Cancel sim — if test booking exists | HTTP 200 or 204 | 2 | Mark UNTESTED, continue |

**Promotion gate:** Steps 1-3 must pass. Steps 4-6 may be UNTESTED.
No manual override — if steps 1-3 fail after retries, promote is blocked.

### 7.4 Provisioning Pipeline — 9 Steps (on /promote)

Execute sequentially. Each step is idempotent (safe to re-run on failure).

| Step | Action | Target |
|------|--------|--------|
| 1 | INSERT hub_suppliers row from manifest.supplier + auth | hub_suppliers |
| 2 | INSERT hub_schema_mappings rows from manifest.cts_mapping | hub_schema_mappings |
| 3 | Create empty Secrets Manager paths for prod credentials | infra/secrets.js |
| 4 | INSERT hub_tool_contracts for each operation in manifest | hub_tool_contracts |
| 5 | INSERT hub_dedup_config with SHOW_ALL strategy (safe default) | hub_dedup_config |
| 6 | INSERT hub_integration_tests from manifest.test_suite | hub_integration_tests |
| 7 | INSERT hub_tenant_suppliers linking tenant to supplier | hub_tenant_suppliers |
| 8 | Send completion email via notify adapter | Resend |
| 9 | Log NEW_INTEGRATION_PROVISIONED to stdout as structured JSON | stdout |

### 7.5 Prompt Path — 8 Conversation Stages

Managed by src/agents/onboarding.js. Persist manifest to
hub_onboarding_sessions after every stage.

| Stage | Agent Does | Human Provides |
|-------|-----------|----------------|
| 1. Identity | Asks for supplier name + categories. If doc URL provided: fetches + parses docs. Summarises endpoints, auth, format found. | Name, categories, doc URL |
| 2. Auth | Proposes auth type + credential fields from docs. Shows Secrets Manager path that will be created. | Confirm or correct fields. Provide sandbox credentials (written to Secrets Manager immediately — never logged) |
| 3. API Contract | Presents each operation endpoint + schema from docs. Asks: correct? Unsupported operations? | Confirm or correct each operation |
| 4. CTS Mapping | Proposes full field mapping table from response schemas. | Review table, correct mismatches, add missed fields |
| 5. Test Config | Asks for sandbox_search_params JSON. Confirms expected min result count. | Provide search params |
| 6. Tenant Config | States SLA tier from tenant record. Asks for preferred categories. | Confirm tier, specify preferred categories if any |
| 7. Review | Presents complete assembled manifest as structured summary. | Final confirmation |
| 8. Validate & Promote | Runs sandbox validation. Reports results. Asks to promote on pass. | Confirm promotion |

**Doc Fetch Implementation:**
Use axios.get(documentation_url, { timeout: 15000 }).
Extract from response body: endpoint paths, HTTP methods, request params,
response field names and types, auth header names, rate limit headers.
Propose field_mappings by matching response field names to CTS field names
using string similarity — present as a table for human review.

---

## 8. Agent Design

### 8.1 OpenClaw Dispatch Rules

| Condition | Route |
|-----------|-------|
| supplier_count <= 2 AND complexity = LOW | SYNC → Executor |
| supplier_count > 2 OR complexity = HIGH | ASYNC → Claude Managed Agent |
| Internal scheduler fires | SCHEDULED → appropriate agent type |

Note: no cloud scheduler (EventBridge etc.) — scheduling handled internally.

### 8.2 Agent Types (Phase 1)

| Agent | Trigger | Phase |
|-------|---------|-------|
| Supplier Orchestration | ASYNC search, multi-supplier + dedup | Phase 1 ✅ |
| Integration Onboarding | POST /v1/integrations/onboard | Phase 1 ✅ |
| Knowledge Generation | Post-provisioning LLM vendor analysis | Phase 1.5 ✅ |
| Intelligence Pipeline | Embed → dedup → cluster → POI → validate | Phase 1.5 ✅ |
| Disruption Remediation | Supplier webhook, booking anomaly | Phase 3 |
| Contract Compliance Monitor | Internal scheduler (hourly) | Phase 5 |
| Invoice Reconciliation | Invoice webhook / scheduled pull | Phase 5 |

### 8.3 OpenClaw Context Package

Assembled by src/agents/context-packager.js and injected into every
Claude Managed Agent session as system context:

```json
{
  "tenant": {
    "id": "string",
    "tier": "ENTERPRISE | GROWTH | STARTER",
    "rate_limits": { "rpm": 60 },
    "approved_suppliers": ["bridgify", "hotelbeds-hotels"],
    "schema_profile_id": "standard",
    "sla_thresholds": { "response_ms": 800, "uptime_pct": 99.5 }
  },
  "task": {
    "type": "SEARCH | BOOK | ONBOARD | COMPLIANCE | RECONCILE",
    "priority": "HIGH | NORMAL | LOW",
    "timeout_seconds": 30,
    "escalation_path": "email | webhook | none"
  },
  "tool_contracts": [
    { "tool_name": "tos.search.experiences", "executor": "sync_lambda", "sla_ms": 800 }
  ],
  "cts_schema_reference": { "version": "1.3", "types": ["EXPERIENCE", "HOTEL", "TRANSFER"] },
  "supplier_health": {
    "bridgify": "UP",
    "hotelbeds-hotels": "UP",
    "hotelbeds-activities": "UP",
    "hotelbeds-transfers": "UP"
  },
  "domain_rules": {
    "dedup_strategy": "LOWEST_PRICE",
    "preferred_supplier": null,
    "max_rebook_delta_usd": 50
  },
  "secrets_map": {
    "hotelbeds-hotels": "/tos/prod/<tenant_id>/hotelbeds/hotels/credentials",
    "bridgify": "/tos/prod/<tenant_id>/bridgify/experiences/credentials"
  },
  "active_prompts": [
    { "prompt_key": "integration.hotelbeds.rate_key_expiry_risk", "trigger_condition": "..." }
  ]
}
```

---

## 9. Database Schema

All tables created by migrations/001_initial_schema.sql.
All queries must include tenant_id. RLS enforced at application level.

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE hub_tenants (
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

CREATE TABLE hub_credentials_map (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  supplier_slug    VARCHAR NOT NULL,
  secret_path      VARCHAR NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hub_transactions (
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

CREATE TABLE hub_schema_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug    VARCHAR NOT NULL,
  field_source     VARCHAR NOT NULL,
  field_target     VARCHAR NOT NULL,
  transform_fn     VARCHAR,
  version          VARCHAR DEFAULT '1.0',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hub_dedup_config (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  config_json      JSONB NOT NULL,
  label            VARCHAR,
  is_active        BOOLEAN DEFAULT true,
  test_mode        BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hub_dedup_test_log (
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

CREATE TABLE hub_prompts (
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

CREATE TABLE hub_escalations (
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

CREATE TABLE agent_sessions (
  session_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL,
  task_type        VARCHAR NOT NULL,
  status           VARCHAR DEFAULT 'IN_PROGRESS',
  checkpoint       JSONB,
  result           JSONB,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hub_webhooks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  event_type       VARCHAR NOT NULL,
  endpoint_url     VARCHAR NOT NULL,
  secret_hash      VARCHAR NOT NULL,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hotel_content (
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

CREATE TABLE hub_suppliers (
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

CREATE TABLE hub_tenant_suppliers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  supplier_slug      VARCHAR NOT NULL REFERENCES hub_suppliers(supplier_slug),
  sla_tier           VARCHAR NOT NULL,
  preferred_for_cats VARCHAR[],
  is_active          BOOLEAN DEFAULT true,
  activated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hub_onboarding_sessions (
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

CREATE TABLE hub_integration_tests (
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

CREATE TABLE hub_tool_contracts (
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

-- Static inventory (see Section 3B.6 for full DDL + indexes)
CREATE TABLE hub_static_inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug       VARCHAR NOT NULL REFERENCES hub_suppliers(supplier_slug),
  supplier_raw_ref    VARCHAR NOT NULL,
  type                VARCHAR NOT NULL,
  title               VARCHAR NOT NULL,
  description         TEXT,
  latitude            FLOAT,
  longitude           FLOAT,
  city                VARCHAR,
  country             VARCHAR,
  timezone            VARCHAR,
  category            VARCHAR,
  duration_minutes    INTEGER,
  vehicle_class       VARCHAR,
  star_rating         FLOAT,
  image_urls          TEXT[],
  amenities           TEXT[],
  meal_plans          TEXT[],
  route_origin        VARCHAR,
  route_destination   VARCHAR,
  raw_content         JSONB,
  is_active           BOOLEAN DEFAULT true,
  last_synced_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(supplier_slug, supplier_raw_ref)
);

CREATE INDEX idx_static_inventory_geo
  ON hub_static_inventory (latitude, longitude) WHERE is_active = true;
CREATE INDEX idx_static_inventory_supplier_type
  ON hub_static_inventory (supplier_slug, type) WHERE is_active = true;
CREATE INDEX idx_static_inventory_category
  ON hub_static_inventory (category) WHERE is_active = true;

CREATE TABLE hub_dedup_pairs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  inventory_id_a      UUID NOT NULL REFERENCES hub_static_inventory(id),
  inventory_id_b      UUID NOT NULL REFERENCES hub_static_inventory(id),
  composite_score     FLOAT NOT NULL,
  decision            VARCHAR NOT NULL,
  signal_location     FLOAT,
  signal_name         FLOAT,
  signal_duration     FLOAT,
  signal_category     FLOAT,
  computed_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, inventory_id_a, inventory_id_b)
);

CREATE INDEX idx_dedup_pairs_tenant_a
  ON hub_dedup_pairs (tenant_id, inventory_id_a);

CREATE TABLE hub_sync_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_slug       VARCHAR NOT NULL,
  status              VARCHAR DEFAULT 'RUNNING'
                      CHECK (status IN ('RUNNING','COMPLETE','FAILED')),
  records_fetched     INTEGER DEFAULT 0,
  records_upserted    INTEGER DEFAULT 0,
  records_deactivated INTEGER DEFAULT 0,
  records_errored     INTEGER DEFAULT 0,
  started_at          TIMESTAMPTZ DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  error_message       TEXT
);

CREATE TABLE hub_sync_errors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id         UUID NOT NULL REFERENCES hub_sync_jobs(id),
  supplier_raw_ref    VARCHAR,
  error_message       TEXT NOT NULL,
  raw_record          JSONB,
  created_at          TIMESTAMPTZ DEFAULT now()
);
```

---

## 10. API Surface — All 19 Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| /v1/search | POST | API Key | Travel search — sync or async based on complexity |
| /v1/book | POST | API Key | Execute booking against a CTSTravelOption |
| /v1/cancel | POST | API Key | Cancel booking |
| /v1/booking/:id | GET | API Key | Get booking status and details |
| /v1/integrations/onboard | POST | API Key | Start integration onboarding session |
| /v1/integrations/onboard/:id | GET | API Key | Poll onboarding session status |
| /v1/integrations/onboard/:id/manifest | PATCH | API Key | Update manifest during session |
| /v1/integrations/onboard/:id/confirm | POST | API Key | Trigger sandbox validation |
| /v1/integrations/onboard/:id/promote | POST | API Key | Promote to production (validation must pass) |
| /v1/integrations | GET | API Key | List active integrations for tenant |
| /v1/integrations/:slug | DELETE | API Key | Deactivate integration |
| /v1/session/:id | GET | API Key | Poll agent session status |
| /v1/webhook/:partner | POST | Webhook secret | Receive inbound supplier webhook |
| /v1/tools | GET | API Key | List WebMCP tool contracts for tenant |
| /v1/tools/:contract | POST | API Key | Execute a WebMCP tool contract |
| /v1/agent/callback | POST | Internal | Agent session completion callback |
| /v1/admin/dedup/test-log/:tenantId | GET | Admin | Review dedup test mode decision log |
| /v1/admin/prompts | POST | Admin | Add new prompt to library |
| /v1/admin/escalation/:id/resolve | POST | Admin | Resolve escalation (human reviewer) |

**Auth Middleware Rules:**
- API Key: X-Api-Key header → bcrypt compare → hub_tenants → attach to req.tenant → 401 if fail
- Webhook secret: X-Webhook-Secret header → hash compare → hub_webhooks
- Internal: X-Internal-Token from env var → validate on /v1/agent/callback only
- Admin: X-Admin-Key from env var → validate on /v1/admin/* only

---

## 11. CTS Type Definitions (Zod + TypeScript)

Use these as the Zod schema in src/normalization/cts-schema.js:

```typescript
type CTSTravelOption = {
  option_id: string;            // UUID — generate with crypto.randomUUID()
  type: 'FLIGHT' | 'HOTEL' | 'RAIL' | 'TRANSFER' | 'EXPERIENCE' | 'PACKAGE';
  title: string;
  origin: CTSLocation;
  destination: CTSLocation;
  // Time fields — use only the relevant ones for the type
  depart_utc?: string;          // ISO8601 — FLIGHT/RAIL/TRANSFER
  arrive_utc?: string;          // ISO8601 — FLIGHT/RAIL/TRANSFER
  checkin_date?: string;        // YYYY-MM-DD — HOTEL
  checkout_date?: string;       // YYYY-MM-DD — HOTEL
  duration_minutes?: number;    // EXPERIENCE
  experience_category?: string; // EXPERIENCE
  vehicle_class?: string;       // TRANSFER: SEDAN|VAN|MINIBUS|BUS
  transfer_meta?: CTSTransferMeta; // TRANSFER
  meal_plan?: string;           // HOTEL: RO|BB|HB|FB|AI
  price: CTSPrice;
  availability: CTSAvailability;
  policies: CTSPolicies;
  supplier_raw_ref: string;     // opaque — REQUIRED for re-price and booking
  supplier_slug: string;        // which supplier this came from
  // Dedup fields — set by dedup engine
  is_duplicate_of?: string;     // option_id of canonical when SHOW_ALL
  dedup_score?: number;         // present when UNCERTAIN
  candidate_pair_id?: string;   // shared UUID linking an uncertain pair
  pricing_anomaly?: boolean;    // true when pricing.extreme_delta fires
  media_quality?: string;       // LOW | STANDARD | HIGH
};

type CTSLocation = {
  type: 'AIRPORT' | 'HOTEL' | 'COORDINATES' | 'CITY';
  iata_code?: string;
  city: string;
  country: string;
  timezone: string;             // IANA timezone e.g. Europe/Paris
  latitude?: number;
  longitude?: number;
};

type CTSPrice = {
  amount_usd: number;           // always present — normalized to USD
  original_amount: number;      // supplier native amount
  original_currency: string;    // ISO 4217 e.g. EUR
  fx_rate: number;              // rate used: original * fx_rate = amount_usd
  net_amount_usd?: number;      // B2B net pricing (HotelBeds wholesale)
  markup_applied?: boolean;     // false for B2B net rates
};

type CTSAvailability = {
  status: 'CONFIRMED' | 'LOW_AVAILABILITY' | 'SOLD_OUT' |
          'CANCELLATION_FEE_APPLIES' | 'PRICING_TYPE_UNCERTAIN' |
          'DURATION_UNKNOWN';
  seats?: number;               // EXPERIENCE/FLIGHT
  rooms?: number;               // HOTEL
  max_passengers?: number;      // TRANSFER
  hold_expiry?: string;         // ISO8601 — when this price/availability expires
};

type CTSPolicies = {
  cancellation: {
    free_until?: string;        // ISO8601
    penalty_schedule?: Array<{
      hours_before: number;
      charge_pct: number;
    }>;
    policy_source: 'SUPPLIER' | 'DEFAULT_APPLIED' | 'CONFLICT_RESOLVED_RESTRICTIVE';
  };
  change?: object;
  baggage?: object;
};

type CTSTransferMeta = {
  trip_id: string;              // UUID linking outbound + return
  inbound_flight?: string;      // flight number for airport pickup
  pickup_type?: 'MEET_AND_GREET' | 'CURBSIDE';
  passenger_manifest_required?: boolean;
  return_trip_id?: string;      // option_id of return leg
};
```

---

## 12. Success Criteria

### Phase 1 (Delivered)
| Metric | Target | Status |
|--------|--------|--------|
| API response time (sync) | < 800ms p95 | ✅ |
| CTS normalization | 100% Zod pass on all 4 fixture files | ✅ |
| Dedup scoring | Correct decision on all test pair fixtures | ✅ |
| All endpoint tests | Pass — all 19 endpoints | ✅ |
| No hardcoded credentials | Zero instances in codebase | ✅ |
| Tenant isolation | Every DB query includes tenant_id | ✅ |
| Phase 1 integrations | All 4 live with passing tests | ✅ |
| Static inventory sync | All suppliers sync, records in hub_static_inventory | ✅ |
| Two-stage search | Stage 1 < 30ms, full search < 800ms p95 | ✅ |
| Offline dedup | hub_dedup_pairs populated, decisions applied at search | ✅ |
| Prompt seeds | All 15 prompts in DB, triggers working | ✅ |
| Onboarding flow | End-to-end with real suppliers | ✅ |

### Phase 1.5 (Delivered)
| Metric | Target | Status |
|--------|--------|--------|
| Supplier coverage | 7 suppliers across 4 CTS types | ✅ |
| Semantic search | < 75ms p95 (embedding + pgvector + serialize) | ✅ |
| Partner dashboard | All 7 pages live, tenant-scoped | ✅ |
| Self-service onboarding | Ticketmaster + Duffel onboarded via wizard | ✅ |
| Intelligence pipeline | Full chain: sync→embed→dedup→cluster→POI→validate | ✅ |
| Eval framework | Gold dataset sampling + LLM labelling + P/R/F1 | ✅ |

### Phase 2 (Current — see Section 14)
| Metric | Target |
|--------|--------|
| Consumer search | Travel UI uses `/v1/catalog/search`, not mock data |
| Booking flow | Travel UI books via hub lifecycle, not direct supplier |
| Availability | Live availability check via `/v1/catalog/availability` |
| Zero mock data | No hardcoded fixtures in consumer UI search flow |
| Cross-type search | Single search bar returns hotels + experiences + flights |
| Attraction browsing | Consumer can browse by POI with grouped products |

---

## 13. Open Items — Add TODOs in Code Where These Apply

| Item | Default Behaviour | TODO Location |
|------|------------------|---------------|
| BRIDGIFY_BASE_URL | Log warning, use placeholder — do not throw on startup | src/suppliers/bridgify/experiences.js |
| HotelBeds rate limit quota | Default 60 rpm — read from hub_suppliers.rate_limit_rpm | src/suppliers/base.js |
| Currency FX rate provider | Hardcoded rate table in src/normalization/fx.js | src/normalization/fx.js |
| Hotel search result caching | Skip in Phase 1 — add TODO comment where cache would go | src/suppliers/hotelbeds/hotels.js |
| AWS SDK in secrets adapter | Dynamic import only in production path | src/infra/secrets.js |
| Internal scheduler | Stub implementation only — no cloud scheduler | src/router/dispatch.js |

---

## 14. Phase 2 — Consumer UI ↔ Hub Data Integration

### 14.1 Goal

Connect the consumer-facing travel UI (Flask LLM Shell at port 5001) to
the Integration Hub's catalog and booking APIs (port 3000). Replace all
mock data, fixture-based search results, and direct-to-supplier calls with
the hub's unified data pipeline.

After Phase 2, every product the consumer sees flows through:
```
Supplier → Sync → Static Inventory → Dedup → Ranking → Consumer UI
```

Live operations (availability, booking, cancellation) flow through:
```
Consumer UI → Hub Catalog API → Lifecycle Router → Supplier API → CTS Response → UI
```

### 14.2 Current State (Pre-Phase 2)

| Component | Current | Target |
|-----------|---------|--------|
| Experience search | Direct Bridgify API call from Flask datasource proxy | Hub `/v1/catalog/search` semantic search |
| Hotel search | Direct HotelBeds call or mock data | Hub `/v1/catalog/search?type=HOTEL` |
| Flight search | Not exposed to consumer | Hub `/v1/catalog/search?type=FLIGHT` |
| Event search | Not exposed to consumer | Hub `/v1/catalog/search?type=EXPERIENCE&is_event=true` |
| Transfer search | Direct HotelBeds call | Hub `/v1/catalog/transfer-search` |
| Detail view | Snapshot from search + direct supplier detail call | Hub `/v1/catalog/:id` + live detail via lifecycle |
| Availability | Direct supplier call from Flask | Hub `/v1/catalog/:id/availability` or batch `/v1/catalog/availability` |
| Booking | Direct supplier call from Flask | Hub `/v1/catalog/:id/book` |
| Attraction browse | Not available | Hub POI endpoints (new consumer route) |
| City autocomplete | Flask `/api/v2/destinations/search` | Hub `/v1/catalog/cities` or keep Flask |
| Category filter | Hardcoded in component | Hub `/v1/catalog/categories` |

### 14.3 Hub Catalog API Surface (Already Built)

All endpoints below exist and are production-ready. No auth required for
catalog endpoints (public consumer access).

**Browse & Search:**
| Endpoint | Method | Key Params | Returns |
|----------|--------|------------|---------|
| `/v1/catalog/browse` | GET | `type`, `city`, `category`, `supplier`, `sort`, `limit`, `page` | Paginated items with rating, price, images |
| `/v1/catalog/search` | GET | `q` (natural language), `type`, `city`, `category`, `min_score`, `limit`, `page` | Semantic search results with relevance score |
| `/v1/catalog/query` | POST | Same as search, POST body | Semantic search (POST variant) |
| `/v1/catalog/cities` | GET | `type` (optional) | Distinct cities with inventory count |
| `/v1/catalog/categories` | GET | `type` (optional) | Canonical categories with taxonomy hierarchy |
| `/v1/catalog/transfer-points` | GET | `q` (min 2 chars) | Airport + hotel autocomplete for transfers |

**Detail & Availability:**
| Endpoint | Method | Key Params | Returns |
|----------|--------|------------|---------|
| `/v1/catalog/:id` | GET | — | Full item detail with raw_content |
| `/v1/catalog/:id/occurrences` | GET | — | Event instances (same title/city/supplier) |
| `/v1/catalog/:id/availability` | POST | Supplier-specific payload | Live availability from supplier |
| `/v1/catalog/availability` | POST | `ids[]` (max 20), `date_from`, `date_to` | Batch availability check |

**Booking & Lifecycle:**
| Endpoint | Method | Key Params | Returns |
|----------|--------|------------|---------|
| `/v1/catalog/:id/book` | POST | Booking payload (holder, dates, etc.) | CTS booking confirmation |
| `/v1/catalog/transfer-search` | POST | Origin, destination, date, passengers | Live transfer options |

### 14.4 Integration Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Consumer Travel UI (Flask, port 5001)                          │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ Search   │  │ Detail View  │  │ Booking    │  │ Browse   │  │
│  │ Bar      │  │ Page         │  │ Flow       │  │ by POI   │  │
│  └────┬─────┘  └──────┬───────┘  └─────┬──────┘  └────┬─────┘  │
│       │               │                │               │        │
└───────┼───────────────┼────────────────┼───────────────┼────────┘
        │               │                │               │
        ▼               ▼                ▼               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Hub Proxy Layer (Flask /hub/<path>)                            │
│  Forwards all calls to Integration Hub at port 3000             │
└───────┬───────────────┬────────────────┬───────────────┬────────┘
        │               │                │               │
        ▼               ▼                ▼               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Integration Hub (Express, port 3000)                           │
│                                                                  │
│  /v1/catalog/search   /v1/catalog/:id   /v1/catalog/:id/book   │
│      │                    │                   │                  │
│      ▼                    ▼                   ▼                  │
│  ┌────────┐          ┌────────┐          ┌────────┐             │
│  │Semantic│          │Static  │          │Lifecycl│             │
│  │Search  │          │Inventry│          │Router  │             │
│  │pgvector│          │+ Detail│          │        │             │
│  └───┬────┘          └───┬────┘          └───┬────┘             │
│      │                   │                   │                  │
│      ▼                   ▼                   ▼                  │
│  ┌────────┐          ┌────────┐          ┌────────┐             │
│  │Ranker  │          │Dedup   │          │Supplier│             │
│  │(6 sig) │          │Filter  │          │Adapter │             │
│  └────────┘          └────────┘          └────────┘             │
└──────────────────────────────────────────────────────────────────┘
```

### 14.5 UI Scenarios → Exact API Calls

Every consumer UI interaction maps to specific hub API calls. This is the
authoritative reference for which endpoint serves which screen.

All calls go through the Flask proxy at `/hub/<path>` which forwards to
the Integration Hub at port 3000. Paths below are hub-side (e.g.
`GET /v1/catalog/search` means the UI calls `/hub/v1/catalog/search`).

---

#### Scenario 1: Home Page Load

The home page renders a hero search bar, collection carousels (Best
Sellers, Top Rated, etc.), and city shortcuts.

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 1a | Page loads — fetch carousels | `GET /v1/catalog/collections/home?city=Barcelona&per_collection=6` | `collections[].items[]` → render each carousel row |
| 1b | Page loads — fetch city list for shortcuts | `GET /v1/catalog/cities` | `cities[]` → render city chips (top 12 by count) |
| 1c | Page loads — fetch category chips | `GET /v1/catalog/categories?type=EXPERIENCE` | `categories[]` → render filter chip bar |
| 1d | User clicks "See all" on Best Sellers carousel | `GET /v1/catalog/collections/best-sellers?city=Barcelona&limit=20&page=1` | `results[]` → navigate to results grid |

**If no city is selected** (first-time user), omit `city` param — returns
global collections. Once the user picks a city, re-fetch with city param.

---

#### Scenario 2: Experience Search

User types a natural-language query in the search bar.

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 2a | User types "rooftop bars Barcelona" + submits | `GET /v1/catalog/search?q=rooftop+bars+Barcelona&type=EXPERIENCE&limit=20&page=1` | `results[]` → render results grid with score, rating, price, images |
| 2b | User applies category filter chip (e.g. "Food & Drink") | `GET /v1/catalog/search?q=rooftop+bars+Barcelona&type=EXPERIENCE&category=food-and-drink&limit=20&page=1` | `results[]` → re-render filtered grid |
| 2c | User clicks sort dropdown (Price / Rating / Reviews) | `GET /v1/catalog/browse?city=Barcelona&type=EXPERIENCE&category=food-and-drink&sort=price&limit=20&page=1` | `results[]` — switches from semantic to deterministic sort |
| 2d | User clicks pagination (page 2) | Same as 2a/2b/2c with `page=2` | `results[]`, `pages` for pagination UI |
| 2e | User clicks a result card | `GET /v1/catalog/:id` | Full item detail → navigate to detail page (see Scenario 7) |

**Note:** Semantic search (`/catalog/search?q=`) and deterministic browse
(`/catalog/browse?sort=`) are different endpoints. The UI switches between
them based on whether the user has typed a query or is just browsing.

---

#### Scenario 3: Hotel Search

Hotels require a two-phase flow: browse cached content first, then live
search with dates for bookable rates.

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 3a | User browses "Hotels in Paris" (no dates yet) | `GET /v1/catalog/browse?type=HOTEL&city=Paris&sort=rating&limit=20&page=1` | `results[]` → grid with cached star_rating, price_from ("from $X"), images |
| 3b | User enters check-in/out dates + submits | `POST /v1/search` with `{ type: "HOTEL", city: "Paris", check_in: "2026-06-01", check_out: "2026-06-05", occupancy: [{ adults: 2 }] }` | Live-priced results with rateKey → re-render grid with real prices |
| 3c | User clicks a hotel card | `GET /v1/catalog/:id` | Static hotel detail (name, photos, amenities, star_rating) → detail page |
| 3d | Detail page loads — fetch live rooms | `POST /v1/catalog/:id/availability` with `{ check_in, check_out, occupancy }` | Live room list with rateKey, price, meal_plan → render room cards |
| 3e | User selects a room + books | `POST /v1/catalog/:id/book` with `{ rate_key, holder_name, holder_email, holder_phone }` | CTS booking confirmation → navigate to confirmation page |

**rateKey TTL:** ~15 minutes. If user delays on detail page, re-trigger
3d before 3e. Hub auto-calls checkrates if > 10 min since search.

---

#### Scenario 4: Flight Search

Flights are search-on-demand only. Cached data is for discovery (route
browsing); bookable offers require a live search.

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 4a | User browses "Flights" tab — popular routes | `GET /v1/catalog/browse?type=FLIGHT&sort=price&limit=20&page=1` | `results[]` → route cards with carrier, cached price_from, origin→dest |
| 4b | User selects origin + destination + date | `GET /v1/catalog/search?q=JFK+to+LHR&type=FLIGHT&limit=20` | Semantic match against cached routes → show approximate options |
| 4c | User clicks "Search live prices" | `POST /v1/search` with `{ type: "FLIGHT", origin: "JFK", destination: "LHR", departure_date: "2026-07-15", passengers: [{ type: "adult" }] }` | Live Duffel offers with real prices, expiry → render offer cards |
| 4d | User selects an offer | Offer details already in 4c response | Display fare breakdown, conditions, baggage |
| 4e | User books | `POST /v1/catalog/:id/book` with offer payload | CTS booking confirmation |

**Offer expiry:** Duffel offers expire in ~30 minutes. Show countdown on
UI. If expired, re-trigger 4c.

---

#### Scenario 5: Event Browse (Ticketmaster)

Events are browse-only in the hub — booking redirects to external URL.

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 5a | User opens "Events" tab | `GET /v1/catalog/browse?type=EXPERIENCE&category=EVENT&sort=recent&limit=20&page=1` | `results[]` → event cards with name, venue, date, images |
| 5b | User searches "concerts in London" | `GET /v1/catalog/search?q=concerts+in+London&type=EXPERIENCE&limit=20` | Semantic results filtered to events |
| 5c | User clicks an event card | `GET /v1/catalog/:id` | Event detail with raw_content (venue, dates, price ranges) |
| 5d | User clicks event date variant | `GET /v1/catalog/:id/occurrences` | `occurrences[]` → list of date instances for this event |
| 5e | User clicks "Buy Tickets" | No API call — redirect to `raw_content.url` (Ticketmaster external URL) | External redirect |

**No booking flow through hub** — Ticketmaster events link out to
Ticketmaster's own purchase page.

---

#### Scenario 6: Transfer Search

Transfers require live search with specific route + datetime.

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 6a | User types pickup point | `GET /v1/catalog/transfer-points?q=heath` | `points[]` → autocomplete dropdown (airports + hotels) |
| 6b | User types dropoff point | `GET /v1/catalog/transfer-points?q=hilton+london` | `points[]` → autocomplete dropdown |
| 6c | User submits transfer search | `POST /v1/catalog/transfer-search` with `{ pickup: { code, codeType }, dropoff: { code, codeType }, date: "2026-06-01T14:00", passengers: 2, inbound_flight: "BA115" }` | Live transfer options with vehicle types, prices → render cards |
| 6d | User selects a transfer | Transfer details from 6c response | Show vehicle class, price, conditions |
| 6e | User books | `POST /v1/catalog/:id/book` with transfer booking payload | CTS booking confirmation |

---

#### Scenario 7: Item Detail Page (Any Type)

Reached from any results grid by clicking a card.

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 7a | Page loads — static content | `GET /v1/catalog/:id` | title, description, images, city, category, rating, review_count, duration_minutes, raw_content → render immediately |
| 7b | Page loads — availability (experiences only) | `POST /v1/catalog/:id/availability` with `{ date_from, date_to }` | Available dates/slots → render date picker with availability |
| 7c | Page loads — availability (hotels) | `POST /v1/catalog/:id/availability` with `{ check_in, check_out, occupancy }` | Live rooms with rateKey → render room list |
| 7d | User selects date/room/option | No API call | Store selection in sessionStorage |
| 7e | User clicks "Book Now" | Navigate to booking page with selected option | — |

**Snapshot pattern:** Pass full item object via sessionStorage (`wv_snapshot`)
so detail page renders instantly without waiting for 7a. Merge fresh data
from 7a when it arrives (null-safe merge: overwrite only non-null fields).

---

#### Scenario 8: Booking Flow (Any Type)

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 8a | Booking page loads | Read from sessionStorage (`wv_booking`) | Pre-fill item summary, selected option, price |
| 8b | User fills form (name, email, phone) | No API call | Client-side form |
| 8c | User submits booking | `POST /v1/catalog/:id/book` with `{ holder_name, holder_email, holder_phone, ...type-specific fields }` | `{ booking_id, status, supplier_ref, price }` → navigate to confirmation |
| 8d | Confirmation page loads | `GET /v1/booking/:booking_id` (optional — for polling) | Booking status, reference numbers |

**Type-specific book payload fields:**
- **Experience:** `{ id, date, time_slot, participants: [{ type, count }] }`
- **Hotel:** `{ rate_key, check_in, check_out, occupancy, holder_name, holder_email, holder_phone }`
- **Flight:** `{ offer_id, passengers: [{ type, given_name, family_name }] }`
- **Transfer:** `{ rate_key, pickup_datetime, passengers, inbound_flight }`

---

#### Scenario 9: Attraction / POI Browse

Browse a city's attractions with grouped products per POI.

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 9a | User opens city page "Barcelona" | `GET /v1/catalog/pois?city=Barcelona&limit=20` | `pois[]` → attraction cards (Sagrada Familia, Park Güell, etc.) with experience_count, image |
| 9b | User clicks "Sagrada Familia" | `GET /v1/catalog/pois/:poi_id` | POI detail + `experiences[]` with supplier, price, rating → render product list grouped by supplier |
| 9c | User clicks a specific product | `GET /v1/catalog/:id` | Item detail → navigate to detail page (Scenario 7) |

**Requires new public endpoints:**
- `GET /v1/catalog/pois?city=X&limit=20` — public POI browse
- `GET /v1/catalog/pois/:id` — public POI detail with linked products

---

#### Scenario 10: Cross-Type Unified Search

Single search bar returns mixed results across all types.

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 10a | User types "Barcelona" in universal search | `GET /v1/catalog/search?q=Barcelona&limit=20&page=1` | `results[]` mixed types → group by type in UI (Experiences section, Hotels section, Events section) |
| 10b | User clicks type tab filter | `GET /v1/catalog/search?q=Barcelona&type=EXPERIENCE&limit=20&page=1` | `results[]` filtered to one type |
| 10c | User clicks "See all Experiences" | Navigate to experience results page with `q=Barcelona` | Same as Scenario 2 |

---

#### Scenario 11: Collection Browse (Category Page)

User clicks a collection from the home page (e.g. "Top Rated").

| Step | UI Action | API Call | Response Used |
|------|-----------|----------|---------------|
| 11a | User clicks "Top Rated" carousel header | `GET /v1/catalog/collections/top-rated?city=Barcelona&limit=20&page=1` | `results[]` → full results grid |
| 11b | User applies sub-filter (category chip) | `GET /v1/catalog/collections/top-rated?city=Barcelona&category=outdoor&limit=20&page=1` | `results[]` filtered within collection |
| 11c | User changes city | `GET /v1/catalog/collections/top-rated?city=Paris&limit=20&page=1` | `results[]` for new city |
| 11d | User clicks a result card | `GET /v1/catalog/:id` | Navigate to detail page (Scenario 7) |

---

#### API Call Summary by Endpoint

| Hub Endpoint | Used In Scenarios | Purpose |
|-------------|-------------------|---------|
| `GET /v1/catalog/collections/home` | 1a | Home page carousels (single call) |
| `GET /v1/catalog/collections/:slug` | 1d, 11a-c | Full collection browse |
| `GET /v1/catalog/collections` | — | List available collections (optional) |
| `GET /v1/catalog/cities` | 1b | City list for shortcuts |
| `GET /v1/catalog/categories` | 1c | Category filter chips |
| `GET /v1/catalog/search` | 2a-b, 4b, 5b, 10a-b | Semantic natural-language search |
| `GET /v1/catalog/browse` | 2c, 3a, 4a, 5a | Deterministic browse with sort |
| `GET /v1/catalog/:id` | 2e, 3c, 5c, 7a, 9c, 11d | Item detail (any type) |
| `GET /v1/catalog/:id/occurrences` | 5d | Event date instances |
| `POST /v1/catalog/:id/availability` | 3d, 7b, 7c | Live availability check |
| `POST /v1/catalog/availability` | (batch, results page) | Batch availability for up to 20 items |
| `POST /v1/catalog/:id/book` | 3e, 4e, 6e, 8c | Execute booking |
| `GET /v1/booking/:id` | 8d | Booking status poll |
| `POST /v1/search` | 3b, 4c | Live supplier search (hotels, flights) |
| `POST /v1/catalog/transfer-search` | 6c | Live transfer search |
| `GET /v1/catalog/transfer-points` | 6a, 6b | Transfer point autocomplete |
| `GET /v1/catalog/pois` | 9a | Attraction browse by city |
| `GET /v1/catalog/pois/:id` | 9b | Attraction detail + linked products |

### 14.9 Browse Collections (Curated Consumer Categories)

The canonical taxonomy (walking-tours, food-and-drink, etc.) categorises
products by type. Browse collections are **curated consumer-facing groups**
that surface products based on computed signals — what a travel home page
shows before the user searches.

#### Predefined Collections

| Collection Slug | Display Name | Query Strategy |
|----------------|-------------|----------------|
| `best-sellers` | Best Sellers | `ORDER BY review_count DESC, rating DESC` — highest social proof |
| `top-rated` | Top Rated | `ORDER BY rating DESC WHERE review_count >= 10` — quality gate |
| `trending` | Trending | `ORDER BY last_synced_at DESC, review_count DESC` — recently active + popular |
| `budget-friendly` | Budget Friendly | `ORDER BY price_from ASC WHERE price_from > 0` — cheapest first |
| `premium` | Premium & Luxury | `WHERE category IN ('luxury','private-tours') OR price_from > P75` |
| `family` | Family Friendly | `WHERE category IN ('family','theme-parks') OR category_name ILIKE '%family%'` |
| `outdoor` | Outdoor & Adventure | `WHERE category IN ('outdoor','hiking','water-sports','cycling','adventure')` |
| `culture` | Arts & Culture | `WHERE category IN ('culture','historical','museums','art')` |
| `food-drink` | Food & Drink | `WHERE category IN ('food-and-drink','food-tours','wine-tasting','cooking-classes')` |
| `nightlife` | Nightlife & Events | `WHERE category IN ('nightlife','entertainment') OR is_event = true` |
| `skip-the-line` | Skip the Line | `WHERE category = 'skip-the-line'` |
| `new-arrivals` | New Arrivals | `WHERE created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC` |

Collections are **city-scoped** — the consumer passes a city and gets the
collection for that city. Without a city, returns globally across all
inventory.

#### API Endpoints (New)

```
GET /v1/catalog/collections
  → { collections: [{ slug, display_name, description, count }] }
  Lists available collections with product count.

GET /v1/catalog/collections/:slug
  ?city=Barcelona&limit=20&page=1
  → { slug, display_name, results: [...CTS items], total, page, pages }
  Returns products in the collection, city-scoped, paginated.

GET /v1/catalog/collections/home
  ?city=Barcelona&per_collection=6
  → { city, collections: [
       { slug: "best-sellers", display_name: "Best Sellers", items: [...6] },
       { slug: "top-rated", display_name: "Top Rated", items: [...6] },
       ...
     ]}
  Home page shortcut: returns top N items from each collection for a city
  in a single call. Used by the consumer home page to render multiple
  carousels without N+1 API calls.
```

#### Implementation

Collections are **not stored in a table** — they are named queries defined
in code (`src/catalog/collections.js`). Each collection is a function that
returns a WHERE clause + ORDER BY clause applied to `hub_static_inventory`.
This avoids stale precomputed lists and ensures collections always reflect
current inventory.

The ranker (`src/catalog/ranker.js`) applies business ranking on top of the
collection's base sort. For "Best Sellers" the flow is:
1. Filter: `WHERE is_active = true AND city = $city AND review_count > 0`
2. Base sort: `ORDER BY review_count DESC, rating DESC LIMIT 100`
3. Rank: apply 6-signal ranker on the 100 candidates
4. Return: top 20 after ranking

#### Category Taxonomy Integration

Collections and taxonomy categories are complementary:
- **Taxonomy categories** (outdoor, food-and-drink, etc.) are product
  attributes — a product belongs to one canonical category
- **Collections** are curated views that may span categories (e.g.
  "Best Sellers" includes top products across all categories) or filter
  by category (e.g. "Outdoor & Adventure" maps to specific taxonomy IDs)

The existing `GET /v1/catalog/categories` endpoint returns the taxonomy.
The new `GET /v1/catalog/collections` endpoint returns curated views.
Both are exposed on the consumer home page — taxonomy as filter chips,
collections as carousels.

### 14.10 Build Order

| Step | Task | Depends On |
|------|------|------------|
| 1 | Add public POI catalog endpoints (`/v1/catalog/pois`, `/v1/catalog/pois/:id`) | — |
| 2 | Add browse collections endpoints (`/v1/catalog/collections`, `/collections/:slug`, `/collections/home`) | — |
| 3 | Create `hub_search_experiences` datasource in Flask | Steps 1–2 |
| 4 | Create `hub_search_hotels` datasource in Flask | Steps 1–2 |
| 5 | Create `hub_search_flights` datasource in Flask | Steps 1–2 |
| 6 | Create `hub_item_detail` datasource in Flask | Steps 1–2 |
| 7 | Create `hub_check_availability` datasource in Flask | Steps 1–2 |
| 8 | Create `hub_book` datasource in Flask | Steps 1–2 |
| 9 | Wire experience pages (home, results, detail, booking) to hub datasources | Steps 3, 6, 7, 8 |
| 10 | Wire hotel pages to hub datasources | Steps 4, 6, 7, 8 |
| 11 | Build flight search + results pages | Steps 5, 6 |
| 12 | Build event browse page | Step 3 |
| 13 | Build attraction/POI browse page | Step 1 |
| 14 | Build home page with collection carousels (Best Sellers, Top Rated, etc.) | Step 2 |
| 15 | Build cross-type unified search | Steps 3–5 |
| 16 | Remove mock data and direct-supplier datasources | Steps 9–15 |

### 14.11 Response Mapping — Hub Catalog → UI Component Props

The catalog API returns CTS-shaped items. The consumer UI components expect
`TravelItem` props (defined in root CLAUDE.md). Mapping:

| Hub Field | UI Prop | Notes |
|-----------|---------|-------|
| `id` | `id` | Direct |
| `title` | `title` | Direct |
| `description` | `description` | Direct |
| `city` | `location` | May combine `city + ", " + country` |
| `price_from` | `price` | Numeric |
| `price_currency` | `currency` | ISO 4217 |
| `rating` | `rating` | 0–5 scale |
| `image_urls` | `images` | Array of URLs |
| `duration_minutes` | `duration` | Format as "X hours" or "X min" |
| `supplier_slug` | `supplier` | For provider badge |
| `type` | `category` | Or use `category_name` if available |
| `score` | — | Semantic relevance (optional display) |

This mapping can be done in the Flask proxy layer or in a shared JS
utility in the component runtime.

### 14.12 Phase 2 Success Criteria

| Metric | Target |
|--------|--------|
| Experience search via hub | Search bar calls `/v1/catalog/search`, results render |
| Hotel browse via hub | Hotel page shows cached inventory from hub |
| Flight discovery | New flight page shows Duffel-synced routes |
| Event browse | New events page shows Ticketmaster inventory |
| Booking via hub | At least one booking flow uses hub `/catalog/:id/book` |
| Zero fixture data | Consumer search never returns hardcoded mock items |
| Attraction grouping | At least one city page groups products by POI |
| Cross-type search | Single search query returns mixed results |
| Browse collections | Home page renders Best Sellers, Top Rated, etc. from `/v1/catalog/collections/home` |
| Collection depth | Each collection returns ≥ 6 items per city with inventory |
| Category filters | Taxonomy categories usable as filter chips in search UI |
| Response time | Consumer search → rendered results < 500ms |
| Collections endpoint | `/v1/catalog/collections/home` returns all carousels in < 200ms |
