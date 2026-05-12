# TOS Partner Dashboard — Product Requirements Document
# Version 1.2 | April 2026 | WanderVault / EMOSS Consulting

---

## 1. What This Is

A multi-tenant React SPA dashboard for B2B partners of the TOS
Integration Hub. Partners log in via magic link and see only their own
data. A persistent agent panel is available on every page — partners
interact with an AI agent that has full awareness of their integration
data and can answer questions in natural language.

---

## 2. User & Access Model

| Role | Who | Access |
|------|-----|--------|
| Partner Admin | OTA technical contact | Full access to their tenant data |
| TOS Admin | EMOSS / internal | Phase 2 — not in scope here |

Authentication: magic link via email. No passwords.
Session: JWT stored in localStorage, 7-day expiry.
Isolation: every API call scoped to JWT tenant_id.

---

## 3. Magic Link Auth Flow

```
1. Partner visits /login → enters email
2. POST /v1/auth/magic-link
   Hub: lookup tenant by email, generate token, store SHA256 hash
   (expires 15min), send link via Resend
3. Partner clicks link → /verify/<token>
4. GET /v1/auth/verify/:token
   Hub: hash token, lookup, validate not used + not expired,
   mark used, return signed JWT
5. Frontend stores JWT in localStorage
6. All API calls: Authorization: Bearer <jwt>
7. On 401: clear localStorage + redirect /login
```

### New DB Tables (add to hub migrations)

```sql
CREATE TABLE hub_auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  VARCHAR NOT NULL UNIQUE,
  tenant_id   VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  used        BOOLEAN DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hub_saved_prompts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  label        VARCHAR NOT NULL,
  prompt_text  TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hub_agent_conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  messages     JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
```

### JWT Payload
```json
{
  "tenant_id": "string",
  "tenant_name": "string",
  "tier": "ENTERPRISE | GROWTH | STARTER",
  "email": "string",
  "iat": 1234567890,
  "exp": 1234567890
}
```

---

## 4. Application Layout

### Routes
| Path | Component | Auth |
|------|-----------|------|
| /login | MagicLinkForm | Public |
| /verify/:token | VerifyToken | Public |
| /dashboard | Overview | Protected |
| /dashboard/integrations | Integrations | Protected |
| /dashboard/transactions | Transactions | Protected |
| /dashboard/intelligence | Intelligence | Protected |
| /dashboard/settings | Settings | Protected |

### Three-Column Shell

```
┌──────────┬────────────────────────────┬──────────────────┐
│ Sidebar  │ Content Area               │ Agent Panel      │
│ 240px    │ flex-1                     │ 360px            │
│ fixed    │                            │ collapsible      │
│          │                            │                  │
│ [logo]   │ [page content]             │ [chat messages]  │
│          │                            │                  │
│ Overview │                            │ [input]          │
│ Integrat │         ◀ toggle button    │                  │
│ Transact │                            │                  │
│ Intellig │                            │                  │
│ Settings │                            │                  │
│          │                            │                  │
│ [tenant] │                            │                  │
│ [logout] │                            │                  │
└──────────┴────────────────────────────┴──────────────────┘
```

- Agent panel starts collapsed on first load
- Toggle button on right edge of content area (chat bubble icon)
- When collapsed: content area uses full width
- When expanded: content shrinks, panel slides in (CSS transition)
- Topbar shows unread indicator dot when agent responds while panel closed

---

## 5. Agent Panel

**Purpose:** Let partners ask natural language questions about their
integration data. Agent responds with specific, data-backed answers
using real-time context about what the partner is currently viewing.

### 5.1 Context Model

When a partner sends a message, the frontend sends a context snapshot
of what they are currently looking at:

```json
{
  "message": "Why did my error rate spike at 10am?",
  "conversation_id": "uuid | null",
  "context": {
    "current_page": "transactions",
    "page_data": {
      "active_filters": {
        "supplier": "hotelbeds-hotels",
        "date_range": "today"
      },
      "visible_summary": {
        "total": 142,
        "success_rate_pct": 94.1,
        "avg_latency_ms": 820
      },
      "selected_row": null
    }
  }
}
```

Each page registers its context via usePageContext hook whenever
its data or filters change. The agent panel reads this context
and includes it in every message sent to the hub.

