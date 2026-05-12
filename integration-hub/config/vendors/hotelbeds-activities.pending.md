# hotelbeds-activities — Integration Notes
category: EXPERIENCE · auth: HMAC_SHA256 · first_onboarded: 2024-12-19

## Auth quirks
- Uses HotelBeds standard HMAC_SHA256 signature with api_key, secret_key, and timestamp
- Signature inputs: api_key + secret_key + timestamp, hashed with SHA256
- 500 RPM rate limit

## Response shape
- Search endpoint: `/portfolio` 
- Response format unknown (no sample data captured)
- Expected to follow HotelBeds patterns based on supplier family

## Gotchas
- Search requires `destination` parameter (tested with "BCN")
- Uses limit/offset pagination (sandbox tested with limit=20, offset=0)
- 800ms average response time
- No webhook support
- Book/cancel endpoints defined but not yet implemented ("")