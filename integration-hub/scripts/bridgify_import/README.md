# Bridgify Dedup Experiment — Runbook

One-time import of Bridgify's active experience inventory into
`hub_static_inventory` for a dedup engine validation run at scale.

**Goal:** validate the integration_hub dedup engine against ~555K records
across 7 Bridgify suppliers, produce cluster-quality numbers for the
architecture proposal.

**Scope:** experience-style products only. Event suppliers (StubHub,
SportsEvents365, Ticketero, LiveTickets) are excluded — events have
different identity rules than experiences and warrant a separate dedup
algorithm with date/team-aware differentiators.

## Suppliers Included

7 active suppliers with description coverage ≥98% on experience products:

| Supplier         | Active records (approx) |
|------------------|-------------------------|
| Viator           | 381,755                 |
| GetYourGuide     | 149,970                 |
| Ticketero        | excluded — events       |
| Tiqets           | 11,695                  |
| HotelBeds        | 9,316                   |
| AttractionWorld  | 1,608                   |
| Tillo            | 199                     |
| BookitFun        | 168                     |
| **Total**        | **~555K**               |

## Prerequisites

- Read access to Bridgify's Postgres (DBeaver or similar)
- Local hub DB up and migrated (your usual `integration_hub` dev DB)
- `csv-parse` installed: `npm install csv-parse` (if not already present)
- Disk space for the CSV: ~1-2 GB

## Steps

### 1. Smoke-test the translation query

In DBeaver against Bridgify, open `translation_query.sql`. Append `LIMIT 5;`
to the end and run it. Confirm:

- 5 rows returned
- `latitude` and `longitude` are real numbers (not 0 or null)
- `category` has values
- `duration_minutes` is sensible (10s to 100s)
- `raw_content` is well-formed JSON

If anything looks wrong, fix the SQL before exporting.

### 2. Export the full translated dataset to CSV

Remove the `LIMIT` from `translation_query.sql`. Run it.

When the result grid finishes loading (~2-5 minutes for 555K rows):
- Right-click the result grid → **Export Data** → **CSV**
- Set the output path (e.g., `~/bridgify_translated.csv`)
- Use UTF-8 encoding, comma delimiter, header row included

Expect ~1-2 GB CSV, ~5-10 minutes to write.

### 3. Seed the supplier rows in your hub DB

```bash
cd integration_hub
node scripts/bridgify_import/01_seed_suppliers.js
```

