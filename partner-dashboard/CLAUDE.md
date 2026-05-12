# TOS Partner Dashboard — Claude Code Instructions
# Scope: wandervault/partner-dashboard/

---

## Read First
1. Read this file completely
2. Read ../CLAUDE.md (root) for repo-wide rules
3. Read PRD.md in this directory — full specification
4. Read ../integration_hub/PRD.md Section 10 for hub API endpoints

---

## What You Are Building
A multi-tenant React SPA dashboard for B2B partners of the TOS
Integration Hub. Each partner logs in via magic link and sees only
their own data. A persistent agent panel is available on every page —
partners can ask the agent questions about their integration in natural
language and the agent responds with data-backed answers.

Authentication: magic link via email (Resend). No passwords.
Framework: React 18 + Vite
Styling: Tailwind CSS
Charts: Recharts
HTTP: axios with JWT interceptor
Testing: Vitest + React Testing Library

---

## Your Job
Build, test, and iterate autonomously. Run tests after every layer.
Fix failures before moving to the next layer.

You must also add the required dashboard API endpoints to
../integration_hub/src/index.js as you build each section.
Both hub additions and dashboard frontend must have passing tests
before moving to the next layer.

---

## Project Structure to Create

```
partner-dashboard/
├── CLAUDE.md
├── PRD.md
├── package.json
├── vite.config.js
├── tailwind.config.js
├── index.html
├── .env.example
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── api/
│   │   ├── client.js              ← axios instance + JWT interceptor
│   │   ├── auth.js                ← magic link requests
│   │   ├── dashboard.js           ← all dashboard API calls
│   │   └── agent.js              ← agent chat + saved prompts API
│   ├── auth/
│   │   ├── MagicLinkForm.jsx
│   │   ├── VerifyToken.jsx
│   │   └── useAuth.js
│   ├── layout/
│   │   ├── Shell.jsx              ← sidebar + content + agent panel
│   │   ├── Sidebar.jsx
│   │   └── Topbar.jsx
│   ├── agent/
│   │   ├── AgentPanel.jsx         ← collapsible right panel
│   │   ├── AgentMessage.jsx       ← single message bubble
│   │   ├── AgentInput.jsx         ← input + send + saved prompts
│   │   ├── SavedPromptChip.jsx    ← clickable saved prompt chip
│   │   ├── useAgent.js            ← conversation state + streaming
│   │   └── usePageContext.js      ← captures current page + data
│   ├── pages/
│   │   ├── Overview.jsx
│   │   ├── Integrations.jsx
│   │   ├── Transactions.jsx
│   │   ├── Intelligence.jsx
│   │   └── Settings.jsx
│   ├── components/
│   │   ├── SupplierStatus.jsx
│   │   ├── MetricCard.jsx
│   │   ├── VolumeChart.jsx
│   │   ├── LatencyChart.jsx
│   │   ├── TransactionTable.jsx
│   │   ├── DedupLogTable.jsx
│   │   ├── EscalationCard.jsx
│   │   ├── PromptCard.jsx
│   │   ├── DedupConfigEditor.jsx
│   │   └── OnboardingWizard.jsx
│   └── hooks/
│       ├── useOverview.js
│       ├── useTransactions.js
│       ├── useIntegrations.js
│       └── useIntelligence.js
└── tests/
    ├── auth.test.jsx
    ├── agent.test.jsx
    ├── overview.test.jsx
    ├── transactions.test.jsx
    └── integrations.test.jsx
```

---

## Build Order — Follow This Exactly

### Layer 1: Project Setup
- Create package.json with all dependencies listed below
- Create vite.config.js — proxy /api to hub at localhost:3000
- Create tailwind.config.js
- Create index.html
- Create .env.example
- Create src/main.jsx and src/App.jsx with React Router:
  Routes: /login, /verify/:token, /dashboard (protected),
  /dashboard/integrations, /dashboard/transactions,
  /dashboard/intelligence, /dashboard/settings
- TEST: app renders without errors, all routes resolve
- GREEN before proceeding

### Layer 2: Magic Link Auth

**Hub additions first** — add to ../integration_hub/src/index.js:

