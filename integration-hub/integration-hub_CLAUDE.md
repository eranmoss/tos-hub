# TOS Integration Hub — Claude Code Instructions v1.4
# Scope: wandervault/integration_hub/

---

## Read First
Before writing any code:
1. Read this file completely
2. Read ../CLAUDE.md (root) for repo-wide rules — they all apply here too
3. Read PRD.md in this directory — it is the full specification
4. Read SUPPLIER_PLAYBOOK.md — per-supplier quirks, endpoints, ID rules,
   response envelopes, and failure modes. **Any time you hit a
   supplier-specific surprise at runtime, update that file** so the
   next person (or Claude session) doesn't rediscover it the hard way.
   Every supplier handler (src/lifecycle/handlers/, src/sync/) must
   correspond to a section in the playbook.

---

## What You Are Building
The TOS Integration Hub — the first major L4 feature of the Travel
Operating System. It is the single gateway through which all external
supplier APIs flow into TOS.

Phase 1 delivers four supplier integrations:
- Bridgify Experiences
- HotelBeds Hotels
- HotelBeds Experiences (Tours & Activities)
- HotelBeds Transfers

---

## Your Job
Build, test, and iterate autonomously. Run tests after every layer.
Fix failures before moving to the next layer. Do not ask for permission
to iterate — keep going until tests are green.

---

## Project Structure to Create
```
integration-hub/
├── CLAUDE.md
├── PRD.md
├── package.json
├── jest.config.js
├── .env.example
├── config/
│   └── dedup.default.json        ← dedup config (NOT in cloud storage)
├── migrations/
│   ├── 001_initial_schema.sql
│   └── 002_seed_prompts.sql
├── src/
│   ├── index.js                  ← Express app entry point
│   ├── router/
│   │   └── dispatch.js           ← OpenClaw dispatch logic
│   ├── executor/
│   │   └── sync.js               ← Sync supplier execution
│   ├── suppliers/
│   │   ├── base.js               ← Base supplier class + retry logic
│   │   ├── hotelbeds/
│   │   │   ├── auth.js           ← Shared HMAC-SHA256 utility
│   │   │   ├── hotels.js
│   │   │   ├── experiences.js
│   │   │   └── transfers.js
│   │   └── bridgify/
│   │       └── experiences.js
│   ├── normalization/
│   │   ├── pipeline.js           ← 4-stage: parse, enrich, normalize, validate
│   │   ├── cts-schema.js         ← CTS type definitions + Zod validation
│   │   ├── fx.js                 ← Currency conversion (mock locally)
│   │   └── mappings/
│   │       ├── hotelbeds-hotels.js
│   │       ├── hotelbeds-experiences.js
│   │       ├── hotelbeds-transfers.js
│   │       └── bridgify-experiences.js
│   ├── dedup/
│   │   ├── engine.js             ← Composite scoring model
│   │   ├── config.js             ← Loads config/dedup.default.json + RDS override
│   │   └── strategies.js         ← LOWEST_PRICE, PREFERRED_SUPPLIER, SHOW_ALL
│   ├── agents/
│   │   ├── orchestration.js      ← Supplier Orchestration Agent
│   │   ├── onboarding.js         ← Integration Onboarding Agent
│   │   └── context-packager.js   ← OpenClaw context assembly
│   ├── onboarding/
│   │   ├── manifest.js           ← Manifest validation (Zod)
│   │   ├── validation.js         ← 6-step sandbox validation + retry budget
│   │   └── provisioning.js       ← 9-step provisioning pipeline
│   ├── prompts/
│   │   └── library.js            ← Loads hub_prompts from RDS
│   ├── middleware/
│   │   ├── auth.js               ← API key validation
│   │   └── rate-limit.js         ← Per-tenant rate limiting
│   ├── db/
│   │   ├── client.js             ← Postgres connection pool (pg)
│   │   └── migrations.js         ← Migration runner
│   └── infra/
│       ├── secrets.js            ← Secrets adapter (env locally, AWS in prod)
│       └── notify.js             ← Resend adapter
└── tests/
    ├── fixtures/
    │   ├── hotelbeds-hotel-response.json
    │   ├── hotelbeds-experience-response.json
    │   ├── hotelbeds-transfer-response.json
    │   └── bridgify-experience-response.json
    ├── unit/
    │   ├── normalization.test.js
    │   ├── dedup.test.js
    │   ├── dispatch.test.js
    │   ├── manifest.test.js
    │   ├── sync.test.js
    │   └── search-pipeline.test.js
    └── integration/
        ├── api.test.js
        └── suppliers.test.js
```

