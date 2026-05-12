import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, closePool } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

export const runMigrations = async () => {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const res = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1', [file]
    );
    if (res.rowCount > 0) {
      log('info', 'migration_skipped', { file });
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    log('info', 'migration_start', { file });
    await pool.query(sql);
    await pool.query(
      'INSERT INTO schema_migrations(filename) VALUES ($1)', [file]
    );
    log('info', 'migration_done', { file });
  }
};

const invokedDirectly = process.argv[1] && import.meta.url.replace(/\\/g, '/').endsWith(
  process.argv[1].replace(/\\/g, '/').split('/').slice(-3).join('/')
);
if (invokedDirectly) {
  runMigrations()
    .then(() => closePool())
    .then(() => { log('info', 'migrations_complete'); process.exit(0); })
    .catch(err => { log('error', 'migration_failed', { error: err.message }); process.exit(1); });
}