### 5.2 Hub Endpoint — POST /v1/agent/chat

```
Request:
{
  message: string,
  conversation_id: string | null,
  context: { current_page, page_data }
}

Hub handler:
1. Load or create hub_agent_conversations for tenant
2. Append { role: "user", content: message, ts } to messages
3. Load live tenant data from DB:
   - hub_tenants (tier, config)
   - hub_tenant_suppliers (active integrations)
   - hub_transactions (last 24hr summary per supplier)
   - hub_escalations (pending count)
   - hub_dedup_config (active config)
4. Assemble system prompt (see Section 5.3)
5. Call Claude API — model: claude-sonnet-4-20250514
   messages: conversation history (last 10) + new user message
6. Append { role: "assistant", content: response, ts } to messages
7. Update hub_agent_conversations
8. Return { conversation_id, response, message_id }

Response:
{
  "conversation_id": "uuid",
  "message_id": "uuid",
  "response": "markdown string"
}
```

### 5.3 System Prompt Template

```
You are the TOS Integration Hub agent for {tenant_name}.
You help partners understand and manage their travel supplier integrations.

TENANT CONTEXT:
- Plan: {tier}
- Active integrations: {integration_list}
- Last 24 hours: {total_txn} transactions, {success_rate}% success rate
- Average latency: {avg_latency}ms
- Pending escalations: {pending_escalations}
- Dedup strategy: {dedup_strategy}

CURRENT PAGE: {current_page}
PAGE DATA: {page_data_json}

CONVERSATION HISTORY:
{last_10_messages}

Guidelines:
- Answer with specific numbers and timestamps from the data
- Be concise — partners are technical, skip explanations of basics
- Suggest actionable next steps when relevant
- If you don't have enough data to answer, say so clearly
- Format responses with markdown where it improves readability
```

### 5.4 Other Agent Endpoints

```
GET  /v1/agent/conversations        — list recent conversations for tenant
GET  /v1/agent/conversations/:id    — full conversation history

GET    /v1/agent/saved-prompts      — list saved prompts for tenant
POST   /v1/agent/saved-prompts      — { label, prompt_text }
DELETE /v1/agent/saved-prompts/:id  — delete saved prompt
```

### 5.5 Panel UI Design

**Header:**
```
TOS Agent              [ + New conversation ]
```

**Empty state (no messages yet):**
```
  Suggested questions:

  [ What's my error rate today?        ]
  [ Show me recent duplicate detections]
  [ Are all my integrations healthy?   ]
  [ What caused my last escalation?    ]
```

**Message thread:**
```
                              You  10:23am
                  Why did my error rate spike at 10am?

  Agent  10:23am
  I can see 3 HotelBeds Hotels auth failures between
  10:02am and 10:07am, causing your error rate to jump
  to 18% in that window. The failures had HTTP 401
  responses — this typically means a credential issue
  or rate limit hit.

  Your error rate returned to normal (0.8%) by 10:08am,
  suggesting it self-resolved. I'd recommend checking
  your HotelBeds API key expiry date in Settings.

                              ★ Save this prompt
```

**Input area:**
```
  Saved: [ Error rate spike ×] [ Dedup check ×] [ + ]

  ┌────────────────────────────────────────────┐
  │ Ask anything about your integration...    │
  └────────────────────────────────────────────┘
                                          [ Send ▶ ]
  New conversation
```

**Loading state:**
```
  Agent  10:24am
  ●●●  (animated typing indicator)
```

### 5.6 Saved Prompts

- Saved prompts appear as chips above the input box
- Click chip: populates input with prompt_text
- ✕ on chip: deletes with inline confirmation
- ★ button on each agent message: saves the user message that
  triggered it as a favourite
  - Click ★ → small inline form: "Name this prompt:" + Save button
  - On save: POST /v1/agent/saved-prompts, chip appears immediately
- Maximum 20 saved prompts per tenant
- "+" chip at end: opens prompt text input to save custom prompt

### 5.7 Conversation Persistence

- Conversation continues as long as panel stays open or same
  conversation_id is used
- "New conversation" button: clears frontend messages array,
  sets conversation_id = null (hub creates new record on next message)