---

## Build Order — Follow This Exactly

### Layer 1: Project Setup & Database
- Create package.json with all dependencies listed in this file
- Create jest.config.js
- Create .env.example with all required vars
- Write migrations/001_initial_schema.sql — full schema from PRD.md
  Section 9. All tables: hub_tenants, hub_credentials_map,
  hub_transactions, hub_schema_mappings, hub_dedup_config,
  hub_dedup_test_log, hub_prompts, hub_escalations, agent_sessions,
  hub_webhooks, hotel_content, hub_suppliers, hub_tenant_suppliers,
  hub_onboarding_sessions, hub_integration_tests, hub_tool_contracts
- Write src/db/client.js — pg Pool via DATABASE_URL
- Write src/db/migrations.js — reads and executes SQL files in order
- Run: node src/db/migrations.js
- TEST: query information_schema to verify all 16 tables exist
- GREEN before proceeding

### Layer 2: CTS Schema & Normalization
- Implement src/normalization/cts-schema.js — full CTS types from
  PRD.md Section 11 (CTSTravelOption, CTSLocation, CTSPrice,
  CTSAvailability, CTSPolicies, CTSTransferMeta) as Zod schemas
- Implement src/normalization/fx.js — mock FX locally with a hardcoded
  rate table (EUR=1.08, GBP=1.27, etc). Add TODO for real FX provider
- Implement all four mapping files in src/normalization/mappings/
  using specs from PRD.md Section 4 for each supplier
- Implement src/normalization/pipeline.js — 4 stages:
  1. PARSE: apply field mappings from mappings/ files
  2. ENRICH: resolve codes, infer timezone, preserve supplier_raw_ref
  3. NORMALIZE: USD via fx.js, dates to UTC ISO8601, CTS enum mapping
  4. VALIDATE: Zod parse — log failures to stdout, never drop silently
- Create realistic fixture JSON files in tests/fixtures/ — model these
  on the field specs and mapping notes in PRD.md Section 4
- TEST: every fixture file normalizes to valid CTS, 100% Zod pass rate
- GREEN before proceeding

### Layer 2.5: Static Inventory Schema + Sync Workers
This layer must be built before Layer 4 (supplier integrations) because
the two-stage search pipeline depends on hub_static_inventory.

**Schema additions (add to migrations/001_initial_schema.sql):**
- hub_static_inventory (with geo indexes) — full DDL in PRD Section 3B.6
- hub_dedup_pairs
- hub_sync_jobs
- hub_sync_errors

Run updated migration: node src/db/migrations.js

**Implement src/sync/base-sync.js:**
- Abstract base class all sync workers extend
- fetchPage(offset, limit) — override per supplier
- normalizeRecord(raw) — override per supplier
- run() method:
  1. Create hub_sync_jobs record (status=RUNNING)
  2. Load all existing supplier_raw_refs for this supplier
     into a Set (for soft-delete tracking)
  3. Fetch in pages of 1000 until no more pages
  4. For each page: normalize each record, upsert to
     hub_static_inventory ON CONFLICT (supplier_slug, supplier_raw_ref)
     DO UPDATE SET all fields, last_synced_at = now(), is_active = true
  5. Remove seen refs from Set
  6. After all pages: UPDATE hub_static_inventory SET is_active = false
     WHERE supplier_slug = $1 AND supplier_raw_ref = ANY($2)
     (soft delete unseen records)
  7. Log individual errors to hub_sync_errors — never throw/abort
  8. Update hub_sync_jobs status=COMPLETE with counts

