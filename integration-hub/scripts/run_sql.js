import 'dotenv/config';
import fs from 'fs';
import { getPool, closePool } from '../src/db/client.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/run_sql.js <file1.sql> [file2.sql] ...');
  process.exit(1);
}

const pool = getPool();
for (const file of files) {
  const sql = fs.readFileSync(file, 'utf-8');
  console.log(`--- Running ${file} ---`);
  try {
    const res = await pool.query(sql);
    const tag = Array.isArray(res) ? res.map(r => r.command + ' ' + (r.rowCount ?? '')).join(', ') : (res.command + ' ' + (res.rowCount ?? ''));
    console.log(`  OK: ${tag}`);
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    process.exit(1);
  }
}
await closePool();
console.log('Done.');
