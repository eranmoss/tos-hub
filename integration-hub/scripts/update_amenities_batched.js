import 'dotenv/config';
import { query, closePool } from '../src/db/client.js';

const BATCH = 500;

const countRes = await query(
  `SELECT COUNT(*)::int AS total FROM hub_static_inventory
   WHERE supplier_slug = 'hotelbeds-hotels' AND raw_content->'facilities' IS NOT NULL`
);
const total = countRes.rows[0].total;
console.log(`Hotels with facilities: ${total}`);

let updated = 0;
let offset = 0;

while (offset < total) {
  const res = await query(`
    UPDATE hub_static_inventory si
    SET amenities = sub.labels, updated_at = now()
    FROM (
      SELECT si2.id,
        ARRAY(
          SELECT DISTINCT vc.label
          FROM jsonb_array_elements(si2.raw_content->'facilities') AS f
          JOIN hub_vendor_codes vc
            ON vc.supplier_slug = 'hotelbeds-hotels'
           AND vc.code_type = 'facility'
           AND vc.code = (f->>'facilityCode')
           AND vc.group_code = (f->>'facilityGroupCode')
          WHERE (f->>'indLogic')::boolean IS DISTINCT FROM false
            AND (f->>'indYesOrNo')::boolean IS DISTINCT FROM false
          ORDER BY vc.label
        ) AS labels
      FROM hub_static_inventory si2
      WHERE si2.supplier_slug = 'hotelbeds-hotels'
        AND si2.raw_content->'facilities' IS NOT NULL
      ORDER BY si2.id
      LIMIT $1 OFFSET $2
    ) sub
    WHERE si.id = sub.id AND sub.labels != '{}'
  `, [BATCH, offset]);

  updated += res.rowCount;
  offset += BATCH;
  console.log(`  ${offset}/${total} processed, ${updated} updated`);
}

console.log(`Done. ${updated} hotels updated with translated amenities.`);
await closePool();
