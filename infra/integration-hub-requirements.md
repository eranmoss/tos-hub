# TOS Integration Hub — Development Requirements

**Feature:** Integration Hub — Agentic External System Connectivity  
**Layer:** L4 (TOS Core Orchestration)  
**Track:** Phase 1 (no OpenClaw) + parallel Demo Track (with OpenClaw)  
**Target environment:** AWS — serverless Integration Hub, existing EC2 for main app  
**Status:** Product requirements — ready for implementation  

---

## Architectural Decisions (Locked)

| Concern | Decision |
|---|---|
| Vendor scope | Platform-wide — all vendors available to all tenants. Access control deferred. |
| Credential storage | AWS Secrets Manager. One secret per vendor. Not rotatable. Secret ARN stored in DB. No credentials in env vars, code, or logs. |
| Vendor registry | RDS Postgres only. Single source of truth. No config files, no environment-level overrides. |
| Vendor schema / adapter | Stored in RDS as `jsonb`. No DynamoDB. |
| Dev / Prod separation | Same AWS account, same RDS instance, same DB and tables. Environment separation is code-level only via `NODE_ENV`. |
| Email | Resend (plain HTTP POST). No SES. |
| Queue | None. Onboarding job is a Lambda function invoked asynchronously by the API Lambda. |
| Integration Hub runtime | Serverless — AWS Lambda + API Gateway HTTP API. |
| Main app + OpenClaw runtime | Existing EC2, PM2. Not managed by this feature. |

---

## Runtime Architecture

```
EC2 (existing — not managed here)
  ├── TOS main app (PM2)
  └── OpenClaw agentic control plane (PM2) — demo track only

Serverless — Integration Hub
  └── API Gateway HTTP API
        ├── Lambda: integration-hub-api         30s timeout, 512MB
        │     Handles all HTTP routes.
        │     POST /v1/integrations/onboard → invokes onboarding Lambda
        │     async (InvocationType: Event), returns 202 immediately.
        │
        └── Lambda: integration-hub-onboarding  5min timeout, 512MB
              Invoked async by API Lambda.
              Runs the full onboarding job to completion.
              Writes results to DB, sends confirmation email.

Shared by both runtimes
  ├── RDS Postgres     private subnet — EC2 + Lambda security groups trusted
  └── Secrets Manager  tos/* namespace
```

Both Lambdas run inside the VPC (private subnet) to reach RDS. Both use the Lambda execution role — no credentials in environment variables.

**VPC note:** Lambdas in a private subnet need a NAT gateway or VPC endpoints to reach external services (Secrets Manager, vendor APIs, Anthropic, Resend). Verify your VPC has a NAT gateway before deploying. If not, add one or configure VPC endpoints for Secrets Manager.

---

## AWS Infrastructure (managed by CDK — see `tos-infra/`)

| Resource | Purpose |
|---|---|
| RDS Postgres `db.t4g.micro` | All persistent state |
| Lambda `integration-hub-api` | HTTP routing + fan-out query |
| Lambda `integration-hub-onboarding` | Async onboarding job |
| API Gateway HTTP API | Public endpoint fronting API Lambda |
| Secrets Manager `tos/*` | Vendor credentials + app config |
| IAM role `tos-lambda-role` | Lambda execution — Secrets Manager + RDS + invoke onboarding Lambda |
| IAM role `tos-ec2-role` | EC2 instance — Secrets Manager read/write |
| Security groups | EC2 → RDS, Lambda → RDS |

---

## Secret Structure in Secrets Manager

```
tos/rds/master              auto-generated RDS master password (CDK managed)
tos/config/resend           { api_key: "re_xxxx" }
tos/config/anthropic        { api_key: "sk-ant-xxxx" }
tos/config/app              { notify_email: "...", environment: "production" }
tos/vendors/hotelbeds       { header: "Api-key", value: "..." }   ← manual, pre-migration
tos/vendors/bridgify        { token: "..." }                       ← manual, pre-migration
tos/vendors/<slug>          created automatically by onboarding Lambda
```

The DB stores only the secret ARN. Credential values never touch the DB, environment variables, or logs.

### Auth config shapes by type

```json
{ "header": "exp-api-key", "value": "abc123" }   // api_key
{ "token": "eyJ..." }                              // bearer
{ "username": "x", "password": "y" }              // basic
{ "client_id": "x", "client_secret": "y", "token_url": "https://..." }  // oauth2
```

