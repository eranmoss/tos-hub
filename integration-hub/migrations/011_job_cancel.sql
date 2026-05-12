-- 011: Allow CANCELLED status for jobs stopped by users
ALTER TABLE hub_sync_jobs DROP CONSTRAINT IF EXISTS hub_sync_jobs_status_check;
ALTER TABLE hub_sync_jobs ADD CONSTRAINT hub_sync_jobs_status_check
  CHECK (status IN ('RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED'));
