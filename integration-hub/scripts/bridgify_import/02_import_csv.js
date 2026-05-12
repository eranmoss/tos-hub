// Import the Bridgify-translated CSV into hub_static_inventory.
//
// Usage:
//   node scripts/bridgify_import/02_import_csv.js <path-to-csv> [--limit N] [--dry-run]
//
// Flags:
//   --limit N      Import only the first N rows (useful for smoke testing).
//   --dry-run      Parse and validate rows but skip the upsert.
//
// Expected CSV columns (header row required, in this order):
//   supplier_slug, supplier_raw_ref, type, title, description,
//   latitude, longitude, city, country, timezone, category,
//   duration_minutes, image_urls, raw_content, is_active, last_synced_at
//
// The CSV is produced by running scripts/bridgify_import/translation_query.sql
// in DBeaver and exporting the result grid as CSV.

import 'dotenv/config';
import fs from 'fs';
import { parse } from 'csv-parse';
import { query, closePool } from '../../src/db/client.js';

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));
const warn = (event, extra = {}) =>
  console.warn(JSON.stringify({ level: 'warn', event, ...extra }));

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith('--'));
const limitArg = args.find((a) => a.startsWith('--limit'));
const limit = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10) : null;
const dryRun = args.includes('--dry-run');

if (!csvPath) {
  console.error('Usage: node 02_import_csv.js <path-to-csv> [--limit N] [--dry-run]');
  process.exit(1);
}

const BATCH_SIZE = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Cleaners — Postgres CSV export wraps arrays/jsonb in specific formats.
// ─────────────────────────────────────────────────────────────────────────────

// CSV gives us numbers as strings. Coerce or null.
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const int = (v) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

const bool = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v).toLowerCase().trim();
  if (s === 't' || s === 'true' || s === '1') return true;
  if (s === 'f' || s === 'false' || s === '0') return false;
  return null;
};

// Postgres array literal looks like `{a,b,c}` or `{"a b","c"}`.
// For our case (image_urls), we expect either a single quoted URL or empty.
const parsePgArray = (v) => {
  if (v === '' || v == null) return null;
  if (Array.isArray(v)) return v;
  const s = String(v).trim();
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  const inner = s.slice(1, -1);
  if (inner === '') return null;
  // Naive split — fine for our case (URLs don't contain commas).
  return inner.split(',').map((x) => x.replace(/^"|"$/g, '').trim()).filter(Boolean);
};

// raw_content comes through as a JSON string. Validate by parse-then-stringify.
const parseJsonb = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-row translation: CSV row → values array for the INSERT.
// ─────────────────────────────────────────────────────────────────────────────

const buildRow = (r) => ({
  supplier_slug:    r.supplier_slug?.trim() || null,
  supplier_raw_ref: r.supplier_raw_ref?.trim() || null,
  type:             r.type?.trim() || 'EXPERIENCE',
  title:            r.title?.trim() || null,
  description:      r.description || null,
  latitude:         num(r.latitude),
  longitude:        num(r.longitude),
  city:             r.city?.trim() || null,
  country:          r.country?.trim() || null,
  timezone:         r.timezone?.trim() || null,
  category:         r.category?.trim() || null,
  duration_minutes: int(r.duration_minutes),
  image_urls:       parsePgArray(r.image_urls),
  raw_content:      parseJsonb(r.raw_content),
  is_active:        bool(r.is_active) ?? true,
  last_synced_at:   r.last_synced_at || new Date().toISOString(),
});

const rowIsValid = (r) =>
  r.supplier_slug && r.supplier_raw_ref && r.title;

// ─────────────────────────────────────────────────────────────────────────────
// Bulk upsert.
// ─────────────────────────────────────────────────────────────────────────────

const upsertBatch = async (rows) => {
  if (rows.length === 0) return;
  const placeholders = [];
  const values = [];
  let p = 1;
  for (const r of rows) {
    placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
    values.push(
      r.supplier_slug, r.supplier_raw_ref, r.type, r.title, r.description,
      r.latitude, r.longitude, r.city, r.country, r.timezone,
      r.category, r.duration_minutes, r.image_urls,
      r.raw_content == null ? null : JSON.stringify(r.raw_content),
      r.is_active, r.last_synced_at
    );
  }
  const sql = `
    INSERT INTO hub_static_inventory (
      supplier_slug, supplier_raw_ref, type, title, description,
      latitude, longitude, city, country, timezone,
      category, duration_minutes, image_urls, raw_content,
      is_active, last_synced_at
    )
    VALUES ${placeholders.join(',')}
    ON CONFLICT (supplier_slug, supplier_raw_ref) DO UPDATE SET
      title            = EXCLUDED.title,
      description      = EXCLUDED.description,
      latitude         = EXCLUDED.latitude,
      longitude        = EXCLUDED.longitude,
      city             = EXCLUDED.city,
      country          = EXCLUDED.country,
      timezone         = EXCLUDED.timezone,
      category         = EXCLUDED.category,
      duration_minutes = EXCLUDED.duration_minutes,
      image_urls       = EXCLUDED.image_urls,
      raw_content      = EXCLUDED.raw_content,
      is_active        = EXCLUDED.is_active,
      last_synced_at   = EXCLUDED.last_synced_at,
      updated_at       = now()
  `;
  await query(sql, values);
};

// ─────────────────────────────────────────────────────────────────────────────
// Main.
// ─────────────────────────────────────────────────────────────────────────────

const main = async () => {
  log('import_start', { csv: csvPath, dryRun, limit });

  const startedAt = Date.now();
  let read = 0;
  let valid = 0;
  let skipped = 0;
  let upserted = 0;
  let batch = [];

  const parser = fs.createReadStream(csvPath).pipe(
    parse({ columns: true, trim: true, skip_empty_lines: true, relax_quotes: true })
  );

  for await (const raw of parser) {
    read++;
    if (limit && read > limit) break;

    const row = buildRow(raw);
    if (!rowIsValid(row)) {
      skipped++;
      if (skipped < 5) warn('row_skipped', { reason: 'missing_required', sample: raw });
      continue;
    }

    valid++;
    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      if (!dryRun) await upsertBatch(batch);
      upserted += batch.length;
      batch = [];
      if (upserted % 10000 === 0) {
        const rate = Math.round(upserted / ((Date.now() - startedAt) / 1000));
        log('import_progress', { read, valid, skipped, upserted, rate_per_sec: rate });
      }
    }
  }

  if (batch.length > 0) {
    if (!dryRun) await upsertBatch(batch);
    upserted += batch.length;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  log('import_complete', { read, valid, skipped, upserted, dryRun, elapsed_sec: elapsed });

  // Post-import sanity check
  if (!dryRun) {
    const { rows: bySupplier } = await query(
      `SELECT supplier_slug, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE latitude IS NOT NULL)::int AS with_geo,
              COUNT(*) FILTER (WHERE description IS NOT NULL)::int AS with_desc
         FROM hub_static_inventory
        WHERE supplier_slug = ANY($1::varchar[])
        GROUP BY supplier_slug
        ORDER BY n DESC`,
      [['viator', 'getyourguide', 'tiqets', 'hotelbeds', 'attractionworld', 'bookitfun', 'tillo']]
    );
    log('post_import_summary', { suppliers: bySupplier });
  }
};

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(JSON.stringify({ level: 'error', event: 'import_failed', error: e.message, stack: e.stack }));
    process.exit(1);
  });
