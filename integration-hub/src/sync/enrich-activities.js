import 'dotenv/config';
import axios from 'axios';
import { query } from '../db/client.js';
import { buildHeaders } from '../suppliers/hotelbeds/auth.js';
import { getSecret } from '../infra/secrets.js';

const CONTENT_API = 'https://api.test.hotelbeds.com/activity-content-api/3.0';
const CONTENT_API_PROD = 'https://api.hotelbeds.com/activity-content-api/3.0';
const DELAY_BETWEEN_MS = 100;

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ts: new Date().toISOString(), ...extra }));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const stripHtml = (s) => s?.replace(/<\/?[^>]+(>|$)/g, ' ').replace(/\s+/g, ' ').trim() || '';

const buildDescription = (content) => {
  const parts = [];
  if (content.description) parts.push(stripHtml(content.description));
  if (content.highligths?.length) {
    parts.push(content.highligths.map(h => stripHtml(h)).filter(Boolean).join('. '));
  }
  if (content.importantInfo?.length) {
    parts.push(content.importantInfo.map(i => stripHtml(i)).filter(Boolean).join('. '));
  }
  const feats = content.featureGroups || [];
  const included = [];
  for (const fg of feats) {
    for (const inc of (fg.included || [])) {
      if (inc.description) included.push(inc.description);
    }
  }
  if (included.length) parts.push('Includes: ' + included.join(', '));
  return parts.filter(Boolean).join(' | ') || null;
};

const extractImages = (content) => {
  const images = content.media?.images || [];
  const urls = [];
  for (const img of images) {
    const xlarge = img.urls?.find(u => u.sizeType === 'XLARGE' || u.sizeType === 'LARGE2');
    const any = xlarge || img.urls?.[0];
    if (any?.resource) urls.push(any.resource);
  }
  return urls.length ? urls : null;
};

const extractGeo = (content) => {
  const sp = content.location?.startingPoints?.[0]?.meetingPoint;
  if (sp?.geolocation) {
    return { lat: sp.geolocation.latitude, lng: sp.geolocation.longitude };
  }
  return null;
};

const startJob = async () => {
  const r = await query(
    `INSERT INTO hub_sync_jobs(supplier_slug, status) VALUES ('hotelbeds-activities-enrich', 'RUNNING') RETURNING id`
  );
  return r.rows[0].id;
};

const completeJob = async (jobId, counts, errorMessage = null) => {
  await query(
    `UPDATE hub_sync_jobs SET
       status = $1, records_fetched = $2, records_upserted = $3,
       records_errored = $4, completed_at = now(), error_message = $5
     WHERE id = $6`,
    [errorMessage ? 'FAILED' : 'COMPLETE', counts.fetched, counts.enriched, counts.errored, errorMessage, jobId]
  );
};

export const enrichActivities = async ({ apiKey, secretKey, env = 'sandbox', limit = null }) => {
  const baseUrl = env === 'production' ? CONTENT_API_PROD : CONTENT_API;
  const jobId = await startJob();
  const counts = { fetched: 0, enriched: 0, errored: 0, skipped: 0, embeddingsCleared: 0 };

  log('info', 'enrich_start', { baseUrl, limit });

  try {
    const limitClause = limit ? `LIMIT ${parseInt(limit)}` : '';
    const { rows: candidates } = await query(
      `SELECT id, supplier_raw_ref, raw_content
       FROM hub_static_inventory
       WHERE supplier_slug = 'hotelbeds-activities'
         AND is_active = true
         AND description IS NULL
       ORDER BY rating DESC NULLS LAST
       ${limitClause}`
    );

    log('info', 'enrich_candidates', { count: candidates.length });
    if (candidates.length === 0) {
      await completeJob(jobId, counts);
      return { jobId, ...counts };
    }

    for (let i = 0; i < candidates.length; i++) {
      const row = candidates[i];
      const code = row.raw_content?.code || row.supplier_raw_ref;
      counts.fetched++;

      try {
        const url = `${baseUrl}/activities/en/${encodeURIComponent(code)}`;
        const res = await axios.get(url, {
          headers: buildHeaders(apiKey, secretKey),
          timeout: 15000,
          validateStatus: s => s < 500,
        });

        if (res.status >= 400) {
          counts.skipped++;
          if (res.status !== 404) {
            log('warn', 'enrich_api_error', { code, status: res.status });
          }
          continue;
        }

        const content = res.data?.activitiesContent?.[0];
        if (!content) {
          counts.skipped++;
          continue;
        }

        const description = buildDescription(content);
        const images = extractImages(content);
        const geo = extractGeo(content);

        if (!description && !images) {
          counts.skipped++;
          continue;
        }

        const updates = [];
        const params = [];
        let idx = 1;

        if (description) {
          updates.push(`description = $${idx}`);
          params.push(description);
          idx++;
        }
        if (images) {
          updates.push(`image_urls = $${idx}`);
          params.push(images);
          idx++;
        }
        if (geo) {
          updates.push(`latitude = $${idx}`);
          params.push(geo.lat);
          idx++;
          updates.push(`longitude = $${idx}`);
          params.push(geo.lng);
          idx++;
        }

        updates.push('embedding = NULL');
        updates.push('updated_at = now()');

        params.push(row.id);
        await query(
          `UPDATE hub_static_inventory SET ${updates.join(', ')} WHERE id = $${idx}`,
          params
        );

        counts.enriched++;
        counts.embeddingsCleared++;

        if (counts.enriched % 100 === 0) {
          const pct = ((counts.fetched / candidates.length) * 100).toFixed(1);
          log('info', 'enrich_progress', {
            fetched: counts.fetched, enriched: counts.enriched,
            errored: counts.errored, pct,
            last: (content.name || code).toString().slice(0, 60),
          });
        }
      } catch (err) {
        counts.errored++;
        if (counts.errored <= 5 || counts.errored % 50 === 0) {
          log('warn', 'enrich_error', { code, error: err.message, total_errors: counts.errored });
        }
        try {
          await query(
            `INSERT INTO hub_sync_errors(sync_job_id, supplier_raw_ref, error_message)
             VALUES ($1, $2, $3)`,
            [jobId, code, err.message]
          );
        } catch (_) {}
      }

      if (DELAY_BETWEEN_MS > 0) await sleep(DELAY_BETWEEN_MS);
    }

    await completeJob(jobId, counts);
    log('info', 'enrich_complete', counts);
    return { jobId, ...counts };
  } catch (err) {
    await completeJob(jobId, counts, err.message);
    log('error', 'enrich_failed', { error: err.message, ...counts });
    throw err;
  }
};

if (process.argv[1]?.includes('enrich-activities')) {
  const tenantId = process.argv[2] || 't_demo';
  const limit = process.argv[3] ? parseInt(process.argv[3]) : null;

  (async () => {
    const creds =
      (await getSecret(tenantId, 'hotelbeds-activities')) ||
      (await getSecret(tenantId, 'hotelbeds'));
    if (!creds?.api_key) {
      console.error('No hotelbeds credentials found for tenant', tenantId);
      process.exit(1);
    }
    const result = await enrichActivities({
      apiKey: creds.api_key,
      secretKey: creds.secret_key || creds.secret,
      env: creds.env || process.env.HOTELBEDS_ENV || 'sandbox',
      limit,
    });
    console.log('\n=== Enrichment complete ===');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