Add hub_auth_tokens table to hub migration:
```sql
CREATE TABLE hub_auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  VARCHAR NOT NULL UNIQUE,
  tenant_id   VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  used        BOOLEAN DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

Add hub_saved_prompts table (used in Layer 4):
```sql
CREATE TABLE hub_saved_prompts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  label        VARCHAR NOT NULL,
  prompt_text  TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

Add hub_agent_conversations table (used in Layer 4):
```sql
CREATE TABLE hub_agent_conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    VARCHAR NOT NULL REFERENCES hub_tenants(tenant_id),
  messages     JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
```

Hub endpoints:
- POST /v1/auth/magic-link — accepts { email }, looks up hub_tenants
  by email, generates 32-byte crypto token, stores SHA256 hash in
  hub_auth_tokens (expires 15min), sends email via Resend,
  returns { message: "check your email" }
- GET /v1/auth/verify/:token — SHA256 hash incoming token, look up in
  hub_auth_tokens, check not used + not expired, mark used,
  return signed JWT { tenant_id, tenant_name, tier, email, exp: 7days }

Dashboard frontend:
- Implement src/api/client.js — axios base instance, JWT interceptor
  reads localStorage key 'tos_jwt', adds Authorization: Bearer header,
  on 401 response: clear localStorage + redirect /login
- Implement src/api/auth.js — requestMagicLink(email), verifyToken(token)
- Implement src/auth/MagicLinkForm.jsx — email input, submit button,
  loading state, success state "Check your email for your login link"
- Implement src/auth/VerifyToken.jsx — reads :token param, calls
  verifyToken(), stores JWT in localStorage, redirects /dashboard
- Implement src/auth/useAuth.js — decodes JWT from localStorage,
  exposes { tenant, isAuthenticated, logout }
- Protected route wrapper component
- TEST: magic link request calls hub, verify stores JWT and redirects,
  protected route blocks unauthenticated users
- GREEN before proceeding

### Layer 3: Shell Layout
- Implement src/layout/Shell.jsx:
  Three-column layout:
  [Sidebar 240px fixed] [Content flex-1] [AgentPanel 360px collapsible]
  AgentPanel starts collapsed. Toggle button on right edge of content area.
  When expanded: content area shrinks, panel slides in from right.
