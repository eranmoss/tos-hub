# Supplier Playbook — Integration Hub

Per-supplier map of auth, endpoints, identifier rules, response envelopes,
booking flows, cancellation support, rate limits, and known quirks.

**When adding a new supplier, fill in a new section below BEFORE writing code.**
**When you discover a quirk at runtime, write it down HERE, not as a buried
code comment.** Every supplier handler must be traceable back to a section
here — this file is the source of truth for "how does supplier X actually
behave?"

File layout per supplier:
1. Quick reference (slug, type, auth, base URLs)
2. Credentials (fields, where they live)
3. Catalog sync (endpoint, pagination, envelope, ID mapping)
4. Detail / availability / book / cancel (lifecycle quirks)
5. Response envelopes (actual shapes returned by each endpoint)
6. Known failure modes & workarounds
7. Rate limits

---

## bridgify — Experiences

### Quick reference
| Key | Value |
|---|---|
| Slug | `bridgify` |
| CTS type | `EXPERIENCE` |
| Auth | OAuth2 client credentials |
| Base URL | `https://api.bridgify.io` |
| Booking model | **Merchant** — server-to-server `POST /bookings/` |
| Cancellation model | **API** — `DELETE /bookings/{ref}/` |

### Credentials
Required fields: `client_id`, `client_secret`.
Stored per tenant in `hub_tenant_credentials`. Token endpoint:
`POST /accounts/token/` form-encoded (`grant_type=client_credentials`,
`scope=read write`). Token cached per client instance, refreshed on 401.

### Catalog sync
Endpoint: `GET /attractions/products/` with `{city_name, text_search, page, page_size}`.

**Quirk:** this endpoint requires search context. Calling it with no
filters returns a small default set — **not** the full catalog.
To accumulate full inventory we iterate ~50 cities × 3 text terms
(`tour`, `experience`, `tickets`) and dedup by id.
See `src/sync/bridgify-experiences.js`.

**ID mapping — CRITICAL:**
`supplier_raw_ref = uuid || id || external_id`.
The detail/availability/book endpoints key off **uuid** (or `id`). Passing
`external_id` to those endpoints returns HTTP 400. Older syncs stored
`external_id` first — the lifecycle handler recovers by reading
`raw_content.uuid` if the stored ref is wrong.

### Detail
`GET /attractions/products/{uuid}/`
Response is wrapped: `{ attraction: { … } }` (sometimes `{ product: … }`).
The extractor checks both.

### Availability
`GET /attractions/products/availability/{uuid}/?date_from=&date_to=`
(Note: `availability` comes **before** the id in the path, unlike most suppliers.)
Response shape: `{ slots: [ { date, times: [ "10:00", "14:00", … ] }, … ] }`.

### Book
`POST /bookings/` with JSON payload:
`{ id, from_date, to_date, holder_name, email, phone, adults }`.
`id` = product uuid (same as detail/availability).
Returns `{ booking_reference, status, ... }`.

**Sandbox note:** ordering is disabled on sandbox keys. The endpoint
returns 404 in sandbox — this is expected. Code is verified structurally;
will work with a production key that has ordering enabled.

### Cancel
`DELETE /bookings/{ref}/` — cancels by booking reference.
Returns cancellation status.

### Known failure modes
- `HTTP 400 on detail` → `supplier_raw_ref` is an `external_id`. Handler
  now falls back to `raw_content.uuid`; fix the sync mapper to prefer uuid.
- `Sync returns ~200 products` → search context not provided; expected
  behaviour. Iterate cities.
- `HTTP 404 on POST /bookings/` → sandbox key has ordering disabled.
  Expected; will work with production key.

### Rate limits
No documented public limit. We self-impose 60 rpm per client instance.

---

## hotelbeds-hotels — Hotels

### Quick reference
| Key | Value |
|---|---|
| Slug | `hotelbeds-hotels` |
| CTS type | `HOTEL` |
| Auth | HMAC_SHA256 |
| Sandbox | `https://api.test.hotelbeds.com` |
| Production | `https://api.hotelbeds.com` |
| Booking model | Real server-to-server API |
| Cancellation model | Real API cancel (returns penalty info) |

### Credentials
Required fields: `api_key`, `secret` (sometimes labelled `secret_key`).
Signature: `SHA256(api_key + secret + unix_timestamp)` in `X-Signature`
header. `Api-key` header also required. See `src/suppliers/hotelbeds/auth.js`.

### Catalog sync
Endpoint: `GET /hotel-content-api/1.0/hotels` with
`{ fields, language, from, to, useSecondaryLanguage }`.
Pagination is `from`/`to` inclusive, **1-indexed**.
Envelope: `{ from, to, total, auditData, hotels: [ … ] }`.
`supplier_raw_ref = code` (string from hotel.code).

