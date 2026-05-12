import Fuse from 'fuse.js';
import { getDistance } from 'geolib';
import { query } from '../db/client.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const GEO_RADIUS_M = 300;
const NAME_THRESHOLD = 0.70;
const CITY_NAME_THRESHOLD = 0.90;

const normalize = (name) =>
  (name || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const fuzzyMatch = (a, b) => {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  const fuse = new Fuse([{ n: nb }], { keys: ['n'], includeScore: true, threshold: 1.0 });
  const result = fuse.search(na);
  return result[0] ? 1 - result[0].score : 0;
};

// Match existing hub_attractions (from clustering) to hub_global_pois
export const migrateAttractionsToGlobalPois = async ({ onProgress } = {}) => {
  const { rows: attractions } = await query(`
    SELECT id, name, display_name, city, country, latitude, longitude, category,
           experience_count, image_url
    FROM hub_attractions
    ORDER BY experience_count DESC
  `);

  log('info', 'poi_migrate_start', { attraction_count: attractions.length });

  let matched = 0;
  let created = 0;

  for (let i = 0; i < attractions.length; i++) {
    const attr = attractions[i];
    if (!attr.latitude || !attr.longitude) continue;

    // Find candidates in hub_global_pois within GEO_RADIUS_M
    const { rows: candidates } = await query(`
      SELECT id, name, display_name, city, latitude, longitude
      FROM hub_global_pois
      WHERE city = $1
    `, [attr.city]);

    let bestMatch = null;
    let bestSim = 0;

    for (const cand of candidates) {
      if (!cand.latitude || !cand.longitude) continue;
      const dist = getDistance(
        { lat: attr.latitude, lon: attr.longitude },
        { lat: cand.latitude, lon: cand.longitude }
      );
      if (dist > GEO_RADIUS_M) continue;

      const sim = fuzzyMatch(attr.display_name || attr.name, cand.display_name || cand.name);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = cand;
      }
    }

    let globalPoiId;

    if (bestMatch && bestSim >= NAME_THRESHOLD) {
      // Match found — link to existing global POI
      globalPoiId = bestMatch.id;
      matched++;
    } else {
      // No match — create new global POI from attraction data
      const { rows } = await query(
        `INSERT INTO hub_global_pois (name, display_name, city, country, latitude, longitude,
           category_id, image_url, experience_count, source, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'cluster_migrate', 0.80)
         ON CONFLICT (name, city) DO UPDATE SET
           experience_count = GREATEST(hub_global_pois.experience_count, EXCLUDED.experience_count),
           updated_at = now()
         RETURNING id`,
        [
          attr.name, attr.display_name || attr.name, attr.city, attr.country,
          attr.latitude, attr.longitude, attr.category, attr.image_url,
          attr.experience_count || 0,
        ]
      );
      globalPoiId = rows[0]?.id;
      created++;
    }

    // Create supplier POI mapping (bridgify cluster → global POI)
    if (globalPoiId) {
      await query(
        `INSERT INTO hub_supplier_pois (supplier_slug, supplier_poi_ref, supplier_poi_name,
           global_poi_id, match_confidence, match_method)
         VALUES ('bridgify', $1, $2, $3, $4, $5)
         ON CONFLICT (supplier_slug, supplier_poi_ref) DO UPDATE SET
           global_poi_id = EXCLUDED.global_poi_id`,
        [
          attr.id, attr.display_name || attr.name, globalPoiId,
          bestMatch ? bestSim : 0.80,
          bestMatch ? 'geo+name' : 'cluster_migrate',
        ]
      );

      // Link all inventory records with this attraction_id to global_poi_id
      await query(
        `UPDATE hub_static_inventory SET global_poi_id = $1
         WHERE attraction_id = $2 AND (global_poi_id IS NULL OR global_poi_id != $1)`,
        [globalPoiId, attr.id]
      );
    }

    if (i % 100 === 0 && onProgress) {
      onProgress(Math.round((i / attractions.length) * 100), {
        processed: i, matched, created,
      });
    }
  }

  log('info', 'poi_migrate_complete', { total: attractions.length, matched, created });
  return { total: attractions.length, matched, created };
};

// Match any unlinked inventory records to global POIs by geo + title similarity
export const matchInventoryToPois = async ({ supplierSlug, onProgress } = {}) => {
  const whereSupplier = supplierSlug ? `AND si.supplier_slug = '${supplierSlug}'` : '';
  const { rows: unlinked } = await query(`
    SELECT si.id, si.title, si.city, si.latitude, si.longitude, si.supplier_slug
    FROM hub_static_inventory si
    WHERE si.is_active = true AND si.global_poi_id IS NULL
      AND si.latitude IS NOT NULL AND si.longitude IS NOT NULL
      AND si.type = 'EXPERIENCE'
      ${whereSupplier}
    LIMIT 20000
  `);

  log('info', 'poi_match_inventory_start', { unlinked_count: unlinked.length, supplier: supplierSlug || 'all' });

  let linked = 0;
  const cityCaches = new Map();

  for (let i = 0; i < unlinked.length; i++) {
    const item = unlinked[i];
    if (!item.city) continue;

    // Cache global POIs per city
    if (!cityCaches.has(item.city)) {
      const { rows } = await query(
        `SELECT id, name, display_name, latitude, longitude FROM hub_global_pois WHERE city = $1`,
        [item.city]
      );
      cityCaches.set(item.city, rows);
    }

    const pois = cityCaches.get(item.city);
    let bestMatch = null;
    let bestScore = 0;

    for (const poi of pois) {
      if (!poi.latitude || !poi.longitude) continue;
      const dist = getDistance(
        { lat: item.latitude, lon: item.longitude },
        { lat: poi.latitude, lon: poi.longitude }
      );
      if (dist > GEO_RADIUS_M) continue;

      const nameSim = fuzzyMatch(item.title, poi.display_name || poi.name);
      if (nameSim >= NAME_THRESHOLD && nameSim > bestScore) {
        bestScore = nameSim;
        bestMatch = poi;
      }
    }

    if (bestMatch) {
      await query(
        `UPDATE hub_static_inventory SET global_poi_id = $1 WHERE id = $2`,
        [bestMatch.id, item.id]
      );
      linked++;
    }

    if (i % 500 === 0 && onProgress) {
      onProgress(Math.round((i / unlinked.length) * 100), { processed: i, linked });
    }
  }

  log('info', 'poi_match_inventory_complete', { total: unlinked.length, linked });
  return { total: unlinked.length, linked };
};

// Update experience_count on global POIs based on linked inventory
export const refreshPoiCounts = async () => {
  await query(`
    UPDATE hub_global_pois gp SET
      experience_count = sub.cnt,
      updated_at = now()
    FROM (
      SELECT global_poi_id, COUNT(*)::int AS cnt
      FROM hub_static_inventory
      WHERE global_poi_id IS NOT NULL AND is_active = true
      GROUP BY global_poi_id
    ) sub
    WHERE gp.id = sub.global_poi_id
  `);
  log('info', 'poi_counts_refreshed');
};
