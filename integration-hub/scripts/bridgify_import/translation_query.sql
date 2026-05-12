-- Bridgify → integration_hub translation
--
-- Run this in DBeaver against Bridgify's Postgres. Export the result grid
-- as CSV (right-click result → Export Data → CSV).
--
-- This SELECT translates the active Bridgify Attraction rows into a shape
-- ready to upsert into hub_static_inventory.
--
-- Filters applied:
--   - is_active = true                      (currently in supplier feeds)
--   - last_updated > now() - 90 days         (catches stale-but-active rows like Manawa)
--   - title and geolocation populated        (translation requires both)
--   - inventory_supplier in experience set   (excludes event suppliers; see notes)
--   - is_test_attraction not true
--
-- Excluded suppliers and reasons:
--   - StubHub, SportsEvents365, Ticketero, LiveTickets — event-style products;
--     their identity is date+venue+teams, not text similarity. Current dedup
--     differentiator vocabulary isn't tuned for events. Run a separate event
--     dedup later with a different algorithm.
--   - Manawa, Eventim, Dguide, Tickitto, Toristy, GoogleMaps, Bajabikes,
--     GoCity, Klook, Musement — stale (>90 days lag) or 0 active records.
--   - Ticketmaster — 0 active records (51 days lag, possibly stalled pipeline).
--   - TEST_SUPPLIER, NULL supplier — non-production data.
--
-- Estimated result: ~555K rows from 7 suppliers
-- (Viator + GetYourGuide + Tiqets + HotelBeds + AttractionWorld + BookitFun + Tillo)

SELECT
  -- Identity
  LOWER(inventory_supplier)            AS supplier_slug,
  external_id                          AS supplier_raw_ref,
  'EXPERIENCE'                         AS type,

  -- Core text fields (used for embedding input)
  title,
  description,

  -- Geolocation (PostGIS POINT → flat lat/lng)
  ST_Y(geolocation::geometry)          AS latitude,
  ST_X(geolocation::geometry)          AS longitude,

  -- Location strings
  external_city_name                   AS city,
  external_country_name                AS country,
  NULL::varchar                        AS timezone,

  -- Category (first from denormalized array)
  CASE
    WHEN categories_list IS NOT NULL AND array_length(categories_list, 1) > 0
      THEN categories_list[1]
    ELSE NULL
  END                                  AS category,

  -- Duration: interval → minutes
  CASE
    WHEN duration IS NOT NULL
      THEN (EXTRACT(EPOCH FROM duration) / 60)::integer
    ELSE NULL
  END                                  AS duration_minutes,

  -- Image URLs as array (single photo wrapped)
  CASE
    WHEN main_photo_url IS NOT NULL AND main_photo_url <> ''
      THEN ARRAY[main_photo_url]
    ELSE NULL
  END                                  AS image_urls,

  -- Raw content for traceability (JSONB)
  jsonb_build_object(
    'bridgify_uuid',        uuid::text,
    'inventory_supplier',   inventory_supplier,
    'price',                price,
    'currency',             currency,
    'rating',               rating,
    'number_of_reviews',    number_of_reviews,
    'availability_type',    availability_type,
    'is_curated',           is_curated,
    'is_entry_ticket',      is_entry_ticket,
    'last_updated',         last_updated
  )                                    AS raw_content,

  is_active,
  NOW()                                AS last_synced_at

FROM "attractionsAPI_attraction"

WHERE is_active = true
  AND last_updated > NOW() - INTERVAL '90 days'
  AND title IS NOT NULL
  AND geolocation IS NOT NULL
  AND inventory_supplier IS NOT NULL
  AND (is_test_attraction IS NULL OR is_test_attraction = false)
  AND LOWER(inventory_supplier) IN (
    'viator',
    'getyourguide',
    'tiqets',
    'hotelbeds',
    'attractionworld',
    'bookitfun',
    'tillo'
  );

-- Smoke test: add `LIMIT 5` and confirm:
--   - latitude/longitude are real numbers
--   - category has a value
--   - duration_minutes is sensible (10s-100s range)
--   - raw_content is well-formed JSON
-- before exporting the full result.