- Conversations stored in hub_agent_conversations — partner can
  continue where they left off if they reload (load latest conversation
  on panel open if < 24hrs old)

---

## 6. Integrations Page

**Purpose:** View and manage supplier integrations. Add new via wizard.

### Hub Endpoints
```
GET /v1/dashboard/suppliers
Response: {
  "integrations": [{
    "supplier_slug": "hotelbeds-hotels",
    "name": "HotelBeds Hotels",
    "categories": ["HOTEL"],
    "status": "UP | DEGRADED | DOWN",
    "sla_tier": "ENTERPRISE",
    "operations": ["search","book","cancel","get"],
    "last_test_run": {
      "status": "PASS | FAIL",
      "ran_at": "ISO8601",
      "steps_passed": 6,
      "steps_total": 6
    },
    "credential_rotation_due": "YYYY-MM-DD",
    "activated_at": "ISO8601"
  }]
}

POST /v1/dashboard/suppliers/:slug/test
Response: { "session_id": "uuid", "message": "Test suite started" }
```

### Integration Card
```
┌─────────────────────────────────────────────┐
│ HotelBeds Hotels      [ ✓ UP ] [ENTERPRISE] │
│ Categories: HOTEL                           │
│ Operations: search · book · cancel · get    │
│                                             │
│ Last test: ✓ PASS — 6/6 steps              │
│ Ran: 6 hours ago                           │
│ Credential rotation due: Jul 13 2026        │
│                                             │
│ [ Run Tests ]                   [ Details ] │
└─────────────────────────────────────────────┘
```

### Onboarding Wizard — 8 Steps
See CLAUDE.md Layer 6 for full step-by-step implementation.
Steps map to hub prompt path stages (PRD hub Section 7.5).

Progress bar: Step N of 8 ●●●●●○○○

| Step | Title | Key Actions |
|------|-------|-------------|
| 1 | Supplier Identity | Name, categories, doc URL → hub fetches docs |
| 2 | Authentication | Confirm auth type + credential fields |
| 3 | API Contract | Review detected operations, confirm/edit |
| 4 | CTS Mapping | Review + edit proposed field mapping table |
| 5 | Test Config | Sandbox search params JSON editor |
| 6 | Tenant Config | SLA tier + preferred categories |
| 7 | Review | Full manifest summary |
| 8 | Validation | Live 6-step validation progress |

---

## 7. Transactions Page

**Purpose:** Searchable activity log of all hub transactions.

### Hub Endpoint
```
GET /v1/dashboard/transactions
Query: supplier_slug, operation, status, from_date, to_date, page, limit

Response: {
  "transactions": [{
    "txn_id": "uuid",
    "supplier_slug": "hotelbeds-hotels",
    "operation": "search",
    "status": "SUCCESS | ERROR | DEDUP_SUPPRESSED | NORMALIZATION_FAILED",
    "latency_ms": 380,
    "source": "LIVE | INTEGRATION_TEST | ONBOARDING",
    "created_at": "ISO8601"
  }],
  "total": 1420,
  "page": 1,
  "pages": 29,
  "summary": { "success_rate_pct": 99.1, "avg_latency_ms": 380 }
}
```

### Layout
Filter bar → summary bar → table → pagination

Status colors: SUCCESS=green, ERROR=red, DEDUP_SUPPRESSED=grey, NORMALIZATION_FAILED=amber

Row expand: full txn_id, hashes, error message if ERROR

CSV Export: all filtered records, filename tos-transactions-{date}.csv

Page context registered: { active_filters, summary } — so agent knows
what the partner is currently looking at when they ask questions.

---

## 7B. Inventory Page

**Purpose:** Browse the local static inventory cache. Partners can
explore what content is cached locally, check sync health, and
ask the agent questions about their inventory without live API calls.

