# TOS Frontend — Host Embedding Guide

The TOS Frontend is a self-contained IIFE bundle (`dist/tos-frontend.js`).
Any host runtime — Flask, Express, Next.js, static CDN, or Bridgify — can
embed it with three lines of HTML. No framework, no build tool, no npm.

---

## Quick Start

```html
<script>
  window.TOS_CONFIG = {
    apiBase:  "https://api.tos-hub.com",
    tenantId: "acme-travel",
    auth:     { token: "your-api-key" }
  };
</script>
<div id="tos-root"></div>
<script src="https://cdn.tos-hub.com/tos-frontend.js"></script>
```

That's the full contract. The bundle injects its own CSS, mounts into
`#tos-root`, and boots in one of two modes depending on `pageSlug`.

---

## TOS_CONFIG Reference

`window.TOS_CONFIG` **must be set before the bundle loads**. All keys are
optional — the bundle has safe defaults for every field.

```js
window.TOS_CONFIG = {
  // ── Required for production ─────────────────────────────────────────
  apiBase:   "https://api.tos-hub.com",   // Integration Hub base URL
  tenantId:  "acme-travel",              // your hub tenant ID

  // ── Auth ───────────────────────────────────────────────────────────
  auth: {
    token: "your-api-key",   // partner API key — sent as Bearer token
                              // falls back to localStorage 'tos_jwt'
  },

  // ── Boot mode ──────────────────────────────────────────────────────
  pageSlug: null,            // null  → client-side router mode (default)
                              // "home" → loads named page manifest from hub

  // ── Branding ───────────────────────────────────────────────────────
  branding: {
    primaryColor: "#0D3B6E",           // overrides CSS --tos-primary
    logoUrl:      "/logo.png",         // shown in the header
    fontFamily:   "Inter",             // CSS font-family value
  },
};
```

### Field defaults

| Field | Default | Notes |
|-------|---------|-------|
| `apiBase` | `http://localhost:3000` | Override in production |
| `tenantId` | `null` | Required for page manifests + consumer chat |
| `auth.token` | `null` | Sent as `Authorization: Bearer` on all requests |
| `pageSlug` | `null` | `null` enables router mode |
| `branding.primaryColor` | `#0D3B6E` | Applied to `--tos-primary` CSS var |
| `branding.logoUrl` | `null` | No logo shown if null |
| `branding.fontFamily` | `Inter` | Applied to `--tos-font` CSS var |

---

## Boot Modes

### Router Mode (`pageSlug: null`)

The bundle owns all routing inside `#tos-root` using the History API.
Use this for a standalone travel site where TOS manages the full URL tree.

```
/            → home page (carousels + hero)
/hotels      → hotel browse grid
/experiences → experience browse grid
/transfers   → transfer browse grid
/attractions → points of interest
/search      → search results
/product/:id → product detail
/book/:id    → booking form
/booking/:ref → confirmation
```

The host must configure its web server to serve the same HTML for all
these paths (SPA fallback / catch-all route).

**Flask:**
```python
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def catch_all(path):
    return render_template("travel_site.html", tos=tos_config())
```

**Express:**
```js
app.get('*', (req, res) => res.send(renderPage({ config: tosConfig() })));
```

**nginx:**
```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

---

### Manifest Mode (`pageSlug: "home"`)

The bundle fetches the named page manifest from the hub, renders the
declared components once, then stops. No client-side routing. The host
site keeps full control of the URL.

Use this to embed a single TOS travel widget inside a larger site.

```html
<script>
  window.TOS_CONFIG = {
    apiBase:  "https://api.tos-hub.com",
    tenantId: "acme-travel",
    pageSlug: "home",            // loads hub_page_manifests WHERE slug = 'home'
    auth:     { token: "..." }
  };
