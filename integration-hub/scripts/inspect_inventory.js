import 'dotenv/config';
import { query, closePool } from '../src/db/client.js';

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const hr = () => console.log('-'.repeat(100));
const h = (label) => { console.log('\n' + label); hr(); };

const runQuery = async (label, sql, params = []) => {
  h(label);
  const r = await query(sql, params);
  if (r.rows.length === 0) { console.log('(no rows)'); return r; }
  const cols = Object.keys(r.rows[0]);
  console.log(cols.map(c => pad(c, 20)).join(' '));
  for (const row of r.rows) {
    console.log(cols.map(c => pad(row[c], 20)).join(' '));
  }
  console.log(`(${r.rows.length} rows)`);
  return r;
};

const mode = process.argv[2] || 'summary';
const arg = process.argv[3];

const summary = async () => {
  await runQuery('Inventory totals by supplier + type',
    `SELECT supplier_slug, type, COUNT(*)::int AS total,
            SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int AS active
     FROM hub_static_inventory GROUP BY supplier_slug, type
     ORDER BY supplier_slug, type`);

  await runQuery('Last sync per supplier',
    `SELECT supplier_slug, status, records_fetched, records_upserted,
            records_deactivated, records_errored,
            to_char(started_at, 'YYYY-MM-DD HH24:MI') AS started
     FROM hub_sync_jobs
     WHERE (supplier_slug, started_at) IN (
       SELECT supplier_slug, MAX(started_at) FROM hub_sync_jobs GROUP BY supplier_slug
     ) ORDER BY supplier_slug`);

  await runQuery('Tenants + active suppliers',
    `SELECT t.tenant_id, t.tier,
            ARRAY_AGG(ts.supplier_slug ORDER BY ts.supplier_slug)
              FILTER (WHERE ts.is_active) AS suppliers
     FROM hub_tenants t
     LEFT JOIN hub_tenant_suppliers ts ON ts.tenant_id = t.tenant_id
     GROUP BY t.tenant_id, t.tier ORDER BY t.tenant_id`);

  await runQuery('Dedup pairs by decision (per tenant)',
    `SELECT tenant_id, decision, COUNT(*)::int AS n,
            ROUND(AVG(composite_score)::numeric, 3) AS avg_score
     FROM hub_dedup_pairs GROUP BY tenant_id, decision
     ORDER BY tenant_id, decision`);

  await runQuery('Recent transactions',
    `SELECT tenant_id, supplier_slug, operation, status, latency_ms,
            to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS at
     FROM hub_transactions ORDER BY created_at DESC LIMIT 10`);
};

const byType = async (type) => {
  await runQuery(`Inventory — type=${type}`,
    `SELECT supplier_slug, supplier_raw_ref, title, city, country,
            category, duration_minutes, star_rating, vehicle_class
     FROM hub_static_inventory
     WHERE type = $1 AND is_active = true
     ORDER BY supplier_slug, title LIMIT 50`, [type.toUpperCase()]);
};

const dedupPairs = async (tenantId) => {
  await runQuery(`Dedup pairs for tenant=${tenantId}`,
    `SELECT a.title AS title_a, a.supplier_slug AS sup_a,
            b.title AS title_b, b.supplier_slug AS sup_b,
            dp.decision, ROUND(dp.composite_score::numeric, 3) AS score
     FROM hub_dedup_pairs dp
     JOIN hub_static_inventory a ON a.id = dp.inventory_id_a
     JOIN hub_static_inventory b ON b.id = dp.inventory_id_b
     WHERE dp.tenant_id = $1
     ORDER BY dp.composite_score DESC LIMIT 50`, [tenantId]);
};

const pipeline = async (tenantId) => {
  // Simulate Stage 1 manually to verify what a search would return
  const lat = 41.3851, lng = 2.1734, radius = 10000;
  await runQuery(`Stage 1 simulation — EXPERIENCE within 10km of BCN for tenant=${tenantId}`,
    `SELECT si.supplier_slug, si.supplier_raw_ref, si.title,
            ROUND((6371000 * acos(LEAST(1, GREATEST(-1,
              cos(radians($3)) * cos(radians(si.latitude)) *
              cos(radians(si.longitude) - radians($4)) +
              sin(radians($3)) * sin(radians(si.latitude))
            ))))::numeric, 0) AS dist_m,
            dp.decision AS dedup
     FROM hub_static_inventory si
     LEFT JOIN hub_dedup_pairs dp
       ON dp.inventory_id_a = si.id AND dp.tenant_id = $1
     JOIN hub_tenant_suppliers ts ON ts.supplier_slug = si.supplier_slug
       AND ts.tenant_id = $1 AND ts.is_active = true
     WHERE si.type = 'EXPERIENCE' AND si.is_active = true
       AND (6371000 * acos(LEAST(1, GREATEST(-1,
         cos(radians($3)) * cos(radians(si.latitude)) *
         cos(radians(si.longitude) - radians($4)) +
         sin(radians($3)) * sin(radians(si.latitude))
       )))) <= $5
     ORDER BY dist_m LIMIT 50`,
    [tenantId, null, lat, lng, radius]);
};

const help = () => console.log(`
Usage: node scripts/inspect_inventory.js <mode> [arg]

  summary                  totals, sync jobs, tenants, dedup, transactions
  type <HOTEL|EXPERIENCE|TRANSFER>
  dedup <tenant_id>        confirmed/uncertain pairs with titles
  pipeline <tenant_id>     Stage 1 simulation around Barcelona
`);

const main = async () => {
  if (mode === 'summary') await summary();
  else if (mode === 'type' && arg) await byType(arg);
  else if (mode === 'dedup' && arg) await dedupPairs(arg);
  else if (mode === 'pipeline' && arg) await pipeline(arg);
  else help();
};

main().then(() => closePool()).then(() => process.exit(0))
  .catch(e => { console.error(e.message); process.exit(1); });
