# tiqets — Integration Notes
category: EXPERIENCE · auth: BEARER · first_onboarded: 2026-05-13

## Auth quirks
- Token-based: `Authorization: Token [api-key]`
- Requires `User-Agent` header with company/brand name
- API keys managed via partner portal at tiqets.com/affiliate/ under Tools > API tokens
- Initial keys grant catalog + availability only; Booking API requires separate approval after recorded demo
- Contact: distributorapi@tiqets.com

## Base URLs
- Production: `https://api.tiqets.com/v2`
- Test/Sandbox: `https://api.api-tiqt-test.steq.it/v2`

## Response shape
- Product search: paginated via `page` + `page_size` params
- Product identifier: `id` field (integer, convert to string for CTS)
- Pricing: `price` (decimal) + `currency` (ISO 4217) at product level; also `price_in_supplier_currency` + `supplier_currency`
- Geolocation: `geolocation.lat` / `geolocation.lng` (also `starting_point.lat`/`starting_point.lng`)
- Location: `city_name`, `city_id`, `country_name`, `country_id`, `timezone` (IANA)
- Duration: `duration` field in HH:MM:SS format — must convert to minutes for CTS
- Images: array of objects with `small`, `medium`, `large`, `extra_large` URL variants + `alt_text`, `credit`
- Ratings: `ratings.average` (1-5) and `ratings.total` (count)
- Categories: `tag_ids` array — need tag lookup via `GET /tags` endpoint
- Cancellation: per-variant `cancellation.policy` ("before_date"|"before_timeslot"|"never") + `cancellation.window` (hours)

## Availability structure
- Endpoint: `GET /products/{id}/availability?date_from=&date_to=&currency=`
- Returns dates with optional timeslots (HH:MM format) and per-variant pricing
- Key flags: `has_timeslots`, `has_dynamic_pricing`, `sales_enabled`
- All times in product's local timezone, NOT UTC
- Variants = ticket types (adult, child, senior, etc.) — each has `variant_id`, `available`, `price`

## Booking flow
- TWO-STEP: reserve then confirm (like HotelBeds Activities)
- Step 1: `POST /orders` — creates reservation, returns `order_id` + `expires_at`
- Step 2: `POST /orders/{id}/confirm` — finalizes booking
- Step 3: `GET /orders/{id}/tickets` — retrieve vouchers/barcodes (may have delivery delay)
- Order statuses: `pending` > `confirmed` | `failed` | `cancelled`
- Cancel: `POST /orders/{id}/cancel` — check `cancellation_deadline` on order first

## Gotchas
- Rate limit: 15 requests/second (HTTP 429 with `rate_limit_exceeded`)
- Order creation limit: 25 orders/hour (HTTP 429 with `order_limit_exceeded`)
- Products may require additional checkout fields (full_name, date_of_birth, passport_id, nationality, pickup_location, flight_number) — query `GET /products/{id}/checkout_information` to discover these BEFORE booking
- `sale_status` can be "available" or "unavailable" — check `sale_status_reason` and `sale_status_expected_reopen`
- Some products are packages (`is_package: true`) containing multiple sub-products
- Duration format HH:MM:SS differs from CTS duration_minutes — parse and convert
- Default currency is EUR; must pass `?currency=USD` for USD prices
- Product change notifications come via webhooks — need partner-provided endpoint
- Timeslot products fail booking without timeslot param (`timeslot_missing` error)
- Availability race conditions return `no_availability` error — must refresh and retry
- `resource_gone` (410) means product permanently unpublished — must de-list from inventory
- Images should be re-cached minimum every 14 days (credits/availability change)
- Caching recommendation: product metadata weekly, availability (14 days) multiple times daily, availability (30+ days) once daily

## Test products (sandbox)
- 1006356: Museum of Cognitive Dissonance — variants, add-ons, delivery delays
- 1006518: Office vs. Officer — timeslots
- 1010393: weekday/weekend variant differentiation
- 1006521: Planet Earth — full_name, variant constraints, seasonal pricing
- 1006523: Institute of Dynamic Happiness — dynamic pricing, languages
- 1006524: Dream Simulator — dynamic pricing + timeslots
- 1006522: Amsterdam's Mountain Phew — out-of-season simulation
- 1006525: Half-Day Boat Tour — failing fulfillment (pending > failed transitions)

## CTS mapping notes
- `duration` HH:MM:SS > parse to minutes (e.g., "02:30:00" > 150)
- Each variant within a product could map to separate CTSTravelOptions (similar to HotelBeds modalities)
- Status mapping: `sale_status:"available"` > CONFIRMED, `"unavailable"` > SOLD_OUT
- Cancellation: `before_date` with window > compute `free_until` as visit_date minus window hours; `never` > NON_REFUNDABLE
- B2B pricing — `price` is net to partner; commission margin is per agreement
