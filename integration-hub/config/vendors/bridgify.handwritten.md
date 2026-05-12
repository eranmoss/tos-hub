# Bridgify — Integration Notes

category: EXPERIENCE · auth: OAUTH2_CLIENT_CREDENTIALS · first_onboarded: 2026-04-15

## Auth quirks
- **OAuth 2.0 client credentials — not API key.** Reject any "X-Api-Key" pattern in docs.
- Token endpoint: `POST {base}/accounts/token/` (trailing slash matters).
- Form-encoded body, `grant_type=client_credentials`, `scope=read write`.
- Token TTL ~3600s; refresh ~60s before expiry. Cache per-instance.
- All subsequent calls: `Authorization: Bearer <token>`.

## Environments
- Sandbox: `https://api.dev.bridgify.io`
- Production: `https://api.bridgify.io`
- Path shapes are identical between envs — only host differs.

## Response shape
- Search envelope: `{ attractions: [...] }` (NOT `results` / `data`).
- ID field: `external_id` (NOT `id`).
- Detail endpoint: `/attractions/products/{external_id}/` — trailing slash required, 404 without it.
- Multi-supplier: Bridgify aggregates Viator, GetYourGuide, Tiqets, HotelBeds, etc. The `supplier` field on each result identifies the underlying supplier — **preserve it in `x-bridgify` extension on the CTS option** so we don't lose provenance.

## Booking flow — STATEFUL CART
This is the most surprising aspect of the API.

- 8–10 step ordered flow (required-fields → availability → pickup → customer-info → cart-add → confirm → pay → confirm-booking …).
- **Order matters.** Re-calling an earlier step resets later step state.
- **Always call `required-fields` first** to get the correct step sequence for the specific product. The sequence varies per product.
- Treat the cart as a session — store the cart token across steps. Don't parallelise step calls.

## Availability — four models
Bridgify normalises four underlying availability shapes; each must be mapped differently to canonical `CTSAvailability`.

| Code | Meaning              | Date needed | Time needed | Mapping notes |
|------|----------------------|-------------|-------------|---------------|
| BSN  | Open-dated voucher   | No          | No          | `CTSAvailability.status = AVAILABLE`, no date constraints |
| CLD  | Calendar date only   | Yes         | No          | Date-only availability; bookable for selected day |
| TSL  | Time slot            | Yes         | Yes         | Map `start_times[]` from slots |
| EVT  | One-time event       | Fixed date  | Fixed time  | Single fixed datetime; cannot reschedule |

Default to `UNKNOWN` if the type cannot be determined — never silently coerce.

## Pricing
- **Always USD.** No currency conversion required.
- `merchant_price` = net price (what TOS pays Bridgify). Use this for margin calculation.
- `retail_price` = what the end user is shown / pays. Use this for `price.amount`.
- Currency field exists but is always `"USD"` — keep the mapping for safety.

## Pickup points
Three pickup-point response shapes:
- **list** — discrete locations, user picks one.
- **rect** — single rectangular bounding box (any address inside is valid).
- **multirect** — multiple bounding boxes.

**GetYourGuide products** (when surfaced via Bridgify) handle pickup through the **customer-info** step instead of the pickups endpoint — special-case by `supplier === "getyourguide"`.

## Common gotchas
- 200 with `{ attractions: [] }` if `text_search` or `city_name` missing — the search params are not technically required but return empty without them.
- Token endpoint missing trailing slash → 404. Detail endpoint missing trailing slash → 404. **Always preserve trailing slashes for Bridgify URLs.**
- `start_times` may be ISO time strings without dates — combine with selected date client-side.
- Cancellation policy is free-text — extract into structured `policies.cancellation.refundable`.
- Quote / hold tokens are short-lived; do not assume cart state survives long idle periods.
