# HOTEL — Category Integration Patterns

Source vendors: HotelBeds (HMAC_SHA256), generic OTA APIs.

## Common auth patterns
- **HMAC_SHA256**: HotelBeds-style. Headers: `Api-key`, `X-Signature` (sha256 of `api_key+secret+epoch_seconds`). Sandbox URL is separate from production. Time skew matters — use server time.
- **API_KEY**: Header `X-Api-Key` or `apikey`. Sometimes also requires `X-Customer-Code`.
- **OAUTH2_CLIENT_CREDENTIALS**: Less common for hotels but appears in newer vendors.

## Response envelope conventions
- HotelBeds: `{ hotels: { hotels: [...] } }` — double-nested.
- Generic OTA: `{ results: [...] }` or `{ properties: [...] }` or `{ hotels: [...] }`.
- Pagination: `{ pagination: { from, to, total } }` is common; cursor-based less so.

## Identifier fields
- `code` (HotelBeds), `hotel_id`, `property_id`, `supplier_id`. The id used for re-price/book is rarely the same as the display id — look for `rate_key`, `bookable_token`, `offer_id`.

## Pricing quirks
- Often quoted per-night vs per-stay — check for `total` vs `nightly`.
- Currency may be at top level (`currency`) or per-rate.
- Net vs gross pricing: HotelBeds returns net; markup must be applied client-side.

## Required search params (typical minimums)
- check-in date, check-out date (`stay.checkIn`, `stay.checkOut` or similar)
- destination code or geo bounding box
- occupancy (adults / children / rooms)

## Common gotchas
- Empty results when destination code is unrecognised (sandbox often only knows specific test cities).
- Rate key TTL — booking must happen within X minutes of search.
- Cancellation policy structure varies wildly; default to `policy_source: 'DEFAULT_APPLIED'` if missing.
