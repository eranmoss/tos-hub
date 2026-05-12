import axios from 'axios';
import { query } from '../db/client.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const SANDBOX_URL = 'https://api.sandbox.viator.com/partner';
const PROD_URL = 'https://api.viator.com/partner';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const buildClient = (apiKey, env) => {
  const baseURL = env === 'production' ? PROD_URL : SANDBOX_URL;
  return axios.create({
    baseURL,
    headers: {
      'exp-api-key': apiKey,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en',
    },
    timeout: 30000,
  });
};

// ── Tag Taxonomy ──────────────────────────────────────────────
// Fetches Viator's full tag tree and seeds hub_canonical_categories + hub_category_mappings.

const TAG_TO_CANONICAL = {
  'sightseeing-tours': 'sightseeing',
  'walking-tours': 'walking-tours',
  'day-trips': 'day-trips',
  'food-wine-nightlife': 'food-and-drink',
  'food-tours': 'food-tours',
  'wine-tasting': 'wine-tasting',
  'cooking-classes': 'cooking-classes',
  'cultural-tours': 'culture',
  'historical-tours': 'historical',
  'museum-tickets-passes': 'museums',
  'art-tours': 'art',
  'outdoor-activities': 'outdoor',
  'hiking-camping': 'hiking',
  'water-sports': 'water-sports',
  'adventure-tours': 'adventure',
  'boat-tours-cruises': 'boat-cruises',
  'private-tours': 'private-tours',
  'luxury-tours': 'luxury',
  'transfers-ground-transport': 'transfers',
  'theme-parks': 'theme-parks',
  'shows-concerts': 'entertainment',
  'nightlife': 'nightlife',
  'shopping': 'shopping',
  'wellness-spa': 'wellness',
  'classes-workshops': 'workshops',
  'photography-tours': 'photography',
  'family-friendly': 'family',
  'romantic-tours': 'romantic',
  'hop-on-hop-off': 'hop-on-hop-off',
  'skip-the-line': 'skip-the-line',
  'multi-day-tours': 'multi-day',
  'aerial-tours': 'aerial',
  'bike-tours': 'cycling',
  'segway-tours': 'segway',
};

const slugify = (name) =>
  name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

export const syncViatorTags = async (client, { onProgress } = {}) => {
  log('info', 'viator_tags_fetch_start');
  const resp = await client.get('/products/tags');
  const tags = resp.data?.tags || resp.data || [];
  if (!Array.isArray(tags) || tags.length === 0) {
    log('warn', 'viator_tags_empty');
    return { tags_fetched: 0, categories_seeded: 0, mappings_created: 0 };
  }

  log('info', 'viator_tags_fetched', { count: tags.length });

  // Build parent→children map for hierarchy
  const byId = new Map();
  for (const t of tags) {
    byId.set(t.tagId, t);
  }

  // Determine root tags (no parent or parent not in set)
  const roots = tags.filter(t =>
    !t.parentTagIds || t.parentTagIds.length === 0 ||
    t.parentTagIds.every(pid => !byId.has(pid))
  );

  // Seed canonical categories — roots first, then children
  let categoriesSeeded = 0;
  let mappingsCreated = 0;

  // Ensure top-level canonical categories exist
  const ensureCanonical = async (id, display, parentId, level) => {
    await query(
      `INSERT INTO hub_canonical_categories (id, display, parent_id, level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET display = EXCLUDED.display, parent_id = EXCLUDED.parent_id`,
      [id, display, parentId, level]
    );
    categoriesSeeded++;
  };

  // Process roots as level-0 categories
  for (const root of roots) {
    const slug = slugify(root.allNamesByLocale?.en || root.tagName || `tag-${root.tagId}`);
    const display = root.allNamesByLocale?.en || root.tagName || slug;
    const canonicalId = TAG_TO_CANONICAL[slug] || slug;

    await ensureCanonical(canonicalId, display, null, 0);

    await query(
      `INSERT INTO hub_category_mappings (supplier_slug, supplier_cat_id, supplier_cat_name, canonical_cat_id)
       VALUES ('viator', $1, $2, $3)
       ON CONFLICT (supplier_slug, supplier_cat_id) DO UPDATE SET canonical_cat_id = EXCLUDED.canonical_cat_id`,
      [String(root.tagId), display, canonicalId]
    );
    mappingsCreated++;

    // Process direct children as level-1
    const children = tags.filter(t =>
      t.parentTagIds && t.parentTagIds.includes(root.tagId)
    );
    for (const child of children) {
      const childSlug = slugify(child.allNamesByLocale?.en || child.tagName || `tag-${child.tagId}`);
      const childDisplay = child.allNamesByLocale?.en || child.tagName || childSlug;
      const childCanonicalId = TAG_TO_CANONICAL[childSlug] || childSlug;

      await ensureCanonical(childCanonicalId, childDisplay, canonicalId, 1);

      await query(
        `INSERT INTO hub_category_mappings (supplier_slug, supplier_cat_id, supplier_cat_name, canonical_cat_id)
         VALUES ('viator', $1, $2, $3)
         ON CONFLICT (supplier_slug, supplier_cat_id) DO UPDATE SET canonical_cat_id = EXCLUDED.canonical_cat_id`,
        [String(child.tagId), childDisplay, childCanonicalId]
      );
      mappingsCreated++;
    }
  }

  if (onProgress) onProgress(20, { tags_fetched: tags.length, categories_seeded: categoriesSeeded });
  log('info', 'viator_tags_synced', { tags_fetched: tags.length, categories_seeded: categoriesSeeded, mappings_created: mappingsCreated });
  return { tags_fetched: tags.length, categories_seeded: categoriesSeeded, mappings_created: mappingsCreated };
};