---

## Database Schema

All tables in the shared RDS instance. Use the existing ORM/migration pattern.

### `integration_vendors`

Single source of truth for what is connected to TOS.

```sql
CREATE TABLE integration_vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  slug            VARCHAR(50)  NOT NULL UNIQUE,
  vertical        VARCHAR(20)  NOT NULL,           -- 'experiences' | 'hotels' | 'transfers'
  endpoint_url    TEXT         NOT NULL,
  auth_type       VARCHAR(20)  NOT NULL,           -- 'api_key' | 'oauth2' | 'basic' | 'bearer'
  secret_arn      TEXT         NOT NULL,           -- Secrets Manager ARN only — never the value
  docs_url        TEXT,
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
                                                   -- 'pending'|'processing'|'active'|'failed'|'inactive'
  schema_coverage JSONB,                           -- { "title": true, "price.amount": true, ... }
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_vendors_vertical ON integration_vendors(vertical);
CREATE INDEX idx_integration_vendors_status   ON integration_vendors(status);
```

### `integration_adapters`

Field and parameter mapping config. One active adapter per vendor. Versioned — updates don't overwrite history.

```sql
CREATE TABLE integration_adapters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID    NOT NULL REFERENCES integration_vendors(id),
  version          INT     NOT NULL DEFAULT 1,
  param_mappings   JSONB   NOT NULL,   -- canonical query param → vendor param name
                                       -- e.g. { "city": "destination", "date": "travel_date" }
  response_path    TEXT    NOT NULL,   -- dot-path to results array in vendor response
                                       -- e.g. "data.products" or "results"
  field_mappings   JSONB   NOT NULL,   -- canonical field → dot-path in a single vendor result
                                       -- e.g. { "title": "name", "price.amount": "pricing.retail" }
  transform_config JSONB,              -- type coercions / unit conversions
                                       -- e.g. { "duration_minutes": { "source_unit": "hours", "multiply": 60 } }
  is_active        BOOLEAN NOT NULL DEFAULT FALSE,
  validated_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_adapters_vendor ON integration_adapters(vendor_id);
CREATE INDEX idx_integration_adapters_active ON integration_adapters(vendor_id, is_active);
```

### `integration_jobs`

Permanent audit log for every onboarding run.

```sql
CREATE TABLE integration_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID        NOT NULL REFERENCES integration_vendors(id),
  triggered_by     VARCHAR(20) NOT NULL,  -- 'llm_shell' | 'api' | 'revalidation'
  triggered_by_ref TEXT,                  -- session id, user id, or calling system
  status           VARCHAR(20) NOT NULL DEFAULT 'running',  -- 'running'|'completed'|'failed'
  log              TEXT,                  -- append-only step-by-step log
  error_detail     TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_jobs_vendor ON integration_jobs(vendor_id);
CREATE INDEX idx_integration_jobs_status ON integration_jobs(status);
```

---

## Canonical Schemas

Defined in code as typed constants — not in the DB. These are the contract between the Integration Hub and all consumers.

```typescript
// src/integration-hub/schemas/experiences.ts

export const EXPERIENCES_REQUIRED_FIELDS = [
  'id', 'title', 'price.amount', 'price.currency', 'location.city',
] as const

export const EXPERIENCES_STANDARD_FIELDS = [
  'description', 'category', 'duration_minutes', 'availability_date',
  'location.country', 'location.lat', 'location.lng',
  'images', 'booking_url', 'provider_id', 'provider_name',
] as const

export const EXPERIENCES_QUERY_PARAMS = [
  'city', 'country', 'date', 'date_to', 'type',
  'lang', 'currency', 'limit', 'offset',
] as const

export interface ExperienceRecord {
  id:                 string
  title:              string
  description?:       string
  category?:          string
  duration_minutes?:  number
  availability_date?: string
  location: {
    city:      string
    country?:  string
    lat?:      number
    lng?:      number
  }
  price: {
    amount:   number
    currency: string
  }
  images?:        string[]
  booking_url?:   string
  provider_id?:   string
  provider_name?: string
  provenance?:    ProviderProvenance[]
}

export interface ProviderProvenance {
  vendor:    string
  price?:    number
  currency?: string
}
```

