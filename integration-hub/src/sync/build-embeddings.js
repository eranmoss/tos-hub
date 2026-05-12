import 'dotenv/config';
import { pipeline } from '@xenova/transformers';
import { query } from '../db/client.js';

const BATCH_SIZE = 50;

const buildInput = (row) => {
  const parts = [row.title];
  if (row.city) parts.push(row.city);
  if (row.country) parts.push(row.country);
  if (row.category) parts.push(row.category);
  if (row.route_origin) parts.push('airport transfer ' + row.route_origin);
  if (row.description) parts.push(row.description.slice(0, 200));
  return parts.join(' | ');
};

export const buildEmbeddings = async ({ type = 'EXPERIENCE', onProgress } = {}) => {
  console.log(`Building embeddings for type=${type}`);

  console.log('Loading MiniLM-L6-v2...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Model loaded');

  const { rows: [{ cnt }] } = await query(
    `SELECT COUNT(*)::int AS cnt FROM hub_static_inventory WHERE type = $1 AND is_active = true AND embedding IS NULL`,
    [type],
  );
  console.log(`${cnt} records need embeddings`);
  if (cnt === 0) return { type, processed: 0, total: 0 };

  let processed = 0;
  while (true) {
    const { rows } = await query(
      `SELECT id, title, city, country, category, route_origin, description
       FROM hub_static_inventory
       WHERE type = $1 AND is_active = true AND embedding IS NULL
       LIMIT $2`,
      [type, BATCH_SIZE],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const input = buildInput(row);
      const output = await embedder(input, { pooling: 'mean', normalize: true });
      const vec = Array.from(output.data);

      await query(
        `UPDATE hub_static_inventory SET embedding = $1 WHERE id = $2`,
        [`[${vec.join(',')}]`, row.id],
      );

      processed++;
      if (processed % 100 === 0) {
        const pct = Math.round((processed / cnt) * 100);
        console.log(`${processed}/${cnt} (${pct}%) — last: ${row.title.slice(0, 50)}`);
        if (onProgress) onProgress(pct, { processed, total: cnt, last_title: row.title.slice(0, 50) });
      }
    }
  }

  if (onProgress) onProgress(100, { processed, total: cnt });
  console.log(`Done — ${processed} embeddings stored for ${type}`);
  return { type, processed, total: cnt };
};

// CLI entrypoint
const isCLI = process.argv[1]?.endsWith('build-embeddings.js');
if (isCLI) {
  const type = process.argv[2] || 'EXPERIENCE';
  buildEmbeddings({ type }).catch(err => { console.error(err); process.exit(1); });
}
