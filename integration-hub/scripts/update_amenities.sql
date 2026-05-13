-- Translates raw HotelBeds facility codes in hub_static_inventory.amenities
-- into human-readable labels using hub_vendor_codes lookup.
-- Run AFTER 016_vendor_codes.sql and seed_vendor_codes.sql.

UPDATE hub_static_inventory si
SET amenities = translated.labels
FROM (
  SELECT
    si2.id,
    ARRAY(
      SELECT DISTINCT vc.label
      FROM jsonb_array_elements(si2.raw_content->'facilities') AS f
      JOIN hub_vendor_codes vc
        ON vc.supplier_slug = 'hotelbeds-hotels'
       AND vc.code_type     = 'facility'
       AND vc.code          = (f->>'facilityCode')
       AND vc.group_code    = (f->>'facilityGroupCode')
      WHERE (f->>'indLogic')::boolean IS DISTINCT FROM false
        AND (f->>'indYesOrNo')::boolean IS DISTINCT FROM false
      ORDER BY vc.label
    ) AS labels
  FROM hub_static_inventory si2
  WHERE si2.supplier_slug = 'hotelbeds-hotels'
    AND si2.raw_content->'facilities' IS NOT NULL
) translated
WHERE si.id = translated.id
  AND translated.labels != '{}';