Hotels and Transfers: define TypeScript interface shapes as stubs now. Implement field mappings when those verticals are onboarded.

---

## Credential Helpers

Used by both Lambdas. No credentials in environment variables — the Lambda execution role grants access.

```typescript
// src/integration-hub/aws/secrets.ts
import { SecretsManagerClient, CreateSecretCommand,
         PutSecretValueCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const client = new SecretsManagerClient({ region: process.env.AWS_REGION })

export async function storeVendorCredential(slug: string, credentialJson: object): Promise<string> {
  const secretName = `tos/vendors/${slug}`
  try {
    const r = await client.send(new CreateSecretCommand({
      Name: secretName,
      SecretString: JSON.stringify(credentialJson),
      Description: `TOS vendor credentials — ${slug}`,
    }))
    return r.ARN!
  } catch (err: any) {
    if (err.name === 'ResourceExistsException') {
      const r = await client.send(new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: JSON.stringify(credentialJson),
      }))
      return r.ARN!
    }
    throw err
  }
}

export async function getVendorCredential(secretArn: string): Promise<Record<string, string>> {
  const r = await client.send(new GetSecretValueCommand({ SecretId: secretArn }))
  return JSON.parse(r.SecretString!)
}

export async function getAppSecret(path: string): Promise<Record<string, string>> {
  const r = await client.send(new GetSecretValueCommand({ SecretId: `tos/config/${path}` }))
  return JSON.parse(r.SecretString!)
}
```

---

## Flow 1 — Vendor Onboarding

### API Lambda — `POST /v1/integrations/onboard`

**Request body:**
```json
{
  "name": "Viator",
  "vertical": "experiences",
  "endpoint_url": "https://api.viator.com/partner/v2",
  "auth_type": "api_key",
  "auth_config": { "header": "exp-api-key", "value": "abc123" },
  "docs_url": "https://docs.viator.com/partner-api/technical-reference"
}
```

**Pre-flight validation:** return 400 if `vertical` is unknown or a vendor with the same slug already has `status = active`.

**Handler:**
1. Create `integration_vendors` row (`status = pending`) and `integration_jobs` row (`status = running`)
2. Invoke onboarding Lambda asynchronously:
```typescript
await lambdaClient.send(new InvokeCommand({
  FunctionName:   process.env.ONBOARDING_LAMBDA_NAME,
  InvocationType: 'Event',   // async — does not wait for result
  Payload:        JSON.stringify({ vendorId, jobId, body: req.body }),
}))
```
3. Return 202 immediately — `auth_config` is passed in the Lambda payload, never written to DB:
```json
{
  "job_id": "uuid",
  "vendor_id": "uuid",
  "status": "running",
  "message": "Integration started. You will receive a confirmation email when complete."
}
```

### Onboarding Lambda — job steps

Append each step outcome to `integration_jobs.log` as it completes.

**Step 1: Store credential**
- Call `storeVendorCredential(slug, auth_config)` — returns ARN
- Write ARN to `integration_vendors.secret_arn`
- `auth_config` from the Lambda payload is discarded after this — never written to DB

**Step 2: Fetch documentation** (if `docs_url` provided)
- OpenAPI JSON/YAML → parse endpoints + schemas
- HTML → strip tags, extract text
- Postman collection → extract request/response examples
- No docs → proceed without, note in log, reduced mapping coverage expected

**Step 3: Claude API call — generate adapter config**

Read Anthropic API key from Secrets Manager at cold start: `getAppSecret('anthropic')`.

System prompt:
```
You are an API integration specialist for a travel platform.

You will receive the TOS canonical schema for a travel vertical and vendor API documentation.

Produce a JSON adapter config with exactly these keys:
- param_mappings: maps each TOS canonical query param name to the vendor's equivalent
- response_path: dot-path to the array of results in the vendor response root
- field_mappings: maps each TOS canonical field name to its dot-path in a single vendor result
- transform_config: type coercions or unit conversions needed (empty object if none)
- schema_coverage: every canonical field as a key, true if mapped, false if not

Respond with valid JSON only. No preamble. No markdown fences.
```

User message: canonical schema constants + vendor docs text.

On JSON parse failure: log raw response, mark job `failed`, send failure email, return.

**Step 4: Persist adapter**
- Write `integration_adapters` row with `is_active = false`
- Update `integration_vendors.schema_coverage`