Idempotent — safe to re-run. Inserts rows in `hub_suppliers` for the 7
included suppliers, with `auth_type = 'BRIDGIFY_DB'` (signals these
aren't API-synced).

### 4. Smoke-test the importer with a small slice

```bash
node scripts/bridgify_import/02_import_csv.js \
  ~/bridgify_translated.csv \
  --limit 100
```

Should complete in seconds. Check the `post_import_summary` log line —
it shows per-supplier counts in `hub_static_inventory`. Verify the rows
look sensible by spot-checking the DB:

```sql
SELECT supplier_slug, title, latitude, longitude, category, duration_minutes
FROM hub_static_inventory
WHERE supplier_slug = ANY(ARRAY['viator','getyourguide','tiqets'])
ORDER BY supplier_slug, title
LIMIT 20;
```

If rows look right, proceed.

### 5. Full import

```bash
node scripts/bridgify_import/02_import_csv.js ~/bridgify_translated.csv
```

Expected runtime: **15-30 minutes** for 555K rows on a reasonable laptop.
Progress logs every 10K rows include `rate_per_sec` for ETA estimation.

### 6. Generate embeddings

The existing `build-embeddings.js` script reads `WHERE embedding IS NULL`,
so it'll embed only the new Bridgify rows.

```bash
node src/sync/build-embeddings.js EXPERIENCE
```

Expected runtime: **~3 hours** of CPU for ~550K MiniLM embeddings.

### 7. Run dedup

```bash
node src/sync/dedup-precompute.js
```

(Or whatever your standard invocation is — adjust per your existing
dedup runbook.)

Expected runtime: **30-60 minutes** for pairwise + clustering.

LLM judge cost at this scale, with default thresholds:
- ~$30-50 in Anthropic Haiku calls
- Set `_llm_max_pairs` per city tighter on the first run if you want a cap

### 8. Generate the report

After dedup completes, the cluster-quality report is the deliverable for
the architecture proposal. Run whatever reporting you have, plus:

```sql
-- Cross-supplier cluster summary
SELECT
  COUNT(DISTINCT canonical_id) AS clusters,
  COUNT(*) AS records,
  ROUND(100.0 * (COUNT(*) - COUNT(DISTINCT canonical_id)) / COUNT(*), 1) AS dup_rate_pct
FROM hub_static_inventory
WHERE supplier_slug = ANY(ARRAY['viator','getyourguide','tiqets','hotelbeds','attractionworld','bookitfun','tillo']);

-- Top 20 cities by inventory
SELECT city, COUNT(*) AS records, COUNT(DISTINCT canonical_id) AS clusters
FROM hub_static_inventory
WHERE supplier_slug = ANY(ARRAY['viator','getyourguide','tiqets','hotelbeds','attractionworld','bookitfun','tillo'])
  AND city IS NOT NULL
GROUP BY city
ORDER BY records DESC
LIMIT 20;
```

Save the output. It becomes the appendix to `docs/PROPOSED_ARCHITECTURE.docx`.

## Cleanup (after the experiment)

The imported Bridgify rows aren't needed for the integration_hub product
day-to-day — they're experiment data. Once the report is captured:

```sql
-- Optional cleanup
DELETE FROM hub_static_inventory
WHERE supplier_slug = ANY(ARRAY['viator','getyourguide','tiqets','hotelbeds','attractionworld','bookitfun','tillo'])
  AND raw_content->>'bridgify_uuid' IS NOT NULL;

DELETE FROM hub_suppliers WHERE auth_type = 'BRIDGIFY_DB';
```

Or leave it — it's useful as a pre-staged dataset if you re-run dedup
with different thresholds during proposal review.

## Future Work (out of scope here)

- Event-specific dedup algorithm with date/team/venue differentiators —
  separate experiment, separate report.
- Real ongoing sync (not one-time import) — Phase 1 of the proposal.
- Embedding backfill strategy when the model is upgraded.
- Translation layer as a service (not a SQL query) — Phase 1 design call.

## Files

- `translation_query.sql` — run on Bridgify in DBeaver; export result as CSV (Path A)
- `01_seed_suppliers.js`  — seed 7 supplier rows in `hub_suppliers`
- `02_import_csv.js`      — bulk upsert CSV into `hub_static_inventory` (Path A)
- `02b_import_direct.js`  — direct DB-to-DB import, no CSV intermediate (Path B)
- `README.md`             — this file

## Two Paths

You can run the import in either of two modes — pick whichever fits.

### Path A — CSV via DBeaver

1. Run `translation_query.sql` in DBeaver against Bridgify
2. Export result grid as CSV
3. Run `01_seed_suppliers.js`
4. Run `02_import_csv.js <csv-path>`

Pros: production access stays human-driven (clear audit trail in DBeaver).
Cons: more steps, intermediate CSV file, manual export.

### Path B — Direct DB-to-DB

1. Set `BRIDGIFY_DATABASE_URL` (or `BRIDGIFY_DB_HOST/PORT/NAME/USER/PASSWORD`) in `.env`
2. Run `01_seed_suppliers.js`
3. Run `02b_import_direct.js`

Pros: one command, no CSV step, faster end-to-end.
Cons: requires Bridgify credentials in `.env` (don't commit this file).

The `02b_import_direct.js` script supports flags for staged testing:

```bash
# Smoke test — 5 rows from one supplier
node scripts/bridgify_import/02b_import_direct.js --supplier viator --limit 5 --dry-run

# Single city — all 7 suppliers, just Barcelona
node scripts/bridgify_import/02b_import_direct.js --city Barcelona

# Full run
node scripts/bridgify_import/02b_import_direct.js
```

Progress is logged every batch (`fetched`, `upserted`, `rate_per_sec`).
Job-level tracking is recorded in `hub_sync_jobs` for visibility.

Re-running is safe — `ON CONFLICT (supplier_slug, supplier_raw_ref) DO UPDATE`
makes re-imports idempotent. If the script dies halfway, just re-run.
