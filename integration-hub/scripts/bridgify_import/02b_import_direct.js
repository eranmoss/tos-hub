// Direct-DB import: stream rows from Bridgify Postgres into hub_static_inventory.
//
// Reads BRIDGIFY_DATABASE_URL (or discrete BRIDGIFY_DB_* vars) from .env.
// No CSV intermediate — pulls, translates, upserts in one pass.
//
// Usage:
//   node scripts/bridgify_import/02b_import_direct.js [flags]
//
// Flags:
//   --limit N        Cap total rows imported (default: no cap, ~555K)
//   --supplier slug  Restrict to one supplier (e.g. --supplier viator)
//   --city name      Restrict to one city (e.g. --city "Barcelona")
//   --batch N        Page size in rows (default: 5000)
//   --dry-run        Read and translate but skip upsert
//
// Resumability:
//   - ON CONFLICT (supplier_slug, supplier_raw_ref) DO UPDATE makes re-runs idempotent
//   - keyset pagination on Bridgify uuid means a restart resumes from where it left off
//     if you preserve the last-seen UUID externally; this script just re-runs from start
//     and lets ON CONFLICT no-op the already-imported rows (cheap and simple)
//
// hub_sync_jobs is updated with progress for operational visibility.

import 'dotenv/config';
import pg from 'pg';
import { query, closePool } from '../../src/db/client.js';

const { Pool } = pg;

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));
const warn = (event, extra = {}) =>
  console.warn(JSON.stringify({ level: 'warn', event, ...extra }));
const err  = (event, extra = {}) =>
  console.error(JSON.stringify({ level: 'error', event, ...extra }));

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const next = argv[i + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
};

const LIMIT      = argOf('limit') ? parseInt(argOf('limit'), 10) : null;
const SUPPLIER   = argOf('supplier') || null;     // e.g. 'viator'
const CITY       = argOf('city') || null;         // e.g. 'Barcelona'
const BATCH      = argOf('batch') ? parseInt(argOf('batch'), 10) : 5000;
const DRY_RUN    = argv.includes('--dry-run');

// ─────────────────────────────────────────────────────────────────────────────
// Bridgify connection — accepts URL or discrete fields
// ─────────────────────────────────────────────────────────────────────────────

const buildBridgifyConfig = () => {
  if (process.env.BRIDGIFY_DATABASE_URL && !process.env.BRIDGIFY_DATABASE_URL.includes('USER:PASSWORD@HOST')) {
    return { connectionString: process.env.BRIDGIFY_DATABASE_URL };
  }
  const host = process.env.BRIDGIFY_DB_HOST;
  const user = process.env.BRIDGIFY_DB_USER;
  const password = process.env.BRIDGIFY_DB_PASSWORD;
  const database = process.env.BRIDGIFY_DB_NAME;
  if (!host || !user || !password || !database) {
    throw new Error(
      'Bridgify DB credentials missing. Set BRIDGIFY_DATABASE_URL ' +
      'or BRIDGIFY_DB_HOST/PORT/NAME/USER/PASSWORD in .env.'
    );
  }
  return {
    host,
    port: parseInt(process.env.BRIDGIFY_DB_PORT || '5432', 10),
    user,
    password,
    database,
    ssl: (process.env.BRIDGIFY_DB_SSL === 'require' || process.env.BRIDGIFY_DB_SSL === 'true')
      ? { rejectUnauthorized: false }
      : false,
  };
};

const bridgifyPool = new Pool({
  ...buildBridgifyConfig(),
  max: 2,                  // we only need one connection for streaming
  idleTimeoutMillis: 10_000,
  statement_timeout: 0,    // long-running cursor query
});

// ─────────────────────────────────────────────────────────────────────────────
// Translation SELECT — keyset paginated on uuid for stable ordering
// ─────────────────────────────────────────────────────────────────────────────

const SUPPLIER_WHITELIST_LOWERCASE = [
  'viator', 'getyourguide', 'tiqets', 'hotelbeds',
  'attractionworld', 'bookitfun', 'tillo',
  'stubhub', 'ticketero', 'sportsevents365', 'livetickets', 'manawa',
];

const buildTranslationSQL = ({ afterUuid, supplier, city, batchSize }) => {
  const whereClauses = [
    'is_active = true',
    'title IS NOT NULL',
    'inventory_supplier IS NOT NULL',
    '(is_test_attraction IS NULL OR is_test_attraction = false)',
  ];
  const params = [];
  let p = 0;

  if (supplier) {
    params.push(supplier.toLowerCase());
    whereClauses.push(`LOWER(inventory_supplier) = $${++p}`);
  } else {
    params.push(SUPPLIER_WHITELIST_LOWERCASE);
    whereClauses.push(`LOWER(inventory_supplier) = ANY($${++p}::varchar[])`);
  }

  if (city) {
    params.push(city);
    whereClauses.push(`external_city_name = $${++p}`);
  }

  if (afterUuid) {
    params.push(afterUuid);
    whereClauses.push(`uuid > $${++p}`);
  }

  params.push(batchSize);
  const limitParam = `$${++p}`;

  return {
    sql: `
      SELECT
        uuid,
        LOWER(inventory_supplier)            AS supplier_slug,
        external_id                          AS supplier_raw_ref,
        'EXPERIENCE'                         AS type,
        title,
        description,
        ST_Y(geolocation::geometry)          AS latitude,
        ST_X(geolocation::geometry)          AS longitude,
        external_city_name                   AS city,
        external_country_name                AS country,
        NULL::varchar                        AS timezone,
        CASE
          WHEN categories_list IS NOT NULL AND array_length(categories_list, 1) > 0
            THEN categories_list[1]
          ELSE NULL
        END                                  AS category,
        CASE
          WHEN duration IS NOT NULL
            THEN (EXTRACT(EPOCH FROM duration) / 60)::integer
          ELSE NULL
        END                                  AS duration_minutes,
        price                                AS price_from,
        currency                             AS price_currency,
        rating,
        CASE
          WHEN main_photo_url IS NOT NULL AND main_photo_url <> ''
            THEN ARRAY[main_photo_url]
          ELSE NULL
        END                                  AS image_urls,
        jsonb_build_object(
          'bridgify_uuid',      uuid::text,
          'inventory_supplier', inventory_supplier,
          'price',              price,
          'currency',           currency,
          'rating',             rating,
          'number_of_reviews',  number_of_reviews,
          'availability_type',  availability_type,
          'is_curated',         is_curated,
          'is_entry_ticket',    is_entry_ticket,
          'last_updated',       last_updated
        )                                    AS raw_content,
        is_active
      FROM "attractionsAPI_attraction"
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY uuid
      LIMIT ${limitParam}
    `,
    params,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Hub upsert
// ─────────────────────────────────────────────────────────────────────────────

const COLS_PER_ROW = 18;
const MAX_PG_PARAMS = 65535;
const UPSERT_CHUNK = Math.floor(MAX_PG_PARAMS / COLS_PER_ROW);

const upsertChunk = async (rows) => {
  const placeholders = [];
  const values = [];
  let p = 1;
  for (const r of rows) {
    placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},now())`);
    values.push(
      r.supplier_slug, r.supplier_raw_ref, r.type, r.title, r.description,
      r.latitude, r.longitude, r.city, r.country, r.timezone,
      r.category, r.duration_minutes,
      r.price_from, r.price_currency, r.rating,
      r.image_urls,
      r.raw_content == null ? null : JSON.stringify(r.raw_content),
      r.is_active
    );
  }
  const sql = `
    INSERT INTO hub_static_inventory (
      supplier_slug, supplier_raw_ref, type, title, description,
      latitude, longitude, city, country, timezone,
      category, duration_minutes,
      price_from, price_currency, rating,
      image_urls, raw_content,
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
      price_from       = EXCLUDED.price_from,
      price_currency   = EXCLUDED.price_currency,
      rating           = EXCLUDED.rating,
      image_urls       = EXCLUDED.image_urls,
      raw_content      = EXCLUDED.raw_content,
      is_active        = EXCLUDED.is_active,
      last_synced_at   = now(),
      updated_at       = now()
  `;
  await query(sql, values);
};

const upsertBatch = async (rows) => {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await upsertChunk(rows.slice(i, i + UPSERT_CHUNK));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Sync job tracking
// ─────────────────────────────────────────────────────────────────────────────

const startJob = async () => {
  const slug = SUPPLIER || 'bridgify_import';
  const { rows } = await query(
    `INSERT INTO hub_sync_jobs (supplier_slug, status, started_at)
     VALUES ($1, 'RUNNING', now())
     RETURNING id`,
    [slug]
  );
  return rows[0].id;
};

const updateJobProgress = async (jobId, fetched, upserted) => {
  await query(
    `UPDATE hub_sync_jobs
        SET records_fetched = $1, records_upserted = $2
      WHERE id = $3`,
    [fetched, upserted, jobId]
  );
};

const finishJob = async (jobId, status, error = null) => {
  await query(
    `UPDATE hub_sync_jobs
        SET status = $1, completed_at = now(), error_message = $2
      WHERE id = $3`,
    [status, error, jobId]
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main loop — keyset pagination
// ─────────────────────────────────────────────────────────────────────────────

const main = async () => {
  log('import_start', {
    supplier: SUPPLIER || 'all',
    city: CITY || 'all',
    batch: BATCH,
    limit: LIMIT,
    dry_run: DRY_RUN,
  });

  // Verify Bridgify connection up front
  const probe = await bridgifyPool.query('SELECT 1 AS ok');
  if (probe.rows[0].ok !== 1) throw new Error('Bridgify probe failed');
  log('bridgify_connected');

  const jobId = DRY_RUN ? null : await startJob();
  if (jobId) log('job_started', { job_id: jobId });

  const startedAt = Date.now();
  let afterUuid = null;
  let fetched = 0;
  let upserted = 0;

  try {
    while (true) {
      const remaining = LIMIT ? Math.max(0, LIMIT - fetched) : Infinity;
      if (remaining === 0) break;
      const thisBatch = Math.min(BATCH, remaining);

      const { sql, params } = buildTranslationSQL({
        afterUuid, supplier: SUPPLIER, city: CITY, batchSize: thisBatch,
      });
      const { rows } = await bridgifyPool.query(sql, params);
      if (rows.length === 0) break;

      fetched += rows.length;
      afterUuid = rows[rows.length - 1].uuid;

      if (!DRY_RUN) {
        await upsertBatch(rows);
        upserted += rows.length;
      }

      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = Math.round(fetched / elapsed);
      log('progress', {
        fetched, upserted, last_uuid: afterUuid,
        rate_per_sec: rate, elapsed_sec: Math.round(elapsed),
      });

      if (jobId && fetched % 25_000 === 0) {
        await updateJobProgress(jobId, fetched, upserted);
      }
    }

    if (jobId) {
      await updateJobProgress(jobId, fetched, upserted);
      await finishJob(jobId, 'COMPLETE');
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log('import_complete', { fetched, upserted, dry_run: DRY_RUN, elapsed_sec: elapsed });

    // Per-supplier summary in hub
    if (!DRY_RUN) {
      const { rows: summary } = await query(
        `SELECT supplier_slug, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE latitude IS NOT NULL)::int AS with_geo,
                COUNT(*) FILTER (WHERE description IS NOT NULL)::int AS with_desc,
                COUNT(*) FILTER (WHERE category IS NOT NULL)::int AS with_category
           FROM hub_static_inventory
          WHERE supplier_slug = ANY($1::varchar[])
          GROUP BY supplier_slug
          ORDER BY total DESC`,
        [SUPPLIER_WHITELIST_LOWERCASE]
      );
      log('hub_summary', { suppliers: summary });
    }
  } catch (e) {
    err('import_failed', { error: e.message, stack: e.stack });
    if (jobId) await finishJob(jobId, 'FAILED', e.message).catch(() => {});
    throw e;
  }
};

main()
  .then(async () => {
    await bridgifyPool.end();
    await closePool();
    process.exit(0);
  })
  .catch(async (e) => {
    try { await bridgifyPool.end(); } catch {}
    try { await closePool(); } catch {}
    process.exit(1);
  });
