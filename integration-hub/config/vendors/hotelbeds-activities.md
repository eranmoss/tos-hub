# hotelbeds-activities — Integration Notes
category: EXPERIENCE · auth: HMAC_SHA256 · first_onboarded: 2024-12-19

## Auth quirks
- Uses HMAC_SHA256 signature combining api_key, secret_key, and timestamp
- Signature must be recalculated for each request with current timestamp
- Both api_key and signature included in request headers

## Response shape
- Main envelope: `{ activities: [...] }`
- Activity identifier field likely `activity_code` (common HotelBeds pattern)
- Standard limit/offset pagination with 20 default page size

## Gotchas
- Destination parameter required for search (tested with "BCN")
- No sample response available to verify exact field structure
- Cache API suggests data may be pre-aggregated vs real-time
- Rate limit is generous at 500 RPM
- No webhook support - polling required for status updates