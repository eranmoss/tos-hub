# hotelbeds-hotels — Integration Notes
category: HOTEL · auth: HMAC_SHA256 · first_onboarded: 2024-12-19

## Auth quirks
- Headers: `Api-key` and `X-Signature` (SHA256 of api_key+secret_key+timestamp)
- Separate sandbox URL: `api.test.hotelbeds.com` vs `api.hotelbeds.com`
- Time skew sensitive - use epoch seconds timestamp

## Response shape
- Double-nested: `{ hotels: { hotels: [...] } }`
- Hotel identifier: `code` field (string)
- Coordinates in `coordinates.latitude/longitude`
- Images array: `images[].path`
- Facilities as `facilities[].code`

## Gotchas
- Offset pagination with `from`/`to` params (not limit/offset)
- `fields=all` required for complete data
- `language=ENG` mandatory parameter
- Star rating in `categoryCode` (extract digits)
- Default currency EUR, no currency field in response
- Sandbox has limited destination coverage
- Net pricing model - markup applied client-side