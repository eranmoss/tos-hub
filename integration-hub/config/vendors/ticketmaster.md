# ticketmaster — Integration Notes
category: EXPERIENCE · auth: API_KEY · first_onboarded: 2024-12-19

## Auth quirks
- API key passed as `apikey` query parameter
- Detail endpoint returns 401 even with valid search credentials (marked optional)

## Response shape
- Search/detail returns direct event objects (not wrapped in envelope)
- Rich embedded data via `_embedded.venues[]` and `_embedded.attractions[]`
- HATEOAS-style navigation via `_links` object with relative hrefs
- Multiple image formats available with ratio/dimension metadata

## Gotchas
- Uses Discovery v2 API (`/discovery/v2/events`) for search/detail
- Booking uses different Partners API (`/partners/v1/events/{id}/cart`)
- Event dates include both UTC (`dateTime`) and local (`localDate`, `localTime`) formats
- Timezone provided separately in `dates.timezone` field
- Sales windows include public sales and multiple presale periods
- Static seatmap URLs available via `seatmap.staticUrl`
- Booking endpoint requires separate permissions from search/detail