- Implement src/layout/Sidebar.jsx:
  - TOS wordmark at top (white text on dark blue #0D3B6E)
  - Nav links: Overview, Integrations, Transactions, Intelligence, Settings
  - Active state: white bg with opacity, accent left border
  - Bottom: tenant name + tier badge + logout button
- Implement src/layout/Topbar.jsx:
  - Page title (from current route)
  - Right: Agent toggle button with chat bubble icon
  - Shows unread indicator dot if agent has responded while panel closed
- TEST: shell renders, nav links route correctly, agent panel
  toggles open/closed, active nav state highlights correctly
- GREEN before proceeding

### Layer 4: Agent Panel

**Hub additions:**

POST /v1/agent/chat — core endpoint:
```js
// Request body:
{
  message: "string",
  conversation_id: "uuid | null",  // null = start new conversation
  context: {
    current_page: "overview | integrations | transactions | intelligence | settings",
    page_data: {}  // whatever the frontend sends about current view
  }
}

// Hub handler:
// 1. Load or create hub_agent_conversations record for tenant
// 2. Append user message to messages array
// 3. Assemble full agent context:
//    - Tenant config from hub_tenants
//    - Active integrations from hub_tenant_suppliers
//    - Last 24hr transaction summary from hub_transactions
//    - Active escalations from hub_escalations
//    - Current dedup config from hub_dedup_config
//    - Page context from request body
//    - Conversation history (last 10 messages)
// 4. Call Claude API (claude-sonnet-4-20250514) with assembled context
// 5. Append assistant response to messages array
// 6. Update hub_agent_conversations
// 7. Return { conversation_id, response, message_id }
```

GET /v1/agent/conversations — list recent conversations for tenant
GET /v1/agent/conversations/:id — get full conversation history

GET /v1/agent/saved-prompts — list saved prompts for tenant
POST /v1/agent/saved-prompts — save a new prompt { label, prompt_text }
DELETE /v1/agent/saved-prompts/:id — delete saved prompt

**Dashboard frontend:**

Implement src/api/agent.js:
- sendMessage(message, conversationId, context)
- getSavedPrompts()
- savePrompt(label, promptText)
- deleteSavedPrompt(id)
- getConversations()

Implement src/agent/usePageContext.js:
- React context hook that any page can use to register its current data
- Exposes registerPageContext(page, data) — called by each page
  when its data loads or filters change
- Returns currentContext = { current_page, page_data }
- Shell passes currentContext to AgentPanel

Implement src/agent/useAgent.js:
- Manages conversation state: messages[], conversationId, isLoading
- sendMessage(text) — calls api/agent.js, appends to messages
- startNewConversation() — clears messages, sets conversationId null
- loadSavedPrompts() — fetches and caches

Implement src/agent/SavedPromptChip.jsx:
- Small chip button showing prompt label
- On click: populates agent input with prompt_text
- Star/bookmark icon to indicate saved
- X icon to delete (with confirmation)

Implement src/agent/AgentInput.jsx:
- Saved prompt chips row above input (scrollable horizontally)
  "Save Favourites" empty state if none saved
- Textarea for message input (auto-resize, max 4 lines)
- Send button (disabled when empty or loading)
- "New conversation" link — clears history
- On any agent response: show ★ icon to save that prompt as favourite
  Clicking ★ opens small modal: enter label → saves to hub

Implement src/agent/AgentMessage.jsx:
- User messages: right-aligned, accent blue background
- Agent messages: left-aligned, white card with subtle shadow
- Agent messages support markdown rendering (use marked.js)
- Timestamp on each message
- ★ Save button on agent messages only

Implement src/agent/AgentPanel.jsx:
- Header: "TOS Agent" title + "New conversation" button
- Messages area: scrollable, auto-scrolls to latest
- AgentInput at bottom
- Loading state: typing indicator (three animated dots)
- Empty state: suggested prompts grid:
  "What's my error rate today?"
  "Show me recent duplicate detections"
  "Are all my integrations healthy?"
  "What caused my last escalation?"
- When panel opens: focus the input automatically

Page context wiring — each page calls registerPageContext on mount
and when data changes:
- Overview: { current_page: 'overview', page_data: { suppliers, metrics } }
- Transactions: { current_page: 'transactions', page_data: { active_filters, summary } }
- Integrations: { current_page: 'integrations', page_data: { integrations } }
- Intelligence: { current_page: 'intelligence', page_data: { active_tab } }
- Settings: { current_page: 'settings', page_data: {} }

TEST: message sends and response renders, saved prompts load as chips,
clicking chip populates input, saving prompt from response works,
page context updates when navigating between pages,
new conversation clears history
- GREEN before proceeding

### Layer 5: Overview Page

**Hub additions:**
GET /v1/dashboard/overview — returns health snapshot scoped to tenant:
```json
{
  "suppliers": [
    { "slug": "hotelbeds-hotels", "name": "HotelBeds Hotels",
      "status": "UP", "latency_p95_ms": 420,
      "error_rate_pct": 0.2, "transactions_24h": 340 }
  ],
  "transactions": {
    "total_24h": 1420, "success_rate_pct": 99.1,
    "avg_latency_ms": 380,
    "volume_by_hour": [{ "hour": "2026-04-13T00:00:00Z", "count": 58 }]
  },
  "agent_sessions": { "active": 2, "completed_24h": 34, "failed_24h": 1 },
  "escalations": { "pending": 1, "resolved_24h": 3 },
  "dedup": { "duplicate_24h": 42, "uncertain_24h": 8, "distinct_24h": 380 }
}
```

**Dashboard frontend:**
- Implement src/hooks/useOverview.js — polls every 30 seconds,
  calls registerPageContext with supplier + metrics data on each fetch
- Implement src/components/MetricCard.jsx — label, value, trend indicator
- Implement src/components/SupplierStatus.jsx:
  UP = green badge, DEGRADED = amber, DOWN = red
- Implement src/components/VolumeChart.jsx:
  Recharts LineChart, transactions per hour, last 24hrs
  Two lines: total (blue) vs errors (red)
- Implement src/pages/Overview.jsx:
  Row 1: supplier status badges
  Row 2: 4 metric cards (Transactions, Success Rate, Active Sessions,
          Pending Escalations)
  Row 3: volume chart full width
  Row 4: dedup summary 3 cards
- TEST: renders with mocked data, polling fires every 30s,
  page context registered with correct data shape
- GREEN before proceeding

### Layer 6: Integrations Page

**Hub additions:**
- GET /v1/dashboard/suppliers
- POST /v1/dashboard/suppliers/:slug/test

**Dashboard frontend:**
- Implement src/hooks/useIntegrations.js — fetches + registers context
- Implement src/components/OnboardingWizard.jsx — 8-step wizard
  per PRD.md Section 6
- Implement src/pages/Integrations.jsx — integration cards + wizard
- TEST: cards render, run tests triggers hub, wizard progresses steps
- GREEN before proceeding

### Layer 7: Transactions Page

**Hub additions:**
- GET /v1/dashboard/transactions (paginated + filtered)

**Dashboard frontend:**
- Implement src/hooks/useTransactions.js — filter state + pagination,
  registers context with active_filters + summary
- Implement src/components/TransactionTable.jsx
- Implement src/pages/Transactions.jsx — filters + table + CSV export
- TEST: filters update results, pagination works, CSV downloads
- GREEN before proceeding

### Layer 8: Intelligence Page

**Hub additions:**
- GET/PATCH /v1/dashboard/dedup-config
- GET /v1/dashboard/dedup-log
- GET /v1/dashboard/escalations
- GET/PATCH /v1/dashboard/prompts
- POST /v1/admin/escalation/:id/resolve

**Dashboard frontend:**
- Implement src/components/DedupConfigEditor.jsx
- Implement src/components/DedupLogTable.jsx
- Implement src/components/EscalationCard.jsx
- Implement src/components/PromptCard.jsx
- Implement src/pages/Intelligence.jsx — 4 tabs
- TEST: config saves, escalation resolves, prompt toggle works
- GREEN before proceeding

### Layer 9: Settings Page

**Hub additions:**
- GET /v1/dashboard/settings
- POST /v1/dashboard/settings/rotate-key
- POST /v1/dashboard/settings/webhooks
- DELETE /v1/dashboard/settings/webhooks/:id

**Dashboard frontend:**
- Implement src/pages/Settings.jsx — account, API key, webhooks,
  notification email sections
- TEST: key rotation shows warning + new key once, webhook CRUD works
- GREEN — partner dashboard is feature complete

---

## Environment Variables
```
VITE_API_BASE_URL=http://localhost:3000
VITE_APP_NAME=TOS Partner Portal
```

---

## Dependencies
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "axios": "^1.6.0",
    "recharts": "^2.12.0",
    "marked": "^12.0.0",
    "@headlessui/react": "^1.7.0",
    "@heroicons/react": "^2.1.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "vitest": "^1.4.0",
    "@testing-library/react": "^14.2.0",
    "@testing-library/user-event": "^14.5.0",
    "msw": "^2.2.0"
  }
}
```

---

## Design System
- Primary: #0D3B6E (sidebar, headings)
- Accent: #1A56A0 (buttons, links, active states)
- Teal: #0E7490 (secondary, badges)
- Success: #065F46 (UP, pass)
- Warning: #92400E (DEGRADED, uncertain)
- Danger: #991B1B (DOWN, error)
- Page bg: #F9FAFB
- Card bg: #FFFFFF
- Text primary: #111827
- Text secondary: #6B7280
- Border: #E5E7EB
- Agent panel bg: #F8FAFC
- User message bg: #1A56A0 (white text)
- Agent message bg: #FFFFFF (dark text)
- Font: Inter (Google Fonts)
- Border radius: 8px cards, 6px buttons, 20px message bubbles

---

## Key Implementation Notes

### JWT Structure
```js
{ tenant_id, tenant_name, tier, email, iat, exp }
// exp = 7 days from issue
```

### Axios Interceptor
```js
client.interceptors.request.use(config => {
  const token = localStorage.getItem('tos_jwt');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
client.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('tos_jwt');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
```

### Vite Proxy
```js
export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: path => path.replace(/^\/api/, '')
      }
    }
  }
}
```

### Agent Context Assembly (hub side)
```js
// POST /v1/agent/chat handler
const systemPrompt = `
You are the TOS Integration Hub agent for ${tenant.name}.
You have access to real-time data about their integrations.

TENANT CONTEXT:
- Tier: ${tenant.tier}
- Active integrations: ${integrations.map(i => i.name).join(', ')}
- Last 24hr transactions: ${summary.total_24h} total, ${summary.success_rate_pct}% success
- Active escalations: ${escalations.pending} pending
- Dedup strategy: ${dedupConfig.strategy}

CURRENT PAGE: ${context.current_page}
PAGE DATA: ${JSON.stringify(context.page_data)}

Answer questions about their integration data concisely and accurately.
When referencing data, be specific with numbers and times.
Suggest actionable next steps where relevant.
`;
```

### Page Context Hook Pattern
```js
// src/agent/usePageContext.js
const PageContext = createContext(null);

