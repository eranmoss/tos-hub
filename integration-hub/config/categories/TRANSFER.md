# TRANSFER — Category Integration Patterns

Source vendors: HotelBeds Transfers, generic point-to-point shuttle APIs.

## Common auth patterns
- **HMAC_SHA256**: HotelBeds Transfers shares auth pattern with HotelBeds Hotels.
- **API_KEY** with partner identifier.

## Response envelope conventions
- HotelBeds: `{ services: [...] }` per offer.
- Generic: `{ transfers: [...] }`, `{ quotes: [...] }`, `{ options: [...] }`.

## Identifier fields
- `rateKey`, `service_id`, `quote_id` — usually a re-priceable token rather than a stable product id.
- Vehicle and route metadata (`vehicle_class`, `pickup_type`) often live in `transfer_meta` style sub-objects.

## Required search params (typical minimums)
- pickup point (airport code, hotel id, or coords)
- dropoff point
- pickup datetime (ISO)
- passenger count, sometimes luggage count
- inbound flight number is often required for airport pickups

## Common gotchas
- Pickup type enum varies (AIRPORT / HOTEL / PORT / ADDRESS / STATION) — map to canonical values.
- Outbound + return often must be quoted as two separate searches, then bundled by `trip_id`.
- Vehicle class taxonomy is rarely standardised — keep raw label in extensions and map to canonical `SHARED / PRIVATE_STANDARD / PRIVATE_PREMIUM / LUXURY / VAN / COACH`.
- Quote TTL is short (often 5–15 minutes).
