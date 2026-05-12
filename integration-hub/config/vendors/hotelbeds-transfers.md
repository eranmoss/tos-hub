# hotelbeds-transfers — Integration Notes
category: TRANSFER · auth: HMAC_SHA256 · first_onboarded: 2024-12-19

## Auth quirks
- Uses HotelBeds standard HMAC_SHA256 with api_key + secret_key + timestamp
- Same auth pattern as HotelBeds Hotels product line

## Response shape  
- Search endpoint `/locations/destinations` - likely returns destination metadata
- No sample response data available from probe
- Expected to follow HotelBeds envelope conventions based on category baseline

## Gotchas
- Only destinations/locations endpoint configured, not actual transfer search
- Requires `fields=ALL` and `language=ENG` parameters for search
- 500 RPM rate limit - relatively generous for HotelBeds
- 800ms average response time
- Book/cancel endpoints defined but empty - integration incomplete