**Step 5: Validation suite**
- Retrieve credential: `getVendorCredential(vendor.secret_arn)`
- Run 3 test calls: city = "Barcelona", date = next Saturday, limit = 5
- Apply `field_mappings` to at least one response record
- Check all `REQUIRED_FIELDS` are non-null in at least one result
- Log pass/fail per field

**Step 6: Activate or fail**
- Pass → `adapter.is_active = true`, `vendor.status = 'active'`, record `validated_at`
- Fail → `vendor.status = 'failed'`, write error detail

**Step 7: Send email via Resend**

Read Resend API key: `getAppSecret('resend')`. Read notify address: `getAppSecret('app')`.

```typescript
await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${resendKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from:    'TOS <noreply@yourdomain.com>',
    to:      [notifyEmail],
    subject: success ? `✅ ${vendorName} integration is live` : `⚠️ ${vendorName} integration failed`,
    html:    buildEmailHtml(result),
  }),
})
```

**Success email body:** vertical, schema coverage per field (✅/⚠️), list of unmapped standard fields (will return null in queries), job ID, timestamp.

**Failure email body:** which step failed, error detail or missing required fields, job ID, retry instructions.

---

## Flow 2 — Runtime Query

### API Lambda — `GET /v1/:vertical`

Hotels and Transfers return `501 Not Implemented`. Experiences is the only active vertical.

**Query params:**
```
vendors     comma-separated slugs OR "all"
city        string (required)
country     string (optional)
date        ISO date (required)
date_to     ISO date (optional)
type        string (optional)
lang        default "en"
currency    default "USD"
limit       default 20, max 100
offset      default 0
provenance  boolean, default true
```

**Execution:**

```typescript
// 1. Resolve vendor vector from DB
const vendors = params.vendors === 'all'
  ? await db.query(
      `SELECT v.*, a.* FROM integration_vendors v
       JOIN integration_adapters a ON a.vendor_id = v.id AND a.is_active = true
       WHERE v.vertical = $1 AND v.status = 'active'`, [vertical])
  : await db.query(
      `SELECT v.*, a.* FROM integration_vendors v
       JOIN integration_adapters a ON a.vendor_id = v.id AND a.is_active = true
       WHERE v.slug = ANY($1)`, [slugs])

// 2. Fan out — one vendor failing never blocks others
const settled = await Promise.allSettled(
  vendors.map(v => callVendorAdapter(v, canonicalParams))
)

const responded = settled.filter(r => r.status === 'fulfilled').map(r => r.value)
const failed    = settled.filter(r => r.status === 'rejected').map((_, i) => vendors[i].slug)

// 3. Normalise + deduplicate + return
const normalised = responded.flatMap((batch, i) =>
  batch.map(record => applyFieldMappings(record, vendors[i]))
)
const { results, deduplicatedFrom } = deduplicate(normalised)
```

**`callVendorAdapter`:** calls `getVendorCredential(vendor.secret_arn)`, translates canonical params through `param_mappings`, calls the vendor endpoint, returns raw results from `response_path`.

**Deduplication:**
- Match key: `(title.toLowerCase().replace(/\s+/g, ' '), location.city.toLowerCase())`
- On collision: keep record with most non-null fields, merge `provenance` arrays
- Provenance: `[{ vendor: "viator", price: 42.00, currency: "USD" }, ...]`
- Suppress with `?provenance=false`

**Response envelope:**
```json
{
  "vertical": "experiences",
  "vendors_queried": ["viator", "getyourguide"],
  "vendors_responded": ["viator", "getyourguide"],
  "vendors_failed": [],
  "total": 47,
  "deduplicated_from": 61,
  "results": [ ...ExperienceRecord objects... ]
}
```

---

## Vendor Management API

All routes handled by the API Lambda.

```
GET    /v1/integrations/vendors               list vendors (?vertical= ?status= filters)
GET    /v1/integrations/vendors/:slug         vendor detail + adapter field coverage
DELETE /v1/integrations/vendors/:slug         deactivate (status = inactive, adapter.is_active = false)
                                              does NOT delete DB rows or Secrets Manager secret
POST   /v1/integrations/vendors/:slug/revalidate   re-runs steps 5–7 against existing adapter
                                              creates new integration_jobs row, returns 202
GET    /v1/integrations/jobs/:id              job status + full step log
```

---

