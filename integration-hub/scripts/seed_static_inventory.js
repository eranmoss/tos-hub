import 'dotenv/config';
import { query, closePool } from '../src/db/client.js';

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));

// All rows clustered around Barcelona so one /v1/search call hits them all.
const BCN = { lat: 41.3851, lng: 2.1734 };
const near = (dLat, dLng) => ({ lat: BCN.lat + dLat, lng: BCN.lng + dLng });

const ROWS = [
  // hotelbeds-hotels
  { slug: 'hotelbeds-hotels', ref: 'HB-H-1001', type: 'HOTEL', title: 'Hotel Arts Barcelona', star: 5, ...near(0.01, 0.02), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-hotels', ref: 'HB-H-1002', type: 'HOTEL', title: 'W Barcelona', star: 5, ...near(-0.01, 0.03), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-hotels', ref: 'HB-H-1003', type: 'HOTEL', title: 'Hotel Casa Fuster', star: 5, ...near(0.02, -0.01), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-hotels', ref: 'HB-H-1004', type: 'HOTEL', title: 'Ohla Barcelona', star: 5, ...near(0.005, 0.005), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-hotels', ref: 'HB-H-1005', type: 'HOTEL', title: 'Hotel Neri', star: 4, ...near(0.003, 0.007), city: 'Barcelona', country: 'ES' },

  // hotelbeds-activities (EXPERIENCE)
  { slug: 'hotelbeds-activities', ref: 'HB-A-2001', type: 'EXPERIENCE', title: 'Sagrada Familia Skip The Line', category: 'CULTURE', duration: 90, ...near(0.02, 0.001), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-activities', ref: 'HB-A-2002', type: 'EXPERIENCE', title: 'Park Guell Guided Tour', category: 'CULTURE', duration: 120, ...near(0.03, -0.01), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-activities', ref: 'HB-A-2003', type: 'EXPERIENCE', title: 'Tapas & Wine Walking Tour', category: 'FOOD', duration: 180, ...near(0.001, 0.003), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-activities', ref: 'HB-A-2004', type: 'EXPERIENCE', title: 'Flamenco Show at Tablao Cordobes', category: 'CULTURE', duration: 75, ...near(0.002, 0.002), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-activities', ref: 'HB-A-2005', type: 'EXPERIENCE', title: 'Montjuic Cable Car Experience', category: 'SIGHTSEEING', duration: 60, ...near(-0.02, 0.01), city: 'Barcelona', country: 'ES' },

  // bridgify (EXPERIENCE) — a couple overlap with HotelBeds for dedup demo
  { slug: 'bridgify', ref: 'BR-3001', type: 'EXPERIENCE', title: 'Sagrada Familia Priority Access Tour', category: 'CULTURE', duration: 90, ...near(0.0201, 0.0011), city: 'Barcelona', country: 'ES' },
  { slug: 'bridgify', ref: 'BR-3002', type: 'EXPERIENCE', title: 'Park Guell Fast Track Entry', category: 'CULTURE', duration: 120, ...near(0.0301, -0.0101), city: 'Barcelona', country: 'ES' },
  { slug: 'bridgify', ref: 'BR-3003', type: 'EXPERIENCE', title: 'Gothic Quarter Walking Tour', category: 'CULTURE', duration: 150, ...near(0.004, 0.006), city: 'Barcelona', country: 'ES' },
  { slug: 'bridgify', ref: 'BR-3004', type: 'EXPERIENCE', title: 'Barcelona Cooking Class', category: 'FOOD', duration: 240, ...near(-0.005, 0.004), city: 'Barcelona', country: 'ES' },
  { slug: 'bridgify', ref: 'BR-3005', type: 'EXPERIENCE', title: 'Camp Nou Stadium Tour', category: 'SPORT', duration: 90, ...near(-0.03, -0.04), city: 'Barcelona', country: 'ES' },

  // hotelbeds-transfers
  { slug: 'hotelbeds-transfers', ref: 'HB-T-4001', type: 'TRANSFER', title: 'BCN Airport → Hotel (Sedan)', vehicle: 'SEDAN', origin: 'BCN', dest: 'BCN_HOTELS', ...near(0, 0), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-transfers', ref: 'HB-T-4002', type: 'TRANSFER', title: 'BCN Airport → Hotel (Van)', vehicle: 'VAN', origin: 'BCN', dest: 'BCN_HOTELS', ...near(0, 0), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-transfers', ref: 'HB-T-4003', type: 'TRANSFER', title: 'BCN Airport → Hotel (Minibus)', vehicle: 'MINIBUS', origin: 'BCN', dest: 'BCN_HOTELS', ...near(0, 0), city: 'Barcelona', country: 'ES' },
  { slug: 'hotelbeds-transfers', ref: 'HB-T-4004', type: 'TRANSFER', title: 'Hotel → BCN Airport (Sedan)', vehicle: 'SEDAN', origin: 'BCN_HOTELS', dest: 'BCN', ...near(0, 0), city: 'Barcelona', country: 'ES' },
];

const ensureSupplier = async (slug, cats, authType) => {
  await query(
    `INSERT INTO hub_suppliers(supplier_slug, name, categories, auth_type)
     VALUES ($1, $1, $2, $3)
     ON CONFLICT (supplier_slug) DO NOTHING`,
    [slug, cats, authType]
  );
};

const main = async () => {
  await ensureSupplier('hotelbeds-hotels', ['HOTEL'], 'HMAC');
  await ensureSupplier('hotelbeds-activities', ['EXPERIENCE'], 'HMAC');
  await ensureSupplier('hotelbeds-transfers', ['TRANSFER'], 'HMAC');
  await ensureSupplier('bridgify', ['EXPERIENCE'], 'OAUTH2');

  for (const r of ROWS) {
    await query(
      `INSERT INTO hub_static_inventory
         (supplier_slug, supplier_raw_ref, type, title, latitude, longitude,
          city, country, category, duration_minutes, vehicle_class, star_rating,
          route_origin, route_destination, is_active, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,now())
       ON CONFLICT (supplier_slug, supplier_raw_ref) DO UPDATE SET
         title = EXCLUDED.title,
         latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
         city = EXCLUDED.city, country = EXCLUDED.country,
         category = EXCLUDED.category, duration_minutes = EXCLUDED.duration_minutes,
         vehicle_class = EXCLUDED.vehicle_class, star_rating = EXCLUDED.star_rating,
         route_origin = EXCLUDED.route_origin, route_destination = EXCLUDED.route_destination,
         is_active = true, last_synced_at = now(), updated_at = now()`,
      [r.slug, r.ref, r.type, r.title, r.lat, r.lng, r.city, r.country,
       r.category || null, r.duration || null, r.vehicle || null, r.star || null,
       r.origin || null, r.dest || null]
    );
  }
  log('seed_complete', { rows: ROWS.length });

  const byType = await query(
    `SELECT type, COUNT(*)::int AS n FROM hub_static_inventory
     WHERE supplier_raw_ref LIKE 'HB-%' OR supplier_raw_ref LIKE 'BR-%'
     GROUP BY type ORDER BY type`
  );
  for (const r of byType.rows) log('seed_count', r);
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((e) => { log('seed_failed', { error: e.message }); process.exit(1); });