### Lifecycle handler: `src/lifecycle/handlers/hotelbeds-hotels.js`
- **detail** → `GET /hotel-content-api/1.0/hotels/{code}` — cached 24h in `hotel_content` table.
  Uses `raw_content.code || supplier_raw_ref` as hotel code.
  `next_payload_hint`: `{ stay, occupancies }`.
- **availability** → `POST /hotel-api/1.2/hotels` with `{ stay, occupancies, hotels: { hotel: [code] } }`.
  Filters to this specific hotel. Returns rooms + rate keys.
  `next_payload_hint`: `{ rateKey, holder, rooms }`.
- **book** → `POST /hotel-api/1.2/checkrates` first, then `POST /hotel-api/1.2/bookings`.
  ⚠ **Creates a real booking** in HotelBeds sandbox.
  `clientReference` is mandatory (auto-generated as `TOS-{timestamp}`).
  `rooms[].paxes` array required — each pax needs `roomId`, `type` (AD/CH),
  `name`, `surname`. Handler auto-fills from holder if not provided.
  `next_payload_hint`: `{ booking_reference }`.
- **cancel** → `DELETE /hotel-api/1.2/bookings/{ref}` — returns penalty schedule.

### ⚠ Sandbox side-effects
Sandbox bookings **do** appear in the partner's HotelBeds portal. The
lifecycle drawer shows a warning banner when `slug.startsWith('hotelbeds')`.
Always cancel via the drawer before closing.

### Known failure modes
- `pickArray returned 0` with 200 OK → `hotels` wasn't in the fallback
  list in the validator. Fixed; leave the `hotels` / `hotels.hotels`
  fallback in place.
- Trailing space in base URL → 404 with `%20` in URL. All URL inputs
  are `.trim()`-ed in the onboarding wizard.
- **Sandbox availability returns 0 results for most hotels** — the content
  catalog has ~47k hotels but sandbox rates exist for a small subset. Hotels
  in Mallorca (PMI), Tenerife, Barcelona, London, New York tend to work.
  This is a HotelBeds sandbox limitation, not a bug.
- Default 8s timeout is too short for availability searches — lifecycle
  handler overrides to 30s.
- Booking without `clientReference` → 400 `"Attribute is mandatory"`.
- Booking without `rooms[].paxes` → 400 validation error.
- Confirmed working hotel codes in sandbox: 13959 (Maristel Hotel & Spa,
  Mallorca), 93188, 1069, 122495, 118863 (all PMI destination).

### Rate limits
50,000 calls/day, 500 rpm (confirmed via `x-ratelimit-limit` header).
Concurrency: 10.

---

## hotelbeds-activities — Activities / Experiences

### Quick reference
| Key | Value |
|---|---|
| Slug | `hotelbeds-activities` |
| CTS type | `EXPERIENCE` |
| Auth | HMAC_SHA256 (same as hotels) |
| Sandbox | `https://api.test.hotelbeds.com` |
| Production | `https://api.hotelbeds.com` |
| Booking model | Real API — 2-step for some activities |
| Cancellation model | Real API cancel |

### Lifecycle handler: `src/lifecycle/handlers/hotelbeds-activities.js`
- **detail** → `GET /activity-api/1.0/activities/{code}`.
  Uses `raw_content.code || supplier_raw_ref`.
  `next_payload_hint`: `{ code, dateFrom, dateTo }`.
- **availability** → `GET /activity-api/1.0/activities?code=&dateFrom=&dateTo=`.
  Returns modalities + rates.
  `next_payload_hint`: `{ activityCode, modalityCode, rateKey, paxes, holder }`.
- **book** → `POST /activity-api/1.0/bookings`.
  ⚠ **Creates a real booking** in HotelBeds sandbox.
  `next_payload_hint`: `{ booking_reference }`.
- **cancel** → `DELETE /activity-api/1.0/bookings/{ref}`.

### Catalog sync — quirks
Endpoint: `GET /activity-cache-api/1.0/portfolio` with
`{ destination, offset, limit }`.

**Catalog is NOT globally enumerable.** You must iterate per-destination
(we use ~24 curated destination codes: BCN, PMI, MAD, IBZ, …). Attempts
to paginate without `destination` return 204.

**Endpoint discovery gotcha log** (do not repeat these):
- `/activity-content-api/1.0/activities` → 404 (does not exist)
- `/activity-cache-api/1.0/portfolios` (plural) → 404
- `/activity-cache-api/1.0/portfolio` with hotels-style `from`/`to` → 204

### Rate limits
Shared with hotelbeds-hotels under the same api_key.

---

## hotelbeds-transfers — Transfers

### Quick reference
| Key | Value |
|---|---|
| Slug | `hotelbeds-transfers` |
| CTS type | `TRANSFER` |
| Auth | HMAC_SHA256 (same as hotels) |
| Sandbox | `https://api.test.hotelbeds.com` |
| Production | `https://api.hotelbeds.com` |