// ── Destinations ──────────────────────────────────────────────
// Fetches Viator's destination hierarchy. Returns the list for use by attractions sync.

export const syncViatorDestinations = async (client, { onProgress } = {}) => {
  log('info', 'viator_destinations_fetch_start');
  const resp = await client.get('/destinations');
  const destinations = resp.data?.destinations || resp.data || [];
  if (!Array.isArray(destinations) || destinations.length === 0) {
    log('warn', 'viator_destinations_empty');
    return { destinations: [], count: 0 };
  }

  log('info', 'viator_destinations_fetched', { count: destinations.length });
  if (onProgress) onProgress(30, { destinations_fetched: destinations.length });
  return { destinations, count: destinations.length };
};

// ── Attractions per Destination ───────────────────────────────
// Fetches attractions for top destinations and seeds hub_global_pois + hub_supplier_pois.

const isCity = (dest) => {
  // Viator destinations have a type or lookupId structure
  // Cities typically have a parent (region/country)
  return dest.type === 'CITY' || dest.destinationType === 'CITY' ||
    (dest.lookupId && dest.lookupId.includes('.'));
};

export const syncViatorAttractions = async (client, destinations, { onProgress, maxCities = 100 } = {}) => {
  // Filter to city-level destinations
  const cities = destinations.filter(isCity).slice(0, maxCities);
  log('info', 'viator_attractions_sync_start', { city_count: cities.length });

  let totalAttractions = 0;
  let globalPoisCreated = 0;
  let supplierPoisCreated = 0;

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const destId = city.destinationId || city.ref;
    if (!destId) continue;

    try {
      // POST to /attractions/search with destination filter
      const resp = await client.post('/attractions/search', {
        destId: Number(destId),
        topX: '1-100',
        sortOrder: 'RECOMMENDED',
      });
      const attractions = resp.data?.attractions || [];

      for (const attr of attractions) {
        const name = attr.title || attr.name;
        const lat = attr.latitude || attr.location?.latitude;
        const lng = attr.longitude || attr.location?.longitude;

        if (!name || lat == null || lng == null) continue;

        const cityName = city.name || city.destinationName || 'Unknown';
        const country = city.countryName || city.parentDestinationName || null;
        totalAttractions++;

        // Upsert global POI
        const { rows } = await query(
          `INSERT INTO hub_global_pois (name, display_name, city, country, latitude, longitude, source, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, 'viator_seed', 0.95)
           ON CONFLICT (name, city) DO UPDATE SET
             latitude = COALESCE(NULLIF(EXCLUDED.latitude, 0), hub_global_pois.latitude),
             longitude = COALESCE(NULLIF(EXCLUDED.longitude, 0), hub_global_pois.longitude),
             country = COALESCE(EXCLUDED.country, hub_global_pois.country),
             updated_at = now()
           RETURNING id`,
          [name.toLowerCase().trim(), name, cityName, country, lat, lng]
        );
        if (rows[0]) globalPoisCreated++;

        const globalPoiId = rows[0]?.id;

        // Link supplier POI
        const seoId = attr.seoId || attr.attractionId || attr.webURL;
        if (seoId && globalPoiId) {
          await query(
            `INSERT INTO hub_supplier_pois (supplier_slug, supplier_poi_ref, supplier_poi_name, global_poi_id, match_confidence, match_method, raw_data)
             VALUES ('viator', $1, $2, $3, 0.95, 'viator_api', $4)
             ON CONFLICT (supplier_slug, supplier_poi_ref) DO UPDATE SET
               global_poi_id = EXCLUDED.global_poi_id,
               supplier_poi_name = EXCLUDED.supplier_poi_name`,
            [String(seoId), name, globalPoiId, JSON.stringify(attr)]
          );
          supplierPoisCreated++;
        }
      }

      if (i % 10 === 0 && onProgress) {
        onProgress(30 + Math.round((i / cities.length) * 60), {
          cities_processed: i + 1,
          total_attractions: totalAttractions,
        });
      }
    } catch (e) {
      if (e.response?.status === 429) {
        log('warn', 'viator_attractions_rate_limited', { city: city.name });
        await sleep(5000);
        i--; // retry this city
        continue;
      }
      log('warn', 'viator_attractions_city_error', { city: city.name, error: e.message });
    }

    await sleep(100);
  }

  if (onProgress) onProgress(95, { total_attractions: totalAttractions });
  log('info', 'viator_attractions_synced', {
    cities_processed: cities.length,
    total_attractions: totalAttractions,
    global_pois_created: globalPoisCreated,
    supplier_pois_created: supplierPoisCreated,
  });

  return { cities_processed: cities.length, total_attractions: totalAttractions, global_pois_created: globalPoisCreated, supplier_pois_created: supplierPoisCreated };
};

