# hotelbeds-hotels — Integration Notes
category: HOTEL · auth: HMAC_SHA256 · first_onboarded: 2024-12-19

## Auth quirks
- HMAC signature uses `api_key + secret_key + timestamp` with SHA256
- Separate sandbox URL (`api.test.hotelbeds.com`) vs production (`api.hotelbeds.com`)
- Time skew sensitive - use server epoch seconds for timestamp

## Response shape
- Double-nested structure: `{ hotels: { hotels: [...] } }`
- Hotel identifier is `code` field (string)
- Rich facility data via `facilities[].code` array
- Images at `images[].path`
- Coordinates nested under `coordinates.latitude/longitude`

## Gotchas
- Search requires POST to `/hotel-api/1.0/hotels` (not GET)
- Destination codes are strict - sandbox limited to test cities like "BCN"
- Star rating extracted from `categoryCode` field using digit extraction
- Content fields nested under `.content` (e.g., `name.content`, `description.content`)
- High rate limit (500 RPM) but 800ms average response time
- Booking references use `:ref` path parameter for cancellations
- Status mappings: "OK" → CONFIRMED, "XX" → CANCELLED