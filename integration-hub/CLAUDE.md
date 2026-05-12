# TOS Integration Hub — Claude Code Guide
Version 1.4 | April 2026 | WanderVault / EMOSS Consulting

> Lean working guide for Claude Code. Full PRD with all SQL DDL, full prompt
> templates, and full TypeScript type definitions lives in
> `integration-hub_PRD.md`. Source of truth for schemas: `migrations/`. Source
> of truth for CTS types: `src/normalization/cts-schema.js`. Use those files
> when you need exact wording — do not duplicate them here.

---

## 1. What This Is

The TOS Integration Hub is the **L4 execution layer** of the Travel Operating
System — the single gateway through which all external supplier APIs, OTA
connections, and B2B partner integrations flow into TOS.

Phase 1 ships four integrations across two providers:
- Bridgify Experiences
- HotelBeds Hotels
- HotelBeds Experiences (Tours & Activities)
- HotelBeds Transfers

## 2. TOS Layer Model

| Layer | Owner | Role |
|-------|-------|------|
| L5 | TOS | Intelligence, decisioning |
| L4 | Integration Hub | Execution, orchestration ← **THIS COMPONENT** |
| L3 | Bridgify | Normalization, schema translation |
| L2 | Bridgify | Connectivity, protocol adapters |
| L1 | Suppliers | Raw APIs (HotelBeds, Bridgify, etc.) |

---

## 3. Architecture Components

- **API Layer (Express)** — single entry, `X-Api-Key` validated via bcrypt against `hub_tenants.api_key_hash`, per-tenant rate limit from `hub_tenants.rate_limit_rpm`. 19 endpoints (Section 10).
- **Router / Dispatch (OpenClaw)** — loads tenant config (throws if `tenant_id` missing). Classifies SYNC | ASYNC | SCHEDULED. SYNC → executor (suppliers ≤ 2, complexity LOW). ASYNC → managed Claude agent. SCHEDULED → internal scheduler (no cloud scheduler). Emits structured JSON log per dispatch.
- **Executor (sync.js)** — handles search/detail/availability/book/get/cancel. SEARCH = two-stage pipeline (Section 3B.3). BOOK/CANCEL/GET = direct supplier call. Credentials always via `getSecret()` adapter. Always writes `hub_transactions` with `tenant_id`. Returns CTS-normalized response.
- **Normalization Pipeline** — 4 stages applied to every supplier response: PARSE (mappings), ENRICH (codes, timezone, preserve `supplier_raw_ref`), NORMALIZE (USD, UTC, CTS enums), VALIDATE (Zod, log failures, never silently drop).
- **Database (Postgres)** — connect via `DATABASE_URL` env only. Every query includes `WHERE tenant_id = $1` — throw if missing. Schema reference: `migrations/001_initial_schema.sql` and Section 9.
- **Secrets Adapter (`src/infra/secrets.js`)** — local: `process.env`. Production: AWS Secrets Manager. AWS SDK imported dynamically only here. All other code calls `getSecret(path)`.
- **Notify Adapter (`src/infra/notify.js`)** — wraps Resend. Used for onboarding completion, validation failures, escalations, disruption alerts. Per-tenant sender identity from `hub_tenants`.

---

## 3B. Static Inventory Cache

### 3B.1 Principle
Local Postgres cache for slow-changing supplier content (hotel names,
descriptions, geo, experience categories, transfer routes). **Live pricing
and availability are never cached** — both contractually required (HotelBeds
TOS) and architecturally sound (~3s → ~500ms search latency, offline browse
during outages).

### 3B.2 Cached vs. Always Live

| Data Type | Storage | Refresh |
|-----------|---------|---------|
| Hotel name, description, photos, geo, amenities, star | `hub_static_inventory` | Nightly full sync |
| Experience name, description, category, duration, location | `hub_static_inventory` | Nightly full sync |
| Transfer routes, vehicle types, origin/destination | `hub_static_inventory` | Nightly full sync |
| Live room rates, rateKey | Never stored | Per search |
| Live availability, seats | Never stored | Per search |
| Cancellation policies | Never stored | Per search |
| Booking confirmation | `hub_transactions` | At booking time |

