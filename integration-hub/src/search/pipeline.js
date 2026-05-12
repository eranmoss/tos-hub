import { query } from '../db/client.js';
import { execSync } from '../executor/sync.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const groupBy = (rows, key) => rows.reduce((acc, r) => {
  (acc[r[key]] = acc[r[key]] || []).push(r);
  return acc;
}, {});

// Stage 1 — local filter against hub_static_inventory.
// Accepts: type, lat, lng, radius_m (optional), category (optional), limit (optional).
export const stage1LocalFilter = async ({ tenantId, type, lat, lng, radius_m = 50000, category, limit = 100 }) => {
  const hasGeo = typeof lat === 'number' && typeof lng === 'number';
  const params = [tenantId, type];
  let geoClause = '';
  if (hasGeo) {
    params.push(lat, lng, radius_m);
    geoClause = `
      AND si.latitude IS NOT NULL AND si.longitude IS NOT NULL
      AND (
        6371000 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians($3)) * cos(radians(si.latitude)) *
            cos(radians(si.longitude) - radians($4)) +
            sin(radians($3)) * sin(radians(si.latitude))
          ))
        )
      ) <= $5`;
  }
  let categoryClause = '';
  if (category) {
    params.push(category);
    categoryClause = ` AND si.category = $${params.length}`;
  }
  params.push(limit);
  const sql = `
    SELECT
      si.id, si.supplier_slug, si.supplier_raw_ref, si.type, si.title,
      si.description, si.latitude, si.longitude, si.city, si.country,
      si.timezone, si.category, si.duration_minutes, si.vehicle_class,
      si.star_rating, si.image_urls, si.amenities, si.meal_plans,
      si.route_origin, si.route_destination, si.raw_content,
      dp.composite_score AS dedup_score,
      dp.decision AS dedup_decision,
      dp.inventory_id_b AS dedup_pair_id
    FROM hub_static_inventory si
    LEFT JOIN hub_dedup_pairs dp
      ON dp.inventory_id_a = si.id AND dp.tenant_id = $1
    JOIN hub_tenant_suppliers ts
      ON ts.supplier_slug = si.supplier_slug
      AND ts.tenant_id = $1 AND ts.is_active = true
    WHERE si.type = $2 AND si.is_active = true AND si.canonical_id IS NULL
      ${geoClause}${categoryClause}
    LIMIT $${params.length}
  `;
  const res = await query(sql, params);
  return res.rows;
};

// Stage 2 — live reprice. Calls the supplier's search operation per slug,
// scoped to the set of supplier_raw_refs discovered in Stage 1.
const repriceFromSupplier = async (tenantId, slug, records, params) => {
  try {
    const args = {
      ...params,
      supplier_raw_refs: records.map(r => r.supplier_raw_ref),
    };
    const priced = await execSync({ tenantId, supplier: slug, operation: 'search', args });
    return { slug, priced: Array.isArray(priced) ? priced : [] };
  } catch (err) {
    log('warn', 'stage2_reprice_failed', { supplier: slug, error: err.message });
    return { slug, priced: [], error: err.message };
  }
};

// Merge Stage 1 static records with Stage 2 priced results.
// Match on supplier_slug + supplier_raw_ref. If no live price found,
// return the static record with live_price_available = false.
const mergeResults = (staticRows, liveBySupplier) => {
  const priceIndex = new Map();
  for (const { slug, priced } of liveBySupplier) {
    for (const p of priced) {
      const ref = p.supplier_raw_ref || p.id;
      if (ref) priceIndex.set(`${slug}::${ref}`, p);
    }
  }
  return staticRows.map(row => {
    const key = `${row.supplier_slug}::${row.supplier_raw_ref}`;
    const live = priceIndex.get(key);
    if (live) {
      return {
        ...live,
        static_id: row.id,
        dedup_score: row.dedup_score,
        dedup_decision: row.dedup_decision,
        dedup_pair_id: row.dedup_pair_id,
        live_price_available: true,
      };
    }
    return {
      id: row.supplier_raw_ref,
      supplier_slug: row.supplier_slug,
      supplier_raw_ref: row.supplier_raw_ref,
      type: row.type,
      title: row.title,
      description: row.description,
      location: {
        latitude: row.latitude, longitude: row.longitude,
        city: row.city, country: row.country, timezone: row.timezone,
      },
      category: row.category,
      duration_minutes: row.duration_minutes,
      images: row.image_urls,
      static_id: row.id,
      dedup_score: row.dedup_score,
      dedup_decision: row.dedup_decision,
      dedup_pair_id: row.dedup_pair_id,
      live_price_available: false,
    };
  });
};

export const search = async ({ tenantId, params }) => {
  if (!tenantId) throw new Error('tenant_id is required');
  if (!params?.type) throw new Error('params.type is required');

  const candidates = await stage1LocalFilter({ tenantId, ...params });
  log('info', 'stage1_complete', { tenant_id: tenantId, candidate_count: candidates.length });
  if (candidates.length === 0) return { results: [], stage1_count: 0, suppliers_repriced: [] };

  const bySupplier = groupBy(candidates, 'supplier_slug');
  const liveResults = await Promise.all(
    Object.entries(bySupplier).map(([slug, records]) =>
      repriceFromSupplier(tenantId, slug, records, params)
    )
  );

  const merged = mergeResults(candidates, liveResults);
  return {
    results: merged,
    stage1_count: candidates.length,
    suppliers_repriced: liveResults.map(r => ({ slug: r.slug, count: r.priced.length, error: r.error || null })),
  };
};