## File Structure

```
src/
  integration-hub/
    lambda-api/
      index.ts               Lambda handler entry point — routes all HTTP requests
      routes/
        onboard.ts           POST /v1/integrations/onboard
        query.ts             GET /v1/:vertical
        vendors.ts           vendor management endpoints
    lambda-onboarding/
      index.ts               Lambda handler entry point — runs onboarding job
      job.ts                 runOnboardingJob() — all 7 steps
      openclaw-agent.yaml    OpenClaw agent config (demo track)
    engine/
      fanout.ts              Fan-Out Router
      normalise.ts           applyFieldMappings()
      deduplicate.ts         deduplicate()
    schemas/
      experiences.ts         Canonical fields, query params, ExperienceRecord type
      hotels.ts              Stub
      transfers.ts           Stub
    adapters/
      registry.ts            DB queries for adapter resolution at query time
      hotelbeds.ts           Hand-authored mappings (migrated from existing)
      bridgify.ts            Hand-authored mappings (migrated from existing)
    aws/
      secrets.ts             storeVendorCredential(), getVendorCredential(), getAppSecret()
      lambda.ts              invokeOnboardingLambda()
    email/
      resend.ts              sendOnboardingSuccess(), sendOnboardingFailure()
    db/
      client.ts              RDS connection (reads host/credentials from Secrets Manager)
    types.ts                 Shared types
```

---

## Lambda Environment Variables

Both Lambdas receive these from the CDK stack — no secrets in env vars.

```bash
# Both Lambdas
NODE_ENV=production
AWS_REGION=eu-west-1                        # set by Lambda runtime automatically
SECRET_PATH_PREFIX=tos
RDS_SECRET_ARN=arn:aws:secretsmanager:...   # ARN of tos/rds/master
RDS_ENDPOINT=tos-postgres.xxxx.rds.amazonaws.com
RDS_DATABASE=tos

# API Lambda only
ONBOARDING_LAMBDA_NAME=integration-hub-onboarding
```

**Secrets read at runtime (not env vars):**
- `tos/rds/master` → DB password (read once at cold start, cached)
- `tos/config/anthropic` → Anthropic API key (read once at cold start)
- `tos/config/resend` → Resend API key (read once at cold start)
- `tos/config/app` → notify email
- `tos/vendors/<slug>` → vendor credential (read per request)

**EC2 environment variables** (for main app and OpenClaw — set in PM2 ecosystem file):
```bash
DATABASE_URL=postgresql://tos_admin:<password>@<RDS_ENDPOINT>:5432/tos
AWS_REGION=eu-west-1
NODE_ENV=production
DEMO_MODE=false
OPENCLAW_URL=http://localhost:3100           # demo track only
OPENCLAW_ANTHROPIC_API_KEY=sk-ant-xxxx      # separate key, demo track only
```

---

## Existing Vendor Migration

Hotelbeds and Bridgify are already integrated. Wrap them into the Hub before onboarding any new vendor — this gives you a working `GET /v1/experiences` immediately.

**Steps:**
1. Manually create their Secrets Manager secrets (see CDK README for CLI commands)
2. Write `integration_vendors` rows with `status = active`
3. Hand-author `integration_adapters` rows — extract field mappings from existing integration code, do not run through the Claude mapping step
4. Route existing query calls through the new Generic Query API
5. Verify `GET /v1/experiences?vendors=hotelbeds,bridgify&city=Barcelona&date=2026-05-01` returns output identical to the current integration

**Start here.** Proves the query flow end-to-end before any Lambda onboarding job runs.

---

## Demo Track — Parallel (OpenClaw on EC2)

Runs in parallel with Phase 1. Does not block it.

### Setup

```bash
pm2 start tos-app --name tos-app
pm2 start openclaw --name openclaw-agent
pm2 save
```

OpenClaw uses the same RDS and Secrets Manager as the Lambdas (via EC2 instance role). It needs its own Anthropic API key env var for cost tracking.

### LLM Shell Intent Handler

Fires when user message contains a URL + credential-like string, or keywords: "integrate", "connect", "add vendor", "onboard".

