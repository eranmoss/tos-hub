import 'dotenv/config';
import { query } from './src/db/client.js';
const r = await query(`
  SELECT id, job_type, status, progress_pct, progress_detail, started_at,
         EXTRACT(EPOCH FROM (now() - started_at))::int AS elapsed_sec
  FROM hub_sync_jobs
  WHERE job_type = 'attraction_cluster' AND status = 'RUNNING'
  ORDER BY started_at DESC LIMIT 3
`);
console.table(r.rows);
if (r.rows[0]?.progress_detail) {
  console.log('\nProgress detail:', JSON.stringify(JSON.parse(r.rows[0].progress_detail), null, 2));
}
process.exit();