**Implement src/sync/hotelbeds-hotels.js:**
- Extends base-sync
- fetchPage: GET /hotel-content-api/1.0/hotels?from={offset}&to={offset+999}
- normalizeRecord: maps to hub_static_inventory CTS shape
  - type = HOTEL
  - supplier_raw_ref = hotel.code
  - title = hotel.name.content
  - latitude = hotel.coordinates.latitude
  - longitude = hotel.coordinates.longitude
  - star_rating = hotel.categoryCode (map to float)
  - amenities = hotel.facilities[].facilityCode
  - meal_plans = hotel.boards[].boardCode
  - image_urls = hotel.images[].path
  - raw_content = full hotel object

**Implement src/sync/hotelbeds-experiences.js:**
- fetchPage: GET /activity-api/1.0/activities (paginated)
- normalizeRecord:
  - type = EXPERIENCE
  - supplier_raw_ref = activity.activityCode
  - title = activity.name
  - category = activity.category.code → map to CTS experience_category
  - duration_minutes = activity.duration.value (convert if hours)
  - latitude/longitude from activity.location

**Implement src/sync/hotelbeds-transfers.js:**
- fetchPage: GET /transfer-api/1.0/transfers/types (paginated)
- normalizeRecord:
  - type = TRANSFER
  - supplier_raw_ref = transfer.id
  - vehicle_class = transfer.vehicle.code
  - route_origin = transfer.pickUp.code
  - route_destination = transfer.dropOff.code

**Implement src/sync/bridgify-experiences.js:**
- Add TODO: confirm caching rights with Bridgify before enabling
- Stub implementation only — logs TODO and exits cleanly
- Do not attempt to fetch Bridgify content until rights confirmed

**Implement src/sync/dedup-precompute.js:**
- Runs after all content syncs complete
- For each tenant: for each pair of approved suppliers with
  overlapping types:
  - Query hub_static_inventory for all active records per supplier
  - For each record from supplier A: find candidates from supplier B
    within location_radius_m (haversine)
  - Run composite scoring (reuse src/dedup/engine.js)
  - If score >= uncertain threshold: upsert hub_dedup_pairs
  - If score < uncertain threshold: delete pair if exists
- Uses batch inserts (1000 at a time) for performance

**Implement src/search/pipeline.js:**
- Two-stage search as specified in PRD Section 3B.3 and 3B.7
- Stage 1: haversine query against hub_static_inventory
  with LEFT JOIN hub_dedup_pairs
- Stage 2: batch reprice per supplier using existing supplier modules
- Merge: attach live pricing to static records
- Apply pre-computed dedup decisions from joined pairs

Add admin endpoints to src/index.js:
- POST /v1/admin/sync/run/:supplier_slug — runs sync worker for supplier
- GET /v1/admin/sync/status — list recent hub_sync_jobs with error counts
- POST /v1/search/local — Stage 1 only, returns static candidates
  without live reprice (useful for agent queries about inventory)

TEST:
- base-sync correctly upserts and soft-deletes with fixture data
- hotelbeds-hotels sync produces valid hub_static_inventory rows
- haversine query returns correct candidates within radius
- two-stage pipeline returns merged results from mocked stage 2
- dedup-precompute populates hub_dedup_pairs correctly
- sync job status tracked in hub_sync_jobs
- GREEN before proceeding


### Layer 3: HotelBeds Auth + Supplier Base
- Implement src/infra/secrets.js:
  - Local: return process.env[envKeyFromPath(path)]
  - Production: dynamic import @aws-sdk/client-secrets-manager
  - All other src/ files import getSecret() from here — never AWS SDK