### Hub Endpoints
```
GET /v1/dashboard/inventory
Query: type, supplier_slug, city, category, page, limit
Response: {
  "records": [{
    "id": "uuid",
    "supplier_slug": "hotelbeds-hotels",
    "type": "HOTEL",
    "title": "Hotel Arts Barcelona",
    "city": "Barcelona",
    "country": "ES",
    "latitude": 41.3874,
    "longitude": 2.1686,
    "category": null,
    "star_rating": 5.0,
    "is_active": true,
    "last_synced_at": "ISO8601"
  }],
  "total": 4200,
  "sync_summary": {
    "last_run": "ISO8601",
    "status": "OK",
    "records_active": 4200,
    "records_inactive": 12
  }
}

GET /v1/dashboard/inventory/sync-history
Response: { jobs: [{ supplier_slug, status, records_upserted,
  records_deactivated, records_errored, started_at, completed_at }] }

POST /v1/admin/sync/run/:supplier_slug   (admin only)
```

### Layout
```
Filter bar: [ Type ▼ ] [ Supplier ▼ ] [ City search ] [ Category ▼ ]

Sync status bar:
  Last sync: 6 hours ago  ● OK
  [ HotelBeds Hotels: 300,421 records ] [ HotelBeds Activities: 18,203 ]
  [ HotelBeds Transfers: 24,018 ] [ Bridgify: pending ]

Inventory table:
  Title | Type | Supplier | City | Category | Star | Synced | Active
  ─────────────────────────────────────────────────────────────────
  Hotel Arts Barcelona | HOTEL | HotelBeds | Barcelona | — | ★★★★★ | 6h ago | ✓
  Eiffel Tower Tour    | EXPERIENCE | Bridgify | Paris | CULTURE | — | 6h ago | ✓

Row expand: full record detail including raw_content preview
```

### Agent Context
Inventory page registers:
```js
register('inventory', {
  active_filters: { type, supplier_slug, city, category },
  visible_count: records.length,
  sync_status: sync_summary
})
```

This lets the agent answer questions like:
- "How many hotels do we have cached in Barcelona?"
- "When was the last successful sync for HotelBeds?"
- "Show me all experiences in Paris with category CULTURE"

---

## 8. Intelligence Page

**Purpose:** Tune dedup behaviour, review decisions, manage prompts,
resolve escalations.

Four tabs: Dedup Config | Dedup Log | Escalations | Prompts

### Hub Endpoints
```
GET  /v1/dashboard/dedup-config    → active config for tenant
PATCH /v1/dashboard/dedup-config   → update config_json fields

GET /v1/dashboard/dedup-log
Query: decision, page, limit
Response: { decisions: [{
  option_id_a, option_id_b, title_a, supplier_a,
  title_b, supplier_b, signal_location, signal_name,
  signal_duration, signal_category, composite_score,
  decision, strategy_applied, created_at
}], total }

GET /v1/dashboard/escalations
Query: status (PENDING|RESOLVED|EXPIRED)
Response: { escalations: [{ id, prompt_key, status, trigger_data,
  created_at, expires_at }] }

POST /v1/admin/escalation/:id/resolve
Body: { resolution: string, action: string }

GET  /v1/dashboard/prompts
PATCH /v1/dashboard/prompts/:id    → { is_active: bool }
```

### Tab 1: Dedup Config
Sliders for all thresholds, weight inputs (must sum to 1.0),
strategy selector, uncertain behavior selector, test mode toggle.
Save disabled if weights ≠ 1.0.

### Tab 2: Dedup Log
Table: Product A | Product B | Score | Decision | Signal bars
Filter by decision type. Row expand shows full signal breakdown.

### Tab 3: Escalations
EscalationCard per item: prompt_key, trigger summary, age, Resolve button.
Resolve opens modal with action dropdown + resolution text.

### Tab 4: Prompts
PromptCard per prompt: key, category badge, trigger condition,
escalate_to_human flag, active toggle.
Category filter tabs: All | Inventory | Integration | Pricing | Policy

---

## 9. Settings Page

**Purpose:** API key management, webhook registration.

### Hub Endpoints
```
GET /v1/dashboard/settings
Response: {
  tenant_name, tier, email,
  api_key_preview: "****a3f2",
  webhooks: [{ id, event_type, endpoint_url, is_active }]
}

POST /v1/dashboard/settings/rotate-key
Response: { new_api_key: "full key — shown ONCE" }

POST /v1/dashboard/settings/webhooks
Body: { event_type, endpoint_url }

DELETE /v1/dashboard/settings/webhooks/:id
```

### Sections
1. Account: tenant name, tier badge, email
2. API Key: masked display, Rotate button with confirmation modal,
   new key shown once with copy button + "not shown again" warning