// ── Full Taxonomy Sync ────────────────────────────────────────
// Orchestrates: tags → destinations → attractions → link products.

export const syncViatorTaxonomy = async ({ apiKey, env = 'sandbox', maxCities = 50, onProgress } = {}) => {
  if (!apiKey) throw new Error('VIATOR_API_KEY is required');
  const client = buildClient(apiKey, env);

  // Auth check
  try {
    await client.get('/products/tags');
  } catch (e) {
    if (e.response?.status === 401) throw new Error('Viator API key is invalid or not yet activated');
    throw e;
  }

  const progress = onProgress || (() => {});

  // Step 1: Tags → canonical categories
  progress(5, { step: 'tags' });
  const tagResult = await syncViatorTags(client, { onProgress: progress });

  // Step 2: Destinations
  progress(25, { step: 'destinations' });
  const { destinations } = await syncViatorDestinations(client, { onProgress: progress });

  // Step 3: Attractions per top destination → global POIs
  progress(35, { step: 'attractions' });
  const attrResult = await syncViatorAttractions(client, destinations, {
    onProgress: progress,
    maxCities,
  });

  // Step 4: Link inventory records to global POIs where Viator products reference attractions
  progress(96, { step: 'link_products' });
  const linkResult = await linkViatorProductsToPois();

  progress(100, { step: 'complete' });
  return { tags: tagResult, destinations: destinations.length, attractions: attrResult, products_linked: linkResult };
};

// Link Viator inventory records to global POIs using raw_content.itinerary.pointsOfInterest
const linkViatorProductsToPois = async () => {
  const { rows: products } = await query(`
    SELECT id, raw_content
    FROM hub_static_inventory
    WHERE supplier_slug = 'viator' AND is_active = true AND global_poi_id IS NULL
      AND raw_content IS NOT NULL
    LIMIT 10000
  `);

  let linked = 0;
  for (const p of products) {
    const raw = typeof p.raw_content === 'string' ? JSON.parse(p.raw_content) : p.raw_content;
    const pois = raw?.itinerary?.pointsOfInterest || [];
    const attractionRefs = [];

    for (const poi of pois) {
      const ref = poi.attractionId || poi.seoId || poi.location?.ref;
      if (ref) attractionRefs.push(String(ref));
    }

    if (attractionRefs.length === 0) continue;

    // Find first matching supplier POI → global POI
    const { rows: matches } = await query(
      `SELECT global_poi_id FROM hub_supplier_pois
       WHERE supplier_slug = 'viator' AND supplier_poi_ref = ANY($1)
         AND global_poi_id IS NOT NULL
       LIMIT 1`,
      [attractionRefs]
    );

    if (matches.length > 0) {
      await query(
        `UPDATE hub_static_inventory SET global_poi_id = $1 WHERE id = $2`,
        [matches[0].global_poi_id, p.id]
      );
      linked++;
    }
  }

  log('info', 'viator_products_linked_to_pois', { total_products: products.length, linked });
  return { total_products: products.length, linked };
};