### 3B.3 Two-Stage Search Pipeline

```
Stage 1 — Local Filter (target < 30ms)
  Query hub_static_inventory:
    supplier_slug IN tenant's approved suppliers
    AND type = requested_type
    AND is_active = true
    AND geo within radius (PostGIS or haversine)
    AND category matches if specified
  Output: up to 100 candidates with supplier_raw_ref values

Stage 2 — Live Reprice (target 300-600ms)
  Group candidates by supplier → one batched live API call per supplier
  Merge live price/availability onto static record
  Filter out candidates with no availability

Return: merged CTS results (static content + live pricing)
```

For experiences/transfers (less price-volatile), Stage 1 may return
immediately with a "prices from X" indicator while Stage 2 runs async.
**Hotels always wait for Stage 2** — rate key required for booking.

### 3B.4 Offline Dedup
Pre-computed nightly against static inventory; never under user search
latency. Nightly worker writes results to `hub_dedup_pairs`. At search time,
Stage 1 joins `hub_dedup_pairs` to attach pre-computed decisions. No scoring
at query time.

### 3B.5 Sync Workers
One worker per supplier, standalone Node scripts in `src/sync/`:
- `base-sync.js` — shared batch/upsert/error handling
- `hotelbeds-hotels.js`, `hotelbeds-experiences.js`, `hotelbeds-transfers.js`
- `bridgify-experiences.js`
- `dedup-precompute.js` — runs after all content syncs complete

Pattern: fetch in pages of 1000 → normalize each to CTS static shape →
upsert (`ON CONFLICT supplier_slug, supplier_raw_ref DO UPDATE`) → records
not seen this run get `is_active = false` (soft delete). Log progress to
`hub_sync_jobs`. Per-record errors go to `hub_sync_errors` — **never abort
the whole sync on a single record**. Mark sync complete regardless of
partial errors. Never hard-delete — preserves historical booking refs.

### 3B.6 New Tables for Static Inventory
DDL lives in `migrations/001_initial_schema.sql`. Tables: `hub_static_inventory`
(with geo + supplier_type + category indexes, all WHERE `is_active = true`),
`hub_dedup_pairs` (UNIQUE tenant_id+a+b, indexed on tenant_id+a),
`hub_sync_jobs`, `hub_sync_errors`. Full DDL also in `integration-hub_PRD.md`
§3B.6 — do not redefine here.

### 3B.7 Search Pipeline
Implementation: `src/search/pipeline.js` exports `search(params, tenant)`.
Stage 1 query LEFT JOINs `hub_dedup_pairs` and INNER JOINs
`hub_tenant_suppliers` for tenant approval; uses haversine in SQL or PostGIS
depending on what's set up. Stage 2 groups by supplier and parallel-calls
`repriceFromSupplier(slug, records, params, tenant)`. Merges and returns.

### 3B.8 Estimated Sizes
HotelBeds Hotels ~300k records (2-4h sync). HotelBeds Experiences ~18k
(15-30min). HotelBeds Transfers ~24k routes (20-40min). Bridgify
Experiences TBC. Total ~342k+, ~5h max. Postgres + correct indexes is
sufficient — no Elasticsearch in Phase 1.

### 3B.9 Failure Modes

| Scenario | Search | Booking |
|----------|--------|---------|
| Supplier API down | Stage 1 returns static with "live prices unavailable" | Blocked — cannot book without live price |
| Partial supplier failure | Healthy suppliers' results returned | Healthy suppliers bookable |
| Sync worker fails | Stale static served (last good sync) | Live pricing still works |
| DB slow | Stage 1 degrades — reduce candidate limit to 20 | Unaffected |

### 3B.10 Licensing Boundaries
**Cacheable per HotelBeds contract:** hotel/activity/transfer content
(names, descriptions, photos, coords, amenities, categories, durations,
routes, vehicle types). **Never cacheable:** room rates, rateKeys, live
availability counts, cancellation policies, anything from the Booking API.
Bridgify caching rights — confirm with technical contact; leave a TODO in
the sync worker until confirmed.

---

## 4. Phase 1 Supplier Integrations

