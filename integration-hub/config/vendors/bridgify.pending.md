# bridgify — Integration Notes
category: EXPERIENCE · auth: OAUTH2_CLIENT_CREDENTIALS · first_onboarded: 2024-12-19

## Auth quirks
- Standard OAuth2 client credentials flow via `POST /accounts/token/`
- No scopes required in the flow
- Token refresh needed ~60s before expiry (typical 3600s TTL)

## Response shape
- Results wrapped in `attractions[]` array
- Rich nested structure with `additional_info.external_exclusive_fields` for categories
- Geolocation split into `geolocation.lat` and `geolocation.lng`
- Single image via `main_photo_url` (not array)
- Languages as `additional_info.supported_languages[]`

## Gotchas
- All endpoints require trailing slash (`/attractions/products/`, `/bookings/`)
- `destination` parameter required for search - empty results without it
- Price is "from" pricing - may not reflect final cost
- Free cancellation boolean at `free_cancellation` top-level
- Primary category duplicated to both `category` and `experience_category` fields
- Meeting point in nested `additional_info.meeting_point`
- Start times in `time` field (not `start_times`)
- DELETE method for cancellation via `/bookings/{ref}/`