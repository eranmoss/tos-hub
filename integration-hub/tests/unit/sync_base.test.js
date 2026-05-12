import { query, closePool } from '../../src/db/client.js';
import { runSync } from '../../src/sync/base-sync.js';

const SLUG = 'test-sync-supplier';

beforeAll(async () => {
  await query(`DELETE FROM hub_static_inventory WHERE supplier_slug = $1`, [SLUG]);
  await query(
    `INSERT INTO hub_suppliers(supplier_slug, name, categories, auth_type)
     VALUES ($1, 'Test Sync', ARRAY['EXPERIENCE'], 'API_KEY')
     ON CONFLICT (supplier_slug) DO NOTHING`,
    [SLUG]
  );
});

afterAll(async () => {
  await query(`DELETE FROM hub_static_inventory WHERE supplier_slug = $1`, [SLUG]);
  await query(`DELETE FROM hub_sync_errors WHERE sync_job_id IN (SELECT id FROM hub_sync_jobs WHERE supplier_slug = $1)`, [SLUG]);
  await query(`DELETE FROM hub_sync_jobs WHERE supplier_slug = $1`, [SLUG]);
  await closePool();
});

describe('Layer 2.5: sync base', () => {
  test('upserts records, soft-deletes stale, logs errors, marks job complete', async () => {
    // Seed one existing row that won't be returned in the next sync run
    await query(
      `INSERT INTO hub_static_inventory(supplier_slug, supplier_raw_ref, type, title, is_active)
       VALUES ($1, 'STALE-1', 'EXPERIENCE', 'Old', true)`,
      [SLUG]
    );

    const pages = [[
      { id: 'A1', title: 'Good A', duration_minutes: 60 },
      { id: null, title: 'Bad no id' }, // skipped silently by mapper
    ], [
      { id: 'A2', title: 'Good B', duration_minutes: 90 },
      { id: 'BOOM', title: 'Throws' },
    ]];
    const fetcher = async function* () {
      for (const records of pages) yield { records };
    };
    const mapper = (raw) => {
      if (raw.id === 'BOOM') throw new Error('mapper fail');
      if (!raw.id) return null;
      return {
        supplier_raw_ref: raw.id,
        type: 'EXPERIENCE',
        title: raw.title,
        duration_minutes: raw.duration_minutes,
      };
    };

    const res = await runSync({ supplierSlug: SLUG, fetcher, mapper });
    expect(res.upserted).toBe(2);
    expect(res.errored).toBe(1);
    expect(res.deactivated).toBe(1); // STALE-1

    const active = await query(
      `SELECT supplier_raw_ref, is_active FROM hub_static_inventory
       WHERE supplier_slug = $1 ORDER BY supplier_raw_ref`,
      [SLUG]
    );
    const map = Object.fromEntries(active.rows.map(r => [r.supplier_raw_ref, r.is_active]));
    expect(map['A1']).toBe(true);
    expect(map['A2']).toBe(true);
    expect(map['STALE-1']).toBe(false);

    const job = await query(
      `SELECT status, records_upserted, records_errored, records_deactivated
       FROM hub_sync_jobs WHERE supplier_slug = $1 ORDER BY started_at DESC LIMIT 1`,
      [SLUG]
    );
    expect(job.rows[0].status).toBe('COMPLETE');
    expect(job.rows[0].records_upserted).toBe(2);
    expect(job.rows[0].records_errored).toBe(1);

    const err = await query(
      `SELECT error_message FROM hub_sync_errors
       WHERE sync_job_id IN (SELECT id FROM hub_sync_jobs WHERE supplier_slug = $1)`,
      [SLUG]
    );
    expect(err.rows[0].error_message).toMatch(/mapper fail/);
  });
});