3. Webhooks: list with delete, Add Webhook form
4. Notification email: update email for escalation alerts

---

## 10. All Hub Endpoints Required

| Endpoint | Method | Notes |
|----------|--------|-------|
| /v1/auth/magic-link | POST | Public |
| /v1/auth/verify/:token | GET | Public |
| /v1/agent/chat | POST | JWT auth |
| /v1/agent/conversations | GET | JWT auth |
| /v1/agent/conversations/:id | GET | JWT auth |
| /v1/agent/saved-prompts | GET | JWT auth |
| /v1/agent/saved-prompts | POST | JWT auth |
| /v1/agent/saved-prompts/:id | DELETE | JWT auth |
| /v1/dashboard/overview | GET | JWT auth |
| /v1/dashboard/suppliers | GET | JWT auth |
| /v1/dashboard/suppliers/:slug/test | POST | JWT auth |
| /v1/dashboard/transactions | GET | JWT auth |
| /v1/dashboard/dedup-config | GET | JWT auth |
| /v1/dashboard/dedup-config | PATCH | JWT auth |
| /v1/dashboard/dedup-log | GET | JWT auth |
| /v1/dashboard/escalations | GET | JWT auth |
| /v1/dashboard/prompts | GET | JWT auth |
| /v1/dashboard/prompts/:id | PATCH | JWT auth |
| /v1/dashboard/settings | GET | JWT auth |
| /v1/dashboard/settings/rotate-key | POST | JWT auth |
| /v1/dashboard/settings/webhooks | POST | JWT auth |
| /v1/dashboard/settings/webhooks/:id | DELETE | JWT auth |
| /v1/admin/escalation/:id/resolve | POST | Admin auth |
| /v1/dashboard/inventory | GET | JWT auth |
| /v1/dashboard/inventory/sync-history | GET | JWT auth |
| /v1/admin/sync/run/:supplier_slug | POST | Admin auth |
| /v1/admin/sync/status | GET | Admin auth |
| /v1/search/local | POST | JWT auth |

All JWT-auth endpoints: extract tenant_id from JWT, scope all DB
queries to that tenant_id. Never trust tenant_id from request body.

---

## 11. Design System

| Token | Value | Usage |
|-------|-------|-------|
| Primary | #0D3B6E | Sidebar, headings |
| Accent | #1A56A0 | Buttons, links, active nav |
| Teal | #0E7490 | Badges, secondary actions |
| Success | #065F46 | UP, pass, green |
| Warning | #92400E | DEGRADED, uncertain |
| Danger | #991B1B | DOWN, error |
| Page bg | #F9FAFB | Content area |
| Card bg | #FFFFFF | Cards |
| Agent panel bg | #F8FAFC | Agent panel background |
| User msg bg | #1A56A0 | User message bubbles |
| Agent msg bg | #FFFFFF | Agent message cards |
| Text primary | #111827 | Body |
| Text secondary | #6B7280 | Labels, captions |
| Border | #E5E7EB | Dividers |

Font: Inter (Google Fonts)
Border radius: 8px cards, 20px message bubbles, 6px buttons
Shadow: shadow-sm on cards, shadow-md on agent panel when open

---

## 12. Success Criteria

| Metric | Target |
|--------|--------|
| Magic link auth | End-to-end < 30 seconds |
| Agent responds | Within 5 seconds for typical questions |
| Page context | Agent knows current page + data when answering |
| Saved prompts | Appear as chips, populate input on click |
| All 5 pages | Render correctly with mocked data |
| Tenant isolation | No cross-tenant data leakage |
| Overview refresh | Every 30 seconds without reload |
| Wizard completes | All 8 steps, promotes integration |
| All Vitest tests | Pass |
| Inventory page | Renders sync status + browsable records |
| Overview sync row | Shows correct sync health per supplier |
| Screenshots | Clean at 1280px open + closed panel |

---

## 13. Out of Scope (Phase 1)

- TOS Admin cross-tenant view
- Team member management
- Billing and invoice view
- Mobile responsive layout
- Dark mode
- Real-time websocket streaming (polling + request/response is fine)
- Agent voice interface
- Exporting conversation history