</script>
<div id="tos-root"></div>
<script src="/static/tos-frontend.js"></script>
```

Page manifests are created and edited in the **Partner Dashboard → Page Builder**.

---

## Events

The bundle emits and listens for these custom events on `window`:

### Dispatched by the bundle

| Event | `detail` | Description |
|-------|----------|-------------|
| `tos:navigate` | `{ path: string }` | User navigated to a new page |
| `tos:auth-expired` | — | 401 received — token is invalid/expired |
| `tos:chat-open` | — | Consumer chat panel opened |
| `tos:chat-close` | — | Consumer chat panel closed |

### Consumed by the bundle

| Event | `detail` | Description |
|-------|----------|-------------|
| `tos:navigate` | `{ path: string }` | Dispatch to programmatically navigate |

**Intercept navigation (e.g. open in modal):**
```js
window.addEventListener('tos:navigate', (e) => {
  if (e.detail.path.startsWith('/product/')) {
    e.stopPropagation();
    openProductModal(e.detail.path.split('/product/')[1]);
  }
});
```

**Navigate programmatically:**
```js
// From your site's own code
window.TOS.navigate('/hotels');
// or
window.dispatchEvent(new CustomEvent('tos:navigate', { detail: { path: '/search?q=rome' } }));
```

---

## Global API (`window.TOS`)

After the bundle loads, `window.TOS` is available:

```js
window.TOS.version          // "1.0.0"
window.TOS.config           // the resolved config object (read-only reference)
window.TOS.navigate(path)   // programmatic navigation
```

---

## Serving the Bundle

### Option A — copy from dist
```bash
cp tos-frontend/dist/tos-frontend.js your-app/static/
```

### Option B — CDN
```html
<script src="https://cdn.tos-hub.com/v1/tos-frontend.js"></script>
```

### Option C — Express static middleware
```js
app.use('/static', express.static(path.join(__dirname, 'public')));
// Copy tos-frontend.js into public/
```

### Option D — Flask static
```python
# Flask auto-serves files from static/
# Copy tos-frontend.js to static/tos-frontend.js
```
```html
<script src="{{ url_for('static', filename='tos-frontend.js') }}"></script>
```

The bundle is self-contained: **no separate CSS file, no fonts to host**.
One `<script>` tag is all that is required.

---

## CORS Configuration

The Integration Hub must allow requests from your host domain.
Set the `DASHBOARD_APP_URL` environment variable on the hub, or configure
the CORS middleware to include your host origin:

```
DASHBOARD_APP_URL=https://your-travel-site.com
```

For development with multiple origins, the hub defaults to `Access-Control-Allow-Origin: *`.

---

## Security Notes

- **Never** set `auth.token` to an admin or dashboard JWT. Use only the partner API key.
- The API key is visible in the browser. This is by design — catalog browsing is public.
  The key scopes results to your tenant and enforces rate limits.
- Booking endpoints require a valid token and are rate-limited per tenant tier.
- The consumer chat endpoint (`/v1/consumer/chat`) accepts the same API key and is
  limited to travel-assistant responses — no B2B data is exposed.

---

## Reference Implementations

| Runtime | Location |
|---------|----------|
| Flask (Python) | `examples/flask/` |
| Express (Node.js) | `examples/express/` |

Each example includes:
- Environment variable wiring
- Router mode (full-site) and manifest mode (embedded widget) routes
- Branding configuration
- `.env.example` with all required variables

---

## Checklist for Go-Live

- [ ] `apiBase` points to your production Integration Hub URL
- [ ] `tenantId` matches your `hub_tenants.tenant_id`  
- [ ] `auth.token` is your production API key
- [ ] CORS configured on the hub for your domain
- [ ] SPA fallback route configured (router mode only)
- [ ] `tos-frontend.js` served with `Cache-Control: max-age=3600`
- [ ] `branding.logoUrl` and `branding.primaryColor` set to your brand
- [ ] At least one page manifest created in the Partner Dashboard (manifest mode)
- [ ] Consumer chat tested end-to-end (requires `tenantId` + valid `auth.token`)
