# Claude Code prompt — Bridgify dedup experiment import

Open Claude Code in `integration_hub/` and paste the prompt below.
It runs the import in stages with a stop point between each — so you can
verify before the 30-60 minute full pull and before any multi-hour
embedding/dedup work.

---

## Paste this into Claude Code:

```
I'm running the Bridgify dedup experiment described in
`scripts/bridgify_import/README.md`. Read that README first for context,
then execute the steps below. STOP for my confirmation between each
stage. Do not proceed past a stop point without my explicit go-ahead.

If anything errors, stop immediately, show me the error, and do not try
to fix it without asking.

────────────────────────────────────────────────────────────────────────
STAGE 1 — Environment validation (no DB calls)
────────────────────────────────────────────────────────────────────────

1. Confirm `.env` exists in `integration_hub/` and has both:
   - `DATABASE_URL` (the hub DB)
   - Either `BRIDGIFY_DATABASE_URL` (filled in, not the placeholder) or
     all of `BRIDGIFY_DB_HOST`, `BRIDGIFY_DB_PORT`, `BRIDGIFY_DB_NAME`,
     `BRIDGIFY_DB_USER`, `BRIDGIFY_DB_PASSWORD`
   Just check that values are present — do not print credentials.

2. Verify `csv-parse` and `pg` are listed in `package.json`. If
   `csv-parse` is missing and you'd like to use the CSV path, run
   `npm install csv-parse`. The direct path (02b) only needs `pg`,
   which is already used elsewhere in the project.

3. Do NOT run anything against any DB yet. Report:
   - Which Bridgify env mode is in use (URL or discrete fields)
   - Confirmation that hub `DATABASE_URL` is set
   - Any missing dependencies

STOP. Wait for me to say "proceed."

────────────────────────────────────────────────────────────────────────
STAGE 2 — Seed suppliers + Bridgify connectivity probe
────────────────────────────────────────────────────────────────────────

1. Run `node scripts/bridgify_import/01_seed_suppliers.js` and capture
   the output.

2. Verify the 7 supplier rows now exist by querying:
     SELECT supplier_slug, name, auth_type FROM hub_suppliers
     WHERE auth_type = 'BRIDGIFY_DB' ORDER BY supplier_slug;
   Show me the result.

3. Probe Bridgify connection with no writes:
     node scripts/bridgify_import/02b_import_direct.js \
       --supplier viator --limit 5 --dry-run
   Show me the output.

STOP. Report results. Wait for "proceed."

────────────────────────────────────────────────────────────────────────
STAGE 3 — Smoke test with real writes (5 rows)
────────────────────────────────────────────────────────────────────────

1. Run:
     node scripts/bridgify_import/02b_import_direct.js \
       --supplier viator --limit 5

2. Show me the imported rows:
     SELECT supplier_slug, supplier_raw_ref, title, latitude, longitude,
            city, country, category, duration_minutes
       FROM hub_static_inventory
      WHERE supplier_slug = 'viator'
      ORDER BY created_at DESC
      LIMIT 5;

3. Verify each row has:
   - non-null latitude/longitude (real numbers, not 0)
   - non-null city
   - sensible duration_minutes (or null is fine)
   - real-looking title text

STOP. Show me the rows. Wait for "proceed."

────────────────────────────────────────────────────────────────────────
STAGE 4 — Single-city run (Barcelona, all 7 suppliers)
────────────────────────────────────────────────────────────────────────

1. Run:
     node scripts/bridgify_import/02b_import_direct.js --city Barcelona

2. After it completes, show me per-supplier counts for Barcelona:
     SELECT supplier_slug, COUNT(*)::int AS records,
            COUNT(DISTINCT supplier_raw_ref)::int AS unique_refs
       FROM hub_static_inventory
      WHERE city ILIKE 'barcelona'
        AND supplier_slug = ANY(ARRAY['viator','getyourguide','tiqets',
                                      'hotelbeds','attractionworld',
                                      'bookitfun','tillo'])
      GROUP BY supplier_slug
      ORDER BY records DESC;

3. Sanity-check: Viator should dominate by volume, GetYourGuide and
   Tiqets should have meaningful presence, others smaller.

STOP. Report the per-supplier numbers. Wait for "proceed."

────────────────────────────────────────────────────────────────────────
STAGE 5 — Full import (~555K rows, 30-60 minutes)
────────────────────────────────────────────────────────────────────────

DO NOT start this stage until I explicitly say "go full."

When I say "go full":
1. Create `logs/` dir if it doesn't exist.
2. Run with output to a log file you can tail:
     mkdir -p logs
     node scripts/bridgify_import/02b_import_direct.js \
       2>&1 | tee logs/bridgify_import_full.log

3. While it runs, periodically (every few minutes) report progress —
   read the latest log lines and summarize fetched/upserted counts
   and rate.

4. On completion, show me:
   - Total runtime
   - The `hub_summary` log line (per-supplier counts)
   - Any errors that appeared in the log

STOP. Wait for further instructions.

────────────────────────────────────────────────────────────────────────
DO NOT RUN WITHOUT EXPLICIT INSTRUCTION
────────────────────────────────────────────────────────────────────────

The following are multi-hour CPU jobs. Do not start them just because
the import completes successfully — wait for me to ask:

- node src/sync/build-embeddings.js EXPERIENCE     (~3 hours)
- node src/sync/dedup-precompute.js                (30-60 min + LLM cost)

When I do ask, run them similarly with logging to files in `logs/`,
and report progress periodically.

────────────────────────────────────────────────────────────────────────
GROUND RULES
────────────────────────────────────────────────────────────────────────

- Never write or modify files in `scripts/bridgify_import/` — those are
  the runbook artifacts and shouldn't drift during execution.
- Never echo credentials from `.env` into output.
- If you discover something the runbook doesn't cover (schema mismatch,
  missing column, weird data), stop and tell me — don't try to patch
  the SQL or scripts on the fly.
- Time every stage so we have actual numbers for the proposal report.
```

---

## Stop points summary

| Stage | What's verified | Time |
|---|---|---|
| 1 | env + deps | seconds |
| 2 | seed + Bridgify connectivity | seconds |
| 3 | end-to-end write of 5 rows | seconds |
| 4 | full pipeline on 1 city | 1-3 minutes |
| 5 | full 555K row import | 30-60 minutes |
| Embed | (manual) embedding all rows | ~3 hours |
| Dedup | (manual) cluster computation | 30-60 min + ~$30-50 LLM |

Each stop point gives you a chance to abort cheaply if something looks
wrong — far cheaper than discovering a translation bug 25 minutes into
the full import.

## After the import completes

Once Stage 5 reports `import_complete`, your dataset is staged in
`hub_static_inventory` and you can continue in Claude Code (or wherever)
with:

```
The Bridgify import is complete. Run the embedding pipeline on the new
EXPERIENCE rows. Stream output to logs/embeddings.log. Report progress
every 10 minutes. Stop after completion.
```

Then later:

```
Embeddings done. Run dedup-precompute.js. Stream output to
logs/dedup.log. Report progress every 5 minutes and the final cluster
summary at the end.
```

Keep each phase as its own ask — each is hours of work and you want
clear stop points for review.
