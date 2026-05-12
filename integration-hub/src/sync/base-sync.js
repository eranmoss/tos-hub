import { query } from '../db/client.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const UPSERT_COLUMNS = [
  'supplier_slug', 'supplier_raw_ref', 'type', 'title', 'description',
  'latitude', 'longitude', 'city', 'country', 'timezone', 'category',
  'duration_minutes', 'vehicle_class', 'star_rating', 'image_urls',
  'amenities', 'meal_plans', 'route_origin', 'route_destination',
  'price_from', 'price_currency', 'rating', 'review_count',
  'raw_content', 'last_synced_at',
];

const startJob = async (slug) => {
  const r = await query(
    `INSERT INTO hub_sync_jobs(supplier_slug, status) VALUES ($1, 'RUNNING') RETURNING id`,
    [slug]
  );
  return r.rows[0].id;
};

const completeJob = async (jobId, counts, errorMessage = null) => {
  const status = errorMessage ? 'FAILED' : 'COMPLETE';
  await query(
    `UPDATE hub_sync_jobs SET
       status = $1,
       records_fetched = $2,
       records_upserted = $3,
       records_deactivated = $4,
       records_errored = $5,
       completed_at = now(),
       error_message = $6::text
     WHERE id = $7`,
    [status, counts.fetched, counts.upserted, counts.deactivated, counts.errored, errorMessage, jobId]
  );
};

const logRecordError = async (jobId, ref, err, raw) => {
  try {
    await query(
      `INSERT INTO hub_sync_errors(sync_job_id, supplier_raw_ref, error_message, raw_record)
       VALUES ($1,$2,$3,$4)`,
      [jobId, ref, err.message || String(err), raw || null]
    );
  } catch (e) {
    log('error', 'sync_error_log_failed', { error: e.message });
  }
};

const upsertRecord = async (rec) => {
  const values = UPSERT_COLUMNS.map(c => rec[c] !== undefined ? rec[c] : null);
  const params = values.map((_, i) => `$${i + 1}`).join(',');
  const updates = UPSERT_COLUMNS
    .filter(c => c !== 'supplier_slug' && c !== 'supplier_raw_ref')
    .map(c => `${c} = EXCLUDED.${c}`)
    .join(', ');
  await query(
    `INSERT INTO hub_static_inventory(${UPSERT_COLUMNS.join(',')})
     VALUES (${params})
     ON CONFLICT (supplier_slug, supplier_raw_ref)
     DO UPDATE SET ${updates}, is_active = true, updated_at = now()`,
    values
  );
};

// Fetcher: async iterable yielding { records: [raw...], done?: boolean }
// Mapper:  (raw) => CTS-static record or null to skip
export const runSync = async ({ supplierSlug, fetcher, mapper }) => {
  const jobId = await startJob(supplierSlug);
  const counts = { fetched: 0, upserted: 0, deactivated: 0, errored: 0 };
  const seenRefs = new Set();

  try {
    for await (const page of fetcher()) {
      const records = page?.records || [];
      counts.fetched += records.length;
      for (const raw of records) {
        try {
          const rec = mapper(raw);
          if (!rec || !rec.supplier_raw_ref) continue;
          rec.supplier_slug = supplierSlug;
          rec.last_synced_at = new Date();
          await upsertRecord(rec);
          seenRefs.add(rec.supplier_raw_ref);
          counts.upserted += 1;
        } catch (err) {
          counts.errored += 1;
          await logRecordError(jobId, raw?.id || null, err, raw);
        }
      }
    }

    // Soft-delete refs not seen this run — but only if we actually fetched records.
    // A sync that fetches 0 records is an API failure, not "all records removed".
    if (seenRefs.size > 0) {
      const existing = await query(
        `SELECT supplier_raw_ref FROM hub_static_inventory
         WHERE supplier_slug = $1 AND is_active = true`,
        [supplierSlug]
      );
      const stale = existing.rows
        .map(r => r.supplier_raw_ref)
        .filter(ref => !seenRefs.has(ref));
      if (stale.length > 0) {
        await query(
          `UPDATE hub_static_inventory SET is_active = false, updated_at = now()
           WHERE supplier_slug = $1 AND supplier_raw_ref = ANY($2)`,
          [supplierSlug, stale]
        );
        counts.deactivated = stale.length;
      }
    } else if (counts.fetched === 0) {
      log('warn', 'sync_zero_records', { supplier: supplierSlug, msg: 'Skipped soft-delete — no records fetched (possible API failure)' });
    }

    await completeJob(jobId, counts);
    log('info', 'sync_complete', { supplier: supplierSlug, ...counts });
    return { jobId, ...counts };
  } catch (err) {
    await completeJob(jobId, counts, err.message);
    log('error', 'sync_failed', { supplier: supplierSlug, error: err.message });
    throw err;
  }
};