export const PageContextProvider = ({ children }) => {
  const [ctx, setCtx] = useState({ current_page: null, page_data: {} });
  const register = useCallback((page, data) => {
    setCtx({ current_page: page, page_data: data });
  }, []);
  return (
    <PageContext.Provider value={{ ctx, register }}>
      {children}
    </PageContext.Provider>
  );
};

// In each page component:
const { register } = usePageContext();
useEffect(() => {
  if (data) register('transactions', { active_filters, summary });
}, [data, active_filters]);
```

### Magic Link Token (hub side)
```js
import { randomBytes, createHash } from 'crypto';
const token = randomBytes(32).toString('hex');        // sent in email
const tokenHash = createHash('sha256')
  .update(token).digest('hex');                       // stored in DB
```

### Markdown Rendering in Agent Messages
```js
import { marked } from 'marked';
// In AgentMessage.jsx:
<div
  className="prose prose-sm max-w-none"
  dangerouslySetInnerHTML={{ __html: marked.parse(message.content) }}
/>
```

### Saved Prompt Star Button
```js
// On each agent message — click to save
const handleSave = async () => {
  const label = prompt('Name this prompt:');  // native prompt dialog
  if (label) await api.agent.savePrompt(label, userMessageThatCausedThis);
};
```

---

## Screenshot Testing
After each page + the agent panel:
```powershell
node C:\Users\eranm\.claude\puppeteer\screenshot.js <path> C:\Users\eranm\.claude\tmp\screenshot.png
```
Test at 1280px. Also screenshot with agent panel open (1280px).

---

## Definition of Done
- All 9 layers have passing Vitest tests
- All 5 pages render correctly with mocked data
- Agent panel opens/closes, sends messages, receives responses
- Page context updates when switching pages
- Saved prompts appear as chips, clicking populates input
- Saving a prompt from agent response works
- Magic link auth works end-to-end with hub
- Tenant isolation enforced on all hub endpoints
- Charts render with correct data shapes
- Onboarding wizard completes all 8 steps
- Dedup config editor saves to hub
- Escalations resolvable from dashboard
- Screenshots clean at 1280px with panel open and closed

---

## Do Not
- Show any data from other tenants
- Store JWT in sessionStorage — use localStorage
- Make API calls without JWT interceptor
- Hardcode tenant_id — always from decoded JWT
- Use inline styles — Tailwind only
- Call Claude API from the browser — always via hub backend
- Render markdown without sanitization — use marked.js safely
- Build a page without testing its hub endpoint first


## Decision Rules — Do Not Ask, Just Decide

When you encounter these situations, apply the rule and 
proceed without asking:

| Situation | Decision |
|-----------|----------|
| Existing working code + new PRD | Evolve, never delete. Keep passing tests. |
| Folder name ambiguity (- vs _) | Use whatever exists on disk |
| Schema already has some tables | Add new migration file, never modify existing |
| Test passes but PRD says different | Keep test passing, adapt PRD interpretation |
| Partial implementation exists | Build on top of it, fill the gaps |
| Two valid approaches exist | Pick the simpler one and proceed |
| File already exists | Overwrite only if it conflicts with PRD |

Only stop and ask if you hit a genuine blocker:
- Missing credentials you cannot stub
- A PRD contradiction you cannot resolve
- A failing test you cannot fix after 3 attempts