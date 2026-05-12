# bridgify — Integration Notes
category: EXPERIENCE · auth: OAUTH2_CLIENT_CREDENTIALS · first_onboarded: 2024-12-19

## Auth quirks
- Token endpoint: `POST /accounts/token/` with form-encoded client credentials
- Uses both `read` and `write` scopes during auth flow
- Standard OAuth2 client credentials flow

## Response shape
- Search results wrapped in `attractions[]` array
- Product identifier: `external_id` field
- Price structure: separate `price` and `currency` fields at attraction level
- Geolocation nested as `geolocation.lat` and `geolocation.lng`
- Categories in `additional_info.external_exclusive_fields.primary_category`
- Meeting point details in `additional_info.meeting_point`

## Gotchas
- Detail endpoint uses path parameter: `/attractions/products/{product_id}`
- Availability is separate endpoint per product: `/attractions/products/availability/{product_id}`
- Images provided as single `main_photo_url` field, mapped to array
- Time information in `time` field gets mapped to `start_times[]`
- Free cancellation boolean available as `free_cancellation` field
- Default currency assumed to be EUR when not specified