- Implement src/suppliers/hotelbeds/auth.js:
  ```js
  import { createHash } from 'crypto';
  export const buildHeaders = (apiKey, secretKey) => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHash('sha256')
      .update(apiKey + secretKey + ts).digest('hex');
    return { 'X-Api-Key': apiKey, 'X-Signature': sig, 'X-Timestamp': ts };
  };
  ```
- Implement src/suppliers/base.js — abstract base class:
  - 3 retries with exponential backoff on 5xx / network error
  - 8000ms timeout per request
  - Structured JSON error logging to stdout
  - Rate limit tracking
- TEST: signature matches expected SHA256 for known inputs,
  retries fire on 5xx, timeout at 8000ms, errors are JSON
- GREEN before proceeding

### Layer 4: Supplier Integrations (all four)
For each supplier implement: search, detail, availability, book, get, cancel.
Wire each operation through normalization pipeline.
Use nock to mock HTTP — never call real APIs in tests.

Order:
1. src/suppliers/hotelbeds/hotels.js
   - Dual API: Booking API + Content API (PRD Section 4.3)
   - rateKey expires ~15min — checkrates mandatory before book
   - Cache hotel static content in hotel_content (24hr TTL)
   - boardCode → meal_plan
2. src/suppliers/hotelbeds/experiences.js
   - Each modality = separate CTSTravelOption (PRD Section 4.2)
   - activityCode → supplier_raw_ref
   - confirm is separate from book (two-step)
3. src/suppliers/hotelbeds/transfers.js
   - Return transfers: link via trip_id UUID generated at search time
   - inbound_flight → transfer_meta.inbound_flight
4. src/suppliers/bridgify/experiences.js
   - Base URL from BRIDGIFY_BASE_URL env var
   - If not set: log TODO and use placeholder — do not throw on startup

TEST: each operation returns valid CTS from nock-mocked response
- GREEN before proceeding

### Layer 5: Dedup Engine
- Create config/dedup.default.json — values from PRD.md Section 5.1
- Implement src/dedup/config.js:
  - Load config/dedup.default.json as base (fs.readFileSync at startup)
  - Query hub_dedup_config for active tenant override
  - Deep merge: tenant values win
- Implement src/dedup/engine.js — composite scoring:
  - geolib.getDistance() for location signal
  - fuse.js for name fuzzy match on normalized titles
  - Name normalization: lowercase, strip punctuation, strip: tour,
    experience, visit, skip, the, a, an, line, access, priority,
    guided, private, group, day, half, full, ticket
  - Duration variance as percentage
  - Exact category match
  - Formula from PRD.md Section 5.2
- Implement src/dedup/strategies.js — all 7 outcomes (PRD Section 5.3)
  including test_mode logging to hub_dedup_test_log
- TEST: minimum 14 test pair fixtures covering every outcome combination
- GREEN before proceeding

### Layer 6: Router / OpenClaw Dispatch
- Implement src/router/dispatch.js:
  - Load tenant from hub_tenants by tenant_id — throw if missing
  - Classify: SYNC if supplier_count <= 2 AND complexity LOW
  - Classify: ASYNC if supplier_count > 2 OR complexity HIGH
  - SYNC → src/executor/sync.js
  - ASYNC → context-packager + Claude Managed Agent invocation
  - Log every dispatch as structured JSON
- Implement src/executor/sync.js:
  - Fetch credentials via getSecret()
  - Call supplier module operation
  - Run normalization pipeline
  - Write hub_transactions record (always include tenant_id)
  - Return CTS result
- Implement src/agents/context-packager.js:
  - Build context package per PRD.md Section 8.3
  - Load tenant config, active tool contracts, dedup config,
    prompt library, supplier health map
- TEST: SYNC routes correctly, ASYNC assembles context, hub_transactions
  written on every sync execution, missing tenant_id throws
- GREEN before proceeding

### Layer 7: API Surface
- Implement src/middleware/auth.js:
  - Extract X-Api-Key header → 401 if missing
  - bcrypt.compare against hub_tenants.api_key_hash → 401 if no match
  - Attach tenant to req.tenant
- Implement src/middleware/rate-limit.js:
  - express-rate-limit, limit = req.tenant.rate_limit_rpm
  - 429 with JSON error body when exceeded
- Implement src/index.js — all 19 endpoints from PRD.md Section 10:
  POST /v1/search
  POST /v1/book
  POST /v1/cancel
  GET  /v1/booking/:id
  POST /v1/integrations/onboard
  GET  /v1/integrations/onboard/:id
  PATCH /v1/integrations/onboard/:id/manifest
  POST /v1/integrations/onboard/:id/confirm
  POST /v1/integrations/onboard/:id/promote
  GET  /v1/integrations
  DELETE /v1/integrations/:slug
  GET  /v1/session/:id
  POST /v1/webhook/:partner
  GET  /v1/tools
  POST /v1/tools/:contract
  POST /v1/agent/callback
  GET  /v1/admin/dedup/test-log/:tenantId
  POST /v1/admin/prompts
  POST /v1/admin/escalation/:id/resolve
- TEST: all 19 endpoints correct status codes, auth enforced,
  rate limit fires at configured threshold
- GREEN before proceeding

### Layer 8: Integration Onboarding
- Implement src/onboarding/manifest.js:
  - Zod schema for Integration Manifest (PRD.md Section 7.1)
  - Always overwrite manifest.tenant_config.tenant_id with req.tenant.id
  - Required: supplier identity, auth, min one operation, field_mappings,
    sandbox_search_params
- Implement src/onboarding/validation.js — 6-step pipeline:
  1. Auth validation — test request, 3 retries
  2. Search — run sandbox_search_params, 3 retries
  3. CTS normalization — > 95% Zod pass required
  4. Detail fetch — first result, 2 retries
  5. Booking test — by test_booking_ref if present, 2 retries
  6. Cancel sim — if test booking exists, 2 retries
  On each retry: diagnose error, log attempt with reasoning
  On budget exhausted: write VALIDATION_FAILURE_REPORT to session, halt
  No override — sandbox must pass before promote endpoint is enabled
- Implement src/onboarding/provisioning.js — 9-step pipeline
  per PRD.md Section 7.4
- Implement src/agents/onboarding.js:
  - 8-stage conversation manager (PRD.md Section 7.4)
  - Doc fetch: axios GET on documentation_url, extract endpoints +
    schemas + auth pattern, propose CTS mapping
  - Persist manifest to hub_onboarding_sessions after each stage
- TEST: full flow with nock-mocked supplier + nock-mocked doc URL,
  retry triggers on failure, failure report written on budget exhaustion,
  successful flow writes all 9 provisioning targets
- GREEN before proceeding

### Layer 9: Prompt Library
- Implement src/prompts/library.js:
  - Load active prompts from hub_prompts for tenant
  - Evaluate trigger_condition against context object
  - Return matching prompts for context package injection
  - Escalation path: write hub_escalations, call notify adapter
- Write migrations/002_seed_prompts.sql — insert all 15 prompts:
  inventory.dedup.uncertain
  inventory.experience.no_duration
  inventory.experience.zero_results
  inventory.policy.missing_cancellation
  inventory.experience.category_mismatch
  integration.supplier.high_latency
  integration.supplier.partial_results
  integration.supplier.auth_failure
  integration.supplier.unexpected_format
  integration.hotelbeds.rate_key_expiry_risk
  pricing.extreme_delta
  pricing.fx_rate_missing
  pricing.net_retail_ambiguity
  policy.conflicting_cancellation
  policy.free_cancellation_deadline_past
  (Full prompt templates in PRD.md Section 6.4)
- Run: node src/db/migrations.js (picks up 002 automatically)
- TEST: each trigger condition evaluates correctly, escalate_to_human
  prompts write to hub_escalations, inactive prompts excluded
- GREEN — integration-hub is feature complete

