import { query } from '../db/client.js';

export const JOB_TYPES = {
  SYNC: 'sync',
  DEDUP: 'dedup',
  LLM_JUDGE: 'llm_judge',
  EMBEDDINGS: 'embeddings',
  ENRICH: 'enrich',
  ATTRACTION_CLUSTER: 'attraction_cluster',
  ATTRACTION_VALIDATE: 'attraction_validate',
  GOLD_LABEL: 'gold_label',
  GEO_REVIEW: 'geo_review',
  TAXONOMY_SYNC: 'taxonomy_sync',
  POI_MATCH: 'poi_match',
};

export class JobCancelledError extends Error {
  constructor(jobId) {
    super(`Job ${jobId} cancelled by user`);
    this.name = 'JobCancelledError';
    this.jobId = jobId;
  }
}

export const startJob = async (jobType, slug = jobType) => {
  const { rows: [row] } = await query(
    `INSERT INTO hub_sync_jobs (supplier_slug, job_type, status, started_at)
     VALUES ($1, $2, 'RUNNING', now()) RETURNING id`,
    [slug, jobType]
  );
  return row.id;
};

export const updateJobProgress = async (jobId, pct, detail = null) => {
  const { rows } = await query(
    `UPDATE hub_sync_jobs SET progress_pct = $1, progress_detail = $2
     WHERE id = $3 AND status = 'RUNNING'
     RETURNING status`,
    [Math.min(pct, 100), detail ? JSON.stringify(detail) : null, jobId]
  );
  if (rows.length === 0) {
    const { rows: [job] } = await query(
      `SELECT status FROM hub_sync_jobs WHERE id = $1`, [jobId]
    );
    if (job?.status === 'CANCELLED') throw new JobCancelledError(jobId);
  }
};

export const cancelJob = async (jobId) => {
  const { rows } = await query(
    `UPDATE hub_sync_jobs SET status = 'CANCELLED', completed_at = now(),
            error_message = 'Cancelled by user'
     WHERE id = $1 AND status = 'RUNNING'
     RETURNING id`,
    [jobId]
  );
  return rows.length > 0;
};

export const completeJob = async (jobId, detail = {}, errorMessage = null) => {
  await query(
    `UPDATE hub_sync_jobs
     SET status = $1, completed_at = now(), error_message = $2,
         progress_pct = CASE WHEN $1 = 'COMPLETE' THEN 100 ELSE progress_pct END,
         progress_detail = $3
     WHERE id = $4 AND status IN ('RUNNING', 'CANCELLED')`,
    [
      errorMessage ? 'FAILED' : 'COMPLETE',
      errorMessage,
      JSON.stringify(detail),
      jobId,
    ]
  );
};

export const runTracked = async (jobType, slug, fn) => {
  const jobId = await startJob(jobType, slug);
  const progress = (pct, detail) => updateJobProgress(jobId, pct, detail);
  try {
    const result = await fn(jobId, progress);
    await Promise.race([
      completeJob(jobId, result),
      new Promise((_, rej) => setTimeout(() => rej(new Error('completeJob timeout')), 15000)),
    ]).catch(e => {
      console.error(JSON.stringify({ level: 'warn', event: 'complete_job_timeout', job_id: jobId, error: e.message }));
      query(
        `UPDATE hub_sync_jobs SET status = 'COMPLETE', completed_at = now(), progress_pct = 100, progress_detail = $1 WHERE id = $2 AND status = 'RUNNING'`,
        [JSON.stringify(result || {}), jobId]
      ).catch(() => {});
    });
    return result;
  } catch (err) {
    if (err instanceof JobCancelledError) {
      console.log(JSON.stringify({ level: 'info', event: 'job_cancelled', job_id: jobId, job_type: jobType }));
      return { cancelled: true };
    }
    await completeJob(jobId, {}, err.message).catch(() => {});
    throw err;
  }
};

export const getActiveJobs = async () => {
  const { rows } = await query(`
    SELECT id, supplier_slug, job_type, status, progress_pct, progress_detail,
           records_fetched, records_upserted, records_deactivated, records_errored,
           started_at, completed_at, error_message,
           EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - started_at))::int AS elapsed_sec
    FROM hub_sync_jobs
    ORDER BY started_at DESC
    LIMIT 50
  `);
  return rows;
};

export const getRunningJobs = async () => {
  const { rows } = await query(`
    SELECT id, supplier_slug, job_type, status, progress_pct, progress_detail,
           started_at,
           EXTRACT(EPOCH FROM (now() - started_at))::int AS elapsed_sec
    FROM hub_sync_jobs
    WHERE status = 'RUNNING'
    ORDER BY started_at DESC
  `);
  return rows;
};
