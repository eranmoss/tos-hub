# EXPERIENCE — Category Integration Patterns

Source vendors: Bridgify (OAUTH2_CLIENT_CREDENTIALS), HotelBeds Activities (HMAC_SHA256), Viator Direct (API_KEY), Ticketmaster (API_KEY).

## Common auth patterns
- **API_KEY**: Header-based authentication (most common)
- **OAUTH2_CLIENT_CREDENTIALS**: Form-encoded `POST /accounts/token/` → `{ access_token, expires_in }`. Token TTL ~3600s; refresh ~60s before expiry.
- **HMAC_SHA256**: HotelBeds-style with timestamp signatures.

## Response envelope conventions
- Common patterns: `{ activities: [...] }`, `{ products: [...] }`, `{ attractions: [...] }`, `{ events: [...] }`
- Generic alternatives: `{ experiences: [...] }`, `{ tours: [...] }`

## Identifier fields
- `id`, `activity_code`, `external_id`, `productCode`
- The id used in detail/availability calls usually matches search-result id (unlike hotels).

## Pricing quirks
- "From" prices are common — `price` may be the cheapest rate, not what the user actually pays.
- Per-person vs per-group; check for `pricing_type` or `participant_type`.
- Currency is usually a sibling field, not nested.

## Required search params (typical minimums)
- **destination** text or city name (required by majority of vendors)
- Date range (`from_date`, `to_date`) or single date (vendor-specific)
- Some APIs may require additional free-text query parameters

## Pagination
- **limit_offset** style appears in some vendors (default limit ~20 when specified)
- **count_start** style also present
- Implementation varies significantly by vendor

## Common gotchas
- Empty results without destination parameter specified (confirmed across multiple vendors).
- Availability is typically a *separate* endpoint from search/detail — must be called per-product per-date.
- `start_times` may be ISO time strings without dates; combine with selected date client-side.
- Cancellation policies may be free-text — extract into structured `policies.cancellation.refundable`.
- Trailing slash requirements vary by vendor (not consistent).