---

## Environment Variables
```
DATABASE_URL=postgres://localhost:5432/tos_integration_hub
HOTELBEDS_API_KEY=
HOTELBEDS_SECRET_KEY=
HOTELBEDS_ENV=sandbox
BRIDGIFY_API_KEY=
BRIDGIFY_BASE_URL=
RESEND_API_KEY=
JWT_SECRET=
PORT=3000
NODE_ENV=development
```

---

## Dependencies
```json
{
  "type": "module",
  "dependencies": {
    "express": "^4.18.0",
    "pg": "^8.11.0",
    "axios": "^1.6.0",
    "resend": "^2.0.0",
    "zod": "^3.22.0",
    "jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.1.0",
    "express-rate-limit": "^7.0.0",
    "fuse.js": "^7.0.0",
    "geolib": "^3.3.4"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "supertest": "^6.3.0",
    "nock": "^13.4.0",
    "@types/jest": "^29.0.0"
  }
}
```

---

## Key Implementation Patterns

### HMAC Auth (shared by all three HotelBeds APIs)
```js
// src/suppliers/hotelbeds/auth.js
import { createHash } from 'crypto';
export const buildHeaders = (apiKey, secretKey) => {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHash('sha256')
    .update(apiKey + secretKey + ts).digest('hex');
  return { 'X-Api-Key': apiKey, 'X-Signature': sig, 'X-Timestamp': ts };
};
```

### Secrets Adapter
```js
// src/infra/secrets.js
export const getSecret = async (path) => {
  if (process.env.NODE_ENV !== 'production') {
    const key = path.split('/').pop().toUpperCase().replace(/-/g,'_');
    return process.env[key];
  }
  const { SecretsManagerClient, GetSecretValueCommand } =
    await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({});
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: path })
  );
  return JSON.parse(res.SecretString);
};
```

### Normalization Pipeline
```js
// src/normalization/pipeline.js
export const normalize = async (rawResponse, supplierSlug) => {
  const mappings = getMappings(supplierSlug);   // static import
  const parsed    = parse(rawResponse, mappings);       // Stage 1
  const enriched  = enrich(parsed);                    // Stage 2
  const normalized = await normalizeFields(enriched);  // Stage 3
  const validated = validate(normalized);              // Stage 4 Zod
  return validated;                                    // CTSTravelOption[]
};
```

### Tenant Isolation — Every Query
```js
// CORRECT
const res = await db.query(
  'SELECT * FROM hub_transactions WHERE tenant_id = $1 AND id = $2',
  [tenantId, id]
);
// WRONG — never
const res = await db.query('SELECT * FROM hub_transactions WHERE id = $1', [id]);
```

### Structured Logging
```js
// CORRECT
console.log(JSON.stringify({
  level: 'error', supplier, operation, tenantId, error: err.message
}));
// WRONG
console.log('error in supplier call', err);
```

---

## Definition of Done
- All 9 layers have passing Jest tests — zero failures
- All 19 API endpoints return correct responses per PRD Section 10
- CTS normalization: 100% Zod pass on all four fixture files
- Dedup: correct decision on all 14+ test pair fixtures
- Onboarding: full flow end-to-end with mocked supplier and doc fetch
- All 15 prompts seeded and trigger conditions work correctly
- Zero hardcoded credentials, base URLs, or tenant IDs
- Every DB query includes tenant_id
- No AWS SDK imports outside src/infra/secrets.js

---

## Do Not
- Import AWS SDK anywhere except src/infra/secrets.js
- Use S3 or cloud storage for config — use /config/*.json or RDS
- Skip a layer's tests to move to the next
- Hardcode BRIDGIFY_BASE_URL — use env var, log TODO if missing
- Use synchronous fs calls in request handlers
- Invent schema fields not in the PRD — add TODO comment if unclear
- Store credentials in hub_onboarding_sessions or any log
- Query DB without tenant_id
- Use unstructured console.log in production code paths