Detailed CTS field mappings for each supplier are duplicated in
`integration-hub_PRD.md` §4 and live as code in
`src/suppliers/<supplier>/mappings.js`. This section keeps the per-supplier
contract summary only.

### 4.1 Bridgify — Experiences
- Auth: API Key, header `X-Api-Key`. Env: `BRIDGIFY_API_KEY`, `BRIDGIFY_BASE_URL` (sandbox URL TBC).
- CTS type: `EXPERIENCE`. `supplier_slug = bridgify`.
- Operations (all SYNC): search/detail/availability/book/get/cancel.
- Status mapping: `AVAILABLE→CONFIRMED`, `LIMITED→LOW_AVAILABILITY`, `UNAVAILABLE→SOLD_OUT`.
- Category mapping via `hub_schema_mappings`. FX via `fx.js`.

### 4.2 HotelBeds — Experiences (Tours & Activities)
- Auth: HMAC-SHA256 per request. Env: `HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET_KEY`.
- Sandbox `https://api.test.hotelbeds.com/activity-api/1.0` ; prod `https://api.hotelbeds.com/activity-api/1.0`.
- CTS type: `EXPERIENCE`. `supplier_slug = hotelbeds-activities`.
- Operations: search, detail, availability, **book → confirm (two-step)**, get, cancel.
- HMAC: `sig = SHA256(API_KEY + SECRET_KEY + ts)` ; headers `X-Api-Key`, `X-Signature`, `X-Timestamp`.
- **Each modality within an activity = a separate `CTSTravelOption`** (same `activityCode` as `supplier_raw_ref`). EUR is the default original currency — hardcode if missing.

### 4.3 HotelBeds — Hotels
- Auth: HMAC-SHA256 (same util as Activities).
- Booking sandbox `https://api.test.hotelbeds.com/hotel-api/1.2`. Content sandbox `https://api.test.hotelbeds.com/hotel-content-api/1.0`.
- CTS type: `HOTEL`. `supplier_slug = hotelbeds-hotels`.
- Operations: search, content, **checkrates (MANDATORY before every book)**, book, get, cancel.
- `rateKey` is the `supplier_raw_ref` and **expires ~15min**. Re-validate via checkrates if > 10min since search. Always call checkrates immediately before book.
- **Caching:** `hotel_content` static — TTL 24h in RDS. **Rate keys: never cache.** No search caching in Phase 1 (TODO comment).
- **B2B net pricing:** `price.net_amount_usd = rates[].net`, `markup_applied = false`, `price.amount_usd = net_amount_usd` (L5 applies markup).

### 4.4 HotelBeds — Transfers
- Auth: HMAC-SHA256 (same util).
- Sandbox `https://api.test.hotelbeds.com/transfer-api/1.0`.
- CTS type: `TRANSFER`. `supplier_slug = hotelbeds-transfers`.
- Operations: search, detail, book, get, cancel, return_search.
- Category mapping: `SHUTTLE→SHARED_TRANSFER`, `PRIVATE→PRIVATE_TRANSFER`, `LUXURY→LUXURY_TRANSFER`.
- **Return transfers are separate API calls.** At search, generate UUID `trip_id`; set on both outbound and return `transfer_meta.trip_id`. Outbound also gets `transfer_meta.return_trip_id`.
- HotelBeds prices per vehicle. Compute `per_passenger_equivalent = price.amount_usd / availability.max_passengers` and store as supplementary metadata (not core CTS).

---

## 5. Dedup Configuration

### 5.1 Default Config — `/config/dedup.default.json`
Committed to repo (not cloud storage). Strategy `LOWEST_PRICE`, no preferred
supplier. Thresholds: `location_radius_m=150`, `name_similarity_min=0.75`,
`duration_variance_pct=20`, `composite_score_duplicate=0.80`,
`composite_score_uncertain=0.60`. Weights: location 0.35, name 0.40,
duration 0.15, category 0.10. `uncertain_behavior=SHOW_BOTH`,
`test_mode=false`, `test_log_destination=rds`.

### 5.2 Config Merge
At session start, OpenClaw calls `src/dedup/config.js`:
1. Load default JSON (sync `fs.readFileSync` is fine at startup).
2. Query `hub_dedup_config` for active row for this tenant.
3. **Deep merge** tenant config over default — field-by-field, never wholesale object replacement.
4. Return merged config.