### Catalog sync — critical quirk
**HotelBeds transfers has no catalog of routes.** Routes + pricing are
search-time only and not cacheable (per HotelBeds docs). We sync the
**destinations list** (pickup/dropoff points) instead so downstream
components know which locations are supported.

- `GET /transfer-cache-api/1.0/locations/destinations` with
  `{ fields: "ALL", language: "ENG" }`
- Envelope: flat array of `{ code, name, countryCode, language }`
- `supplier_raw_ref = code`
- `type = TRANSFER` with `route_origin = code`, `route_destination = null`

### ID mapping — CRITICAL
The **destination codes** from the cache API (DMP, YNU, PMI…) are **NOT**
ATLAS codes. They are geographic grouping codes only used within the cache
API. The availability endpoint accepts:
- `IATA` → airport codes (e.g. PMI, LHR, JFK)
- `ATLAS` → hotel codes from `hotelbeds-hotels` inventory (numeric)
- `GPS` → lat,lng with 3+ decimal places
- `PORT`, `STATION` → port/train station codes

Typical search: `from/IATA/PMI/to/ATLAS/<hotel_code>`. Never use a
destination code as an ATLAS code — it will return 400.

### Endpoint discovery gotcha log
- `/transfer-cache-api/1.0/portfolio` → 404 (does not exist, unlike activities)
- `/transfer-api/1.0/transfers/availability` with query params → 404
  (correct path is `/availability/{lang}/from/...` with all params in the URL path)
- Destination code as ATLAS toCode → 400 `"code 'DMP' is not of type ATLAS"`

### Lifecycle handler: `src/lifecycle/handlers/hotelbeds-transfers.js`
Transfers are different from hotels/activities — inventory stores
**destinations**, not routes. The lifecycle tester adapts:
- **detail** → No live API call. Returns cached `raw_content` for the
  destination code. `next_payload_hint`: pre-fills a sample search with
  `fromCode: "PMI"` (airport) → `toCode: <this destination>`.
- **availability** → `GET /transfer-api/1.0/availability/{lang}/from/{fromType}/{fromCode}/to/{toType}/{toCode}/{outbound}/{adults}/{children}/{infants}`.
  **All params are PATH segments, not query params** (404 if sent as query).
  For round-trip, add `/{inbound}` before `/{adults}`.
  Valid types: IATA, ATLAS, GPS, PORT, STATION.
  User must provide origin + destination in payload.
  `next_payload_hint`: `{ transfers: [{ rateKey, transferDetails }], holder }`.
- **book** → `POST /transfer-api/1.0/bookings`.
  ⚠ **Creates a real booking** in HotelBeds sandbox.
  `clientReference` is mandatory (auto-generated if not provided).
  **Booking payload structure:**
  ```json
  {
    "language": "en",
    "holder": { "name": "...", "surname": "...", "email": "...", "phone": "..." },
    "clientReference": "TOS-T-...",
    "transfers": [{
      "rateKey": "<full rateKey from availability>",
      "transferDetails": [{
        "direction": "ARRIVAL",
        "type": "FLIGHT",
        "code": "IB3915"
      }]
    }]
  }
  ```
  `transferDetails` = transport info (flight/cruise/train), NOT passenger info.
  `type` must be `FLIGHT`, `CRUISE`, or `TRAIN`.
  Response has `bookings[0].reference` (array), not `booking.reference`.
  `next_payload_hint`: `{ booking_reference }`.
- **cancel** → `DELETE /transfer-api/1.0/bookings/{lang}/reference/{ref}`.
  Note the URL pattern: `/bookings/en/reference/{ref}`, NOT `/bookings/{ref}`.
  Using the short URL returns 500.

---

## Template for new suppliers

Copy this block when onboarding a new supplier. Fill it in BEFORE
writing the handler.

```markdown
## <slug> — <category>

### Quick reference
| Key | Value |
|---|---|
| Slug | `<slug>` |
| CTS type | `<HOTEL | EXPERIENCE | TRANSFER | FLIGHT | RAIL | PACKAGE>` |
| Auth | `<API_KEY | HMAC_SHA256 | OAUTH2_CLIENT_CREDENTIALS | BEARER | BASIC>` |
| Base URL | `<https://…>` |
| Booking model | `<Real API | Redirect | Mock-only>` |
| Cancellation model | `<Real API | Manual | Not supported>` |

### Credentials
Fields: `…`. Where stored / how refreshed.

### Catalog sync
Endpoint, params, pagination style, envelope shape, `supplier_raw_ref` rule.

### Detail / availability / book / cancel
One line per endpoint with method, path, and quirks.

### ID rules
**Which field is the canonical id** for each endpoint. If endpoints
disagree (e.g. catalog gives external_id, detail wants uuid), write
it down explicitly.

### Response envelopes
Actual JSON shape for each endpoint — paste a redacted sample.

### Known failure modes
One bullet per painful thing you learned. Include the HTTP code and
the fix.

### Rate limits
Per-day / per-minute / concurrency.
```
