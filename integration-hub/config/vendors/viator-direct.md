# viator-direct — Integration Notes
category: EXPERIENCE · auth: API_KEY · first_onboarded: 2024-12-28

## Auth quirks
- API key in header as `exp-api-key`
- Requires versioned Accept header: `application/json;version=2.0`
- Accept-Language header required for localization

## Response shape
- Search returns `products[]` array envelope
- Product identifier is `productCode` field
- Pricing structure: `pricing.summary.fromPrice` with separate `pricing.currency`
- Duration in `duration.fixedDurationInMinutes`
- Reviews nested as `reviews.sources[].averageRating`

## Gotchas
- POST-based search endpoint (not GET like many APIs)
- Pagination uses `count`/`start` instead of limit/offset
- Destination filtering requires nested structure: `filtering.destination`
- Images accessible via `images[].caption` field
- Currency specified at product level, not global