### 5.3 Composite Scoring (`src/dedup/engine.js`)
Uses `fuse.js` for fuzzy name match and `geolib` for distance. Strip stop
words before fuzzy matching:
`tour, experience, visit, skip, the, a, an, line, access, priority, guided, private, group, day, half, full, ticket, trip, excursion`.

Four signals: location (binary, fires within radius), name (continuous,
contributes only if `rawSim >= name_similarity_min`), duration (binary,
within variance pct), category (binary, exact match). Weighted sum →
`>= duplicate threshold`: DUPLICATE. `>= uncertain threshold`: UNCERTAIN.
Else DISTINCT.

### 5.4 Strategy Outcomes

| Decision | Strategy | Action |
|----------|----------|--------|
| DUPLICATE | LOWEST_PRICE | Return lower; suppressed → `hub_transactions` with `status=DEDUP_SUPPRESSED` |
| DUPLICATE | PREFERRED_SUPPLIER | Return preferred regardless of price; suppress other |
| DUPLICATE | SHOW_ALL | Return both; set `is_duplicate_of` on higher-priced → lower-priced `option_id` |
| UNCERTAIN | SHOW_BOTH | Return both with `dedup_score` and `candidate_pair_id` (shared UUID) |
| UNCERTAIN | ESCALATE | Write `hub_escalations`; return both with `escalation_pending=true` |
| UNCERTAIN | AGENT_DECIDE | Apply `inventory.dedup.uncertain` prompt; agent decides |
| DISTINCT | any | Return both, no linkage |

**Test mode:** when `cfg.test_mode = true`, write every decision to
`hub_dedup_test_log` with all four signals + score + decision +
`strategy_applied`. Caller results unchanged.

---

## 6. Prompt Library

### 6.1 `hub_prompts` Table
Schema in Section 9. Key fields: `prompt_key` (dotted unique id), `category`
(INVENTORY|INTEGRATION|PRICING|POLICY), `trigger_condition` (string
expression evaluated by `library.js`), `prompt_template` (parameterized text
with `{var}` slots), `escalate_to_human`.

### 6.2 Trigger Condition Eval (`src/prompts/library.js`)
Safe-eval against a context object. Operators: property access
(`context.dedup_score`), comparisons (`>, <, >=, <=, ===, !==`), boolean
(AND/OR/NOT), null check (`IS_NULL(context.x)`).

### 6.3 Seed Prompts
**Full SQL inserts live in `migrations/002_seed_prompts.sql`**. There are 15
prompts across 4 categories. Summary of triggers (use the migration file
for full template text):

**INVENTORY** (5):
- `inventory.dedup.uncertain` — uncertain score range + `AGENT_DECIDE` strategy.
- `inventory.experience.no_duration` — EXPERIENCE with null `duration_minutes`; extract from description (X hours, half day=240, full day=480, X minutes).
- `inventory.experience.zero_results` — supplier returns 0 results while another returns >0; classify expected gap vs anomaly.
- `inventory.policy.missing_cancellation` — null cancellation during normalize; apply tenant default else platform default `NON_REFUNDABLE`.
- `inventory.experience.category_mismatch` — confirmed duplicates with different CTS categories; prefer specific over generic, else Bridgify is authoritative.

**INTEGRATION** (5):
- `integration.supplier.high_latency` — response > 3000ms; partial-return if other supplier ready, else wait up to 8000ms.
- `integration.supplier.partial_results` — truncated or below `expected_min`; if `>= 3` return partial, else retry with relaxed params (radius +20%, dates ±1 day).
- `integration.supplier.auth_failure` — HTTP 401/403; **stops all calls to that supplier for the session** (escalate=true).
- `integration.supplier.unexpected_format` — normalization failures; if rate >20% escalate `SYSTEMATIC_FORMAT_CHANGE`, else exclude failed and continue.
- `integration.hotelbeds.rate_key_expiry_risk` — HotelBeds + `minutes_since_search > 10`; auto-trigger checkrates; surface price change > 5% to caller, else proceed silently.

**PRICING** (3):
- `pricing.extreme_delta` — DUPLICATE with > 40% delta; do NOT auto-suppress; flag `pricing_anomaly=true`, return both.
- `pricing.fx_rate_missing` — non-USD with no FX rate; **never use stale/estimated rate**; halt this result only (escalate=true).
- `pricing.net_retail_ambiguity` — HotelBeds hotel with high amount + missing net flag; for ENTERPRISE/GROWTH flag `PRICING_TYPE_UNCERTAIN`; for STARTER treat as retail.

**POLICY** (2):
- `policy.conflicting_cancellation` — confirmed duplicates with conflicting policies; apply more restrictive; log both originals to `hub_transactions`.
- `policy.free_cancellation_deadline_past` — `free_until` already passed; set `availability.status = CANCELLATION_FEE_APPLIES`; do not hide result.

---

## 7. Integration Onboarding Flow

### 7.1 Manifest Structure (v1.0)
JSON manifest schema lives in `src/agents/onboarding/manifest.schema.json`
and is validated with Zod. Top-level keys: `manifest_version`, `supplier`
(name/slug/categories/base_urls/documentation_url/support_contact), `auth`
(type/credential_fields/signature_*/token_endpoint), `operations` (search,
detail, availability, book, get, cancel — each with method/endpoint/
request_schema/response_schema), `rate_limit_rpm`, `response_format`,
`supports_webhooks`, `webhook_events`, `cts_mapping` (type_value, field_mappings,
status_mappings, default_currency, category_mappings), `execution_profile`
(sync_operations, async_operations, avg_response_time_ms), `test_suite`
(sandbox_search_params, expected_result_count_min, test_booking_ref),
`tenant_config` (tenant_id, sla_tier, preferred_for_categories).

**Validation requires:** `supplier.{name,slug,categories[≥1],base_url_sandbox}`,
`auth.{type,credential_fields[≥1]}`, `operations` includes at least
`search` AND `book`, `cts_mapping.field_mappings[≥1]`,
`test_suite.sandbox_search_params` non-empty. `tenant_config.tenant_id` is
**always overwritten server-side** with the authenticated caller's tenant.

### 7.2 Onboarding Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/integrations/onboard` | POST | Submit manifest (partial OK). Returns `{ session_id }` |
| `/v1/integrations/onboard/:id` | GET | Poll: `{ status, manifest, validation_report }` |
| `/v1/integrations/onboard/:id/manifest` | PATCH | Correct fields mid-session |
| `/v1/integrations/onboard/:id/confirm` | POST | Trigger sandbox validation |
| `/v1/integrations/onboard/:id/promote` | POST | Promote to production (validation must have passed) |
| `/v1/integrations` | GET | List active integrations for tenant |
| `/v1/integrations/:slug` | DELETE | Deactivate |

### 7.3 Sandbox Validation — 6 Steps
Each step has its own retry budget; between retries, diagnose error type,
patch manifest/params, log attempt.

| # | Test | Pass | Retries | On Exhausted |
|---|------|------|---------|--------------|
| 1 | Auth (lightweight req) | HTTP 200, no 401/403 | 3 | Write `VALIDATION_FAILURE_REPORT`, halt |
| 2 | Search via `sandbox_search_params` | HTTP 200, `results >= expected_min` | 3 | Report, halt |
| 3 | CTS normalization | > 95% pass Zod | 3 (no new API call) | Report, halt |
| 4 | Detail fetch (first result) | HTTP 200, enriched fields | 2 | Mark OPTIONAL, continue |
| 5 | Booking test (`test_booking_ref`) | HTTP 200, normalizes to CTS | 2 | Mark UNTESTED, continue |
| 6 | Cancel sim (if test booking exists) | HTTP 200/204 | 2 | Mark UNTESTED, continue |

**Promotion gate:** steps 1-3 MUST pass. 4-6 may be UNTESTED. **No manual
override** — if 1-3 fail after retries, promote is blocked.

### 7.4 Provisioning — 9 Idempotent Steps (on `/promote`)
1. INSERT `hub_suppliers` from `manifest.supplier` + auth.
2. INSERT `hub_schema_mappings` from `manifest.cts_mapping`.
3. Create empty Secrets Manager paths for prod creds.
4. INSERT `hub_tool_contracts` for each operation.
5. INSERT `hub_dedup_config` with `SHOW_ALL` (safe default).
6. INSERT `hub_integration_tests` from `manifest.test_suite`.
7. INSERT `hub_tenant_suppliers` linking tenant ↔ supplier.
8. Send completion email via notify adapter.
9. Log `NEW_INTEGRATION_PROVISIONED` to stdout (structured JSON).

### 7.5 Prompt-Path Onboarding — 8 Stages
Managed by `src/agents/onboarding.js`. Persist manifest to
`hub_onboarding_sessions` after every stage.

1. **Identity** — supplier name + categories. If `documentation_url` provided, fetch + parse, summarise endpoints/auth/format found.
2. **Auth** — propose auth type + credential fields from docs. Show Secrets Manager path. Collect sandbox creds → write to Secrets immediately, never log.
3. **API Contract** — present each operation endpoint + schema; confirm or correct.
4. **CTS Mapping** — propose full field mapping table from response schemas; reviewer corrects/adds.
5. **Test Config** — collect `sandbox_search_params` JSON + expected min.
6. **Tenant Config** — state SLA tier from tenant record; collect preferred categories.
7. **Review** — present complete assembled manifest as structured summary.
8. **Validate & Promote** — run sandbox validation; report; ask to promote on pass.

**Doc fetch:** `axios.get(documentation_url, { timeout: 15000 })`. Extract
endpoint paths, methods, params, response field names/types, auth header
names, rate limit headers. Propose `field_mappings` by string-similarity
match between response field names and CTS field names — present as a
review table.

---

## 8. Agent Design

### 8.1 OpenClaw Dispatch Rules
- `supplier_count <= 2 AND complexity = LOW` → SYNC executor.
- `supplier_count > 2 OR complexity = HIGH` → ASYNC Claude managed agent.
- Internal scheduler fires → SCHEDULED → appropriate agent type.
- **No cloud scheduler** (no EventBridge etc.) — internal.

### 8.2 Agent Types

| Agent | Trigger | Phase |
|-------|---------|-------|
| Supplier Orchestration | ASYNC search, multi-supplier + dedup | 1 |
| Integration Onboarding | POST `/v1/integrations/onboard` | 1 |
| Disruption Remediation | Supplier webhook, booking anomaly | 3 |
| Contract Compliance Monitor | Internal hourly | 5 |
| Invoice Reconciliation | Invoice webhook / scheduled pull | 5 |

### 8.3 OpenClaw Context Package
Assembled by `src/agents/context-packager.js` and injected as system
context. Top-level keys: `tenant` (id/tier/rate_limits/approved_suppliers/
schema_profile_id/sla_thresholds), `task` (type/priority/timeout_seconds/
escalation_path), `tool_contracts` (per-tool sla_ms + executor),
`cts_schema_reference` (version + types), `supplier_health` (per-supplier
UP/DOWN), `domain_rules` (dedup_strategy, preferred_supplier,
max_rebook_delta_usd), `secrets_map` (per-supplier path), `active_prompts`
(prompt_key + trigger_condition for each enabled prompt).

---

## 9. Database Schema

**Source of truth:** `migrations/001_initial_schema.sql`. Full duplicate DDL
in `integration-hub_PRD.md` §9. Do not redefine schema in this file.

Tables (Phase 1):
- `hub_tenants` (PK `tenant_id`, tier ∈ ENTERPRISE/GROWTH/STARTER, `api_key_hash`, defaults for cancellation policy + dedup strategy).
- `hub_credentials_map` (tenant ↔ supplier ↔ secret path).
- `hub_transactions` (txn log; always has `tenant_id`, `supplier_slug`, `operation`, `status`, `latency_ms`).
- `hub_schema_mappings` (per-supplier field source/target/transform).
- `hub_dedup_config` (per-tenant JSONB config with `is_active`, `test_mode`).
- `hub_dedup_test_log` (every test-mode decision with all 4 signals + score).
- `hub_prompts` (prompt library — see §6).
- `hub_escalations` (status ∈ PENDING/RESOLVED/EXPIRED, with `expires_at`).
- `agent_sessions` (checkpointing).
- `hub_webhooks` (per-tenant outbound endpoints).
- `hotel_content` (HotelBeds Content API cache, 24h TTL).
- `hub_suppliers` (supplier registry from manifests).
- `hub_tenant_suppliers` (active supplier list per tenant).
- `hub_onboarding_sessions` (manifest + validation_report; expires after 72h).
- `hub_integration_tests` (sandbox test definitions per supplier+tenant).
- `hub_tool_contracts` (WebMCP tool definitions, executor ∈ sync_lambda/managed_agent/bridgify_direct).
- `hub_static_inventory`, `hub_dedup_pairs`, `hub_sync_jobs`, `hub_sync_errors` (see §3B).

**Required for every query:** `WHERE tenant_id = $1`. Throw if `tenantId` is
missing. Use `pgcrypto` `gen_random_uuid()` for UUIDs.

---

## 10. API Surface — All 19 Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/v1/search` | POST | API Key | Travel search (sync or async by complexity) |
| `/v1/book` | POST | API Key | Execute booking against a CTSTravelOption |
| `/v1/cancel` | POST | API Key | Cancel booking |
| `/v1/booking/:id` | GET | API Key | Booking status + details |
| `/v1/integrations/onboard` | POST | API Key | Start onboarding session |
| `/v1/integrations/onboard/:id` | GET | API Key | Poll onboarding session |
| `/v1/integrations/onboard/:id/manifest` | PATCH | API Key | Update manifest mid-session |
| `/v1/integrations/onboard/:id/confirm` | POST | API Key | Trigger sandbox validation |
| `/v1/integrations/onboard/:id/promote` | POST | API Key | Promote to prod (validation must pass) |
| `/v1/integrations` | GET | API Key | List active integrations |
| `/v1/integrations/:slug` | DELETE | API Key | Deactivate integration |
| `/v1/session/:id` | GET | API Key | Poll agent session status |
| `/v1/webhook/:partner` | POST | Webhook secret | Inbound supplier webhook |
| `/v1/tools` | GET | API Key | List WebMCP tool contracts for tenant |
| `/v1/tools/:contract` | POST | API Key | Execute WebMCP tool contract |
| `/v1/agent/callback` | POST | Internal | Agent session completion |
| `/v1/admin/dedup/test-log/:tenantId` | GET | Admin | Review test-mode dedup log |
| `/v1/admin/prompts` | POST | Admin | Add new prompt |
| `/v1/admin/escalation/:id/resolve` | POST | Admin | Resolve escalation |

**Auth middleware:**
- API Key: `X-Api-Key` → bcrypt compare against `hub_tenants.api_key_hash` → attach `req.tenant` → 401 if fail.
- Bearer JWT: `Authorization: Bearer <token>` → HS256 verify via `JWT_SECRET` env → attach `req.dashboardTenant` (contains `user_id`, `user_name`, `tenant_id`, `tenant_name`, `tier`, `email`, `role`) → 401 if missing/expired. Used by all `/v1/dashboard/*` and `/v1/agent/*` routes. Middleware: `src/middleware/jwt-auth.js`. Token issued by `src/auth/jwt.js` (`signDashboardJwt`), 7-day expiry. Issuance paths: `POST /v1/auth/login` (email lookup) and `GET /v1/auth/verify/:token` (magic link).
- Webhook: `X-Webhook-Secret` → hash compare against `hub_webhooks`.
- Internal: `X-Internal-Token` env → only `/v1/agent/callback`.
- Admin: `X-Admin-Key` env → only `/v1/admin/*`.

---

## 11. CTS Type Definitions

**Source of truth:** `src/normalization/cts-schema.js` (Zod). Full
TypeScript reference: `integration-hub_PRD.md` §11. Summary:

`CTSTravelOption` — `option_id` (UUID), `type` (FLIGHT|HOTEL|RAIL|TRANSFER|EXPERIENCE|PACKAGE), `title`, `origin`/`destination` (`CTSLocation`), time fields (`depart_utc`/`arrive_utc` for flight/rail/transfer, `checkin_date`/`checkout_date` for hotel, `duration_minutes` for experience), type-specific fields (`experience_category`, `vehicle_class`, `transfer_meta`, `meal_plan`), `price` (`CTSPrice`), `availability` (`CTSAvailability`), `policies` (`CTSPolicies`), `supplier_raw_ref` (REQUIRED — opaque, used for re-price/booking), `supplier_slug`. Dedup fields set by engine: `is_duplicate_of`, `dedup_score`, `candidate_pair_id`, `pricing_anomaly`, `media_quality`.

`CTSLocation` — `type` (AIRPORT|HOTEL|COORDINATES|CITY), `iata_code?`, `city`, `country`, `timezone` (IANA), `latitude?`, `longitude?`.

`CTSPrice` — `amount_usd` (always present, normalized), `original_amount`, `original_currency` (ISO 4217), `fx_rate` (`original * fx_rate = amount_usd`), `net_amount_usd?` (B2B), `markup_applied?` (false for B2B net rates).

`CTSAvailability` — `status` ∈ CONFIRMED | LOW_AVAILABILITY | SOLD_OUT | CANCELLATION_FEE_APPLIES | PRICING_TYPE_UNCERTAIN | DURATION_UNKNOWN. Plus `seats?`, `rooms?`, `max_passengers?`, `hold_expiry?` (ISO8601).

`CTSPolicies.cancellation` — `free_until?` (ISO8601), `penalty_schedule?` ([{ `hours_before`, `charge_pct` }]), `policy_source` ∈ SUPPLIER | DEFAULT_APPLIED | CONFLICT_RESOLVED_RESTRICTIVE.

`CTSTransferMeta` — `trip_id` (UUID linking outbound + return), `inbound_flight?`, `pickup_type?` (MEET_AND_GREET | CURBSIDE), `passenger_manifest_required?`, `return_trip_id?`.

---

## 12. Success Criteria

- API response time (sync): < 800ms p95.
- CTS normalization: 100% Zod pass on all 4 fixture files.
- Dedup scoring: correct decision on every test pair fixture.
- All 19 endpoint tests pass.
- Zero hardcoded credentials in codebase.
- Every DB query includes `tenant_id` (tenant isolation).
- All 4 Phase 1 integrations live with passing tests.
- Static inventory sync: all 4 suppliers populated in `hub_static_inventory`.
- Two-stage search: Stage 1 < 30ms, full search < 800ms p95.
- Offline dedup: `hub_dedup_pairs` populated post-sync; decisions applied at query time.
- Prompt seeds: all 15 in DB, trigger conditions evaluating correctly.
- Onboarding flow: end-to-end with mocked supplier + doc fetch.

---

## 13. Open Items — TODO Locations

| Item | Default | Where |
|------|---------|-------|
| `BRIDGIFY_BASE_URL` | Log warning, use placeholder — do not throw on startup | `src/suppliers/bridgify/experiences.js` |
| HotelBeds rate-limit quota | Default 60 rpm — read from `hub_suppliers.rate_limit_rpm` | `src/suppliers/base.js` |
| Currency FX rate provider | Hardcoded rate table | `src/normalization/fx.js` |
| Hotel search result caching | Skip in Phase 1 — leave TODO | `src/suppliers/hotelbeds/hotels.js` |
| AWS SDK in secrets adapter | Dynamic import only on production path | `src/infra/secrets.js` |
| Internal scheduler | Stub only — no cloud scheduler | `src/router/dispatch.js` |

---

## Decision Rules — Do Not Ask, Just Decide

| Situation | Decision |
|-----------|----------|
| Existing working code + new PRD | Evolve, never delete. Keep passing tests. |
| Folder name ambiguity (`-` vs `_`) | Use whatever exists on disk |
| Schema already has some tables | Add new migration file, never modify existing |
| Test passes but PRD says different | Keep test passing, adapt PRD interpretation |
| Partial implementation exists | Build on top of it, fill the gaps |
| Two valid approaches exist | Pick the simpler one and proceed |
| File already exists | Overwrite only if it conflicts with PRD |

**Only stop and ask** on a genuine blocker: missing credentials you can't
stub, an unresolvable PRD contradiction, a failing test you can't fix
after 3 attempts.
