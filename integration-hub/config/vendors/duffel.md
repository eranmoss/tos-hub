# duffel — Integration Notes
category: FLIGHT · auth: BEARER · first_onboarded: 2024-05-12

## Auth quirks
- Uses Bearer token with custom `Duffel-Version: v2` header required
- Same base URL for sandbox and production (https://api.duffel.com)
- Test token format: `duffel_test_*` prefix

## Response shape
- Search returns offer_request objects with `id`, `slices[]`, `passengers[]`
- Rich location data: airports include nested city objects with IATA codes
- Location objects have both `iata_code` and `iata_city_code` fields
- Timestamps in ISO format with microsecond precision
- Includes `live_mode` boolean flag

## Gotchas
- Detail endpoint `/air/orders/{id}` returns 404 for offer_request IDs (marked optional)
- Search uses `/air/offer_requests` not typical `/search` pattern
- Booking uses `/air/orders` (different endpoint from search)
- Client key returned in responses appears to be JWT token
- Passengers can have null names in offer requests (populated during booking)