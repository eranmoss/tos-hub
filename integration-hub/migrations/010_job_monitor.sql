-- 010: Extend hub_sync_jobs for all background job types + live progress

ALTER TABLE hub_sync_jobs ADD COLUMN IF NOT EXISTS job_type VARCHAR DEFAULT 'sync';
ALTER TABLE hub_sync_jobs ADD COLUMN IF NOT EXISTS progress_pct INTEGER;
ALTER TABLE hub_sync_jobs ADD COLUMN IF NOT EXISTS progress_detail JSONB;

CREATE INDEX IF NOT EXISTS idx_sync_jobs_type_status ON hub_sync_jobs (job_type, status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_started ON hub_sync_jobs (started_at DESC);