1. Extract: vendor name, URL, credentials, vertical (ask one question if ambiguous), docs URL
2. Respond: _"Integrating [Vendor] as an experiences provider now..."_
3. Call `POST <API_GATEWAY_URL>/v1/integrations/onboard` — the same API Gateway endpoint used by any other caller
4. If `DEMO_MODE=true`: stream OpenClaw agent reasoning to the shell in real time
5. On completion: _"✅ [Vendor] is live — [N]/[M] fields mapped."_

### OpenClaw Agent Config

```yaml
name: integration-agent
trigger: http
tools:
  - fetch_url
  - call_anthropic
  - db_write
  - secrets_manager_write
  - http_request
  - resend_send
  - stream_to_shell       # demo only
max_steps: 20
on_failure: resend_send + log_to_db
```

Same DB writes and email output as the onboarding Lambda. `stream_to_shell` is the only addition.

### Demo Script

1. Open TOS LLM shell
2. Type: _"Integrate GetYourGuide as an experiences provider — API key is [key], docs at https://developers.getyourguide.com/reference"_
3. Shell: "Integrating GetYourGuide now..."
4. Agent reasoning streams live: fetching docs → mapping fields → validation → coverage summary
5. ~60–90 seconds: "✅ GetYourGuide is live — 14/17 fields mapped."
6. Query: `GET /v1/experiences?vendors=getyourguide,viator&city=Rome&date=2026-06-15&type=cooking-class`
7. Single unified, deduplicated response from both vendors

---

## Build Order

Each step is independently testable before moving to the next.

1. **CDK deploy** — RDS, Lambdas (placeholder code), API Gateway, IAM, security groups
2. **DB migrations** — create the three tables on the new RDS instance
3. **Canonical schemas** — define and export Experiences schema constants and types
4. **AWS helpers** — `secrets.ts`, `lambda.ts` invoke helper
5. **DB client** — connection helper that reads credentials from Secrets Manager
6. **Adapter registry** — DB query helpers for adapter resolution
7. **Migrate existing vendors** — Secrets Manager entries + DB rows + hand-authored adapters. Verify `GET /v1/experiences?vendors=hotelbeds,bridgify` returns correct results.
8. **Fan-Out + Normalise + Deduplicate** — engine components, unit-testable with fixture data
9. **Query route** — wire engine into the API Lambda, deploy, smoke test via API Gateway URL
10. **Onboarding job** — `job.ts` with all 7 steps, testable standalone with a mock vendor
11. **Onboarding route** — API Lambda invokes onboarding Lambda async, returns 202
12. **Email** — Resend templates, add last once job output shape is stable
13. **Vendor management routes** — list, detail, deactivate, revalidate, job status
14. **Lambda code deploy** — zip and push both Lambdas via `aws lambda update-function-code`
15. **Demo track** — OpenClaw on EC2 + LLM shell intent handler (parallel, never blocks 1–14)

---

## Acceptance Criteria

### Phase 1

- [ ] CDK deploys cleanly — RDS reachable from Lambda, API Gateway URL resolves
- [ ] Vendor credentials stored exclusively in Secrets Manager — never in DB, env vars, or logs
- [ ] `POST /v1/integrations/onboard` returns 202 immediately; onboarding Lambda fires async
- [ ] Onboarding Lambda: stores credential → fetches docs → calls Claude API → writes adapter → validates → sends email
- [ ] `GET /v1/experiences?vendors=hotelbeds,bridgify&city=Barcelona&date=2026-05-01` returns normalised, deduplicated results matching current integration output
- [ ] `vendors=all` queries all active vendors for the vertical
- [ ] A vendor timeout returns partial results — does not fail the API response
- [ ] `GET /v1/integrations/jobs/:id` returns current status + full step log
- [ ] No credentials appear in any log output

### Demo Track

- [ ] OpenClaw running on EC2 as PM2 process — stable across restarts
- [ ] LLM shell detects integration intent from natural language, calls API Gateway endpoint
- [ ] Agent reasoning streams to shell in real time with `DEMO_MODE=true`
- [ ] Full flow (type prompt → vendor live → query results) under 2 minutes
- [ ] Confirmed working with at least one net-new vendor (not Hotelbeds or Bridgify)

---

## Out of Scope

- Hotels and Transfers verticals (type stubs only)
- Subscription / call-limit based access control
- Operator UI for managing integrations
- Credential rotation
- Webhook callbacks on job completion (email only)
- Per-vendor rate limiting
- Adapter auto-healing or scheduled re-validation
- OpenClaw in production (demo track only)
