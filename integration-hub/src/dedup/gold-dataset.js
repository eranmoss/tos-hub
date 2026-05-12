import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/client.js';
import { normalize, fuzzyScore, cosine, decide } from '../sync/dedup-precompute.js';
import { loadDedupConfig } from './config.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const BAND_CONFIG = {
  high_dup:        { simMin: 0.90, simMax: 1.00, pct: 0.20 },
  medium_dup:      { simMin: 0.85, simMax: 0.90, pct: 0.20 },
  borderline:      { simMin: 0.70, simMax: 0.85, pct: 0.25 },
  near_miss:       { simMin: 0.60, simMax: 0.70, pct: 0.20 },
  clear_distinct:  { simMin: 0.00, simMax: 0.40, pct: 0.15 },
};

const TARGET_TOTAL = 200;

export const sampleGoldPairs = async () => {
  const existing = (await query(`SELECT COUNT(*)::int AS cnt FROM hub_dedup_gold_pairs`)).rows[0].cnt;
  if (existing > 0) {
    return { sampled: 0, existing, message: 'Gold pairs already exist. Delete first to re-sample.' };
  }

  let totalSampled = 0;
  const seen = new Set();

  for (const [band, cfg] of Object.entries(BAND_CONFIG)) {
    const target = Math.round(TARGET_TOTAL * cfg.pct);
    const collected = [];

    if (band === 'clear_distinct') {
      // Pick random anchors from one supplier, find cross-city partner from another
      const { rows: anchors } = await query(`
        SELECT id, embedding, city, supplier_slug
        FROM hub_static_inventory
        WHERE is_active AND type = 'EXPERIENCE' AND embedding IS NOT NULL
        ORDER BY random() LIMIT $1
      `, [target * 3]);

      for (const anchor of anchors) {
        if (collected.length >= target) break;
        const { rows: [match] } = await query(`
          SELECT id, 1 - (embedding <=> $1) AS emb_sim
          FROM hub_static_inventory
          WHERE is_active AND type = 'EXPERIENCE' AND embedding IS NOT NULL
            AND supplier_slug != $2 AND LOWER(TRIM(city)) != LOWER(TRIM($3))
          ORDER BY random() LIMIT 1
        `, [anchor.embedding, anchor.supplier_slug, anchor.city]);

        if (!match) continue;
        const key = anchor.id < match.id ? `${anchor.id}:${match.id}` : `${match.id}:${anchor.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [idA, idB] = anchor.id < match.id ? [anchor.id, match.id] : [match.id, anchor.id];
        collected.push({ id_a: idA, id_b: idB, emb_sim: parseFloat(match.emb_sim) });
      }
    } else {
      // KNN approach: pick random anchors, find neighbors in target similarity band
      const multiplier = cfg.simMin >= 0.85 ? 20 : 5;
      const { rows: anchors } = await query(`
        SELECT id, embedding, city, supplier_slug
        FROM hub_static_inventory
        WHERE is_active AND type = 'EXPERIENCE' AND embedding IS NOT NULL
        ORDER BY random() LIMIT $1
      `, [target * multiplier]);

      for (const anchor of anchors) {
        if (collected.length >= target) break;
        // Find KNN neighbors and filter to the target similarity band
        const { rows: neighbors } = await query(`
          SELECT id, 1 - (embedding <=> $1) AS emb_sim
          FROM hub_static_inventory
          WHERE is_active AND type = 'EXPERIENCE' AND embedding IS NOT NULL
            AND id != $2 AND supplier_slug != $3
            AND LOWER(TRIM(city)) = LOWER(TRIM($4))
          ORDER BY embedding <=> $1
          LIMIT 20
        `, [anchor.embedding, anchor.id, anchor.supplier_slug, anchor.city]);

        for (const nb of neighbors) {
          if (collected.length >= target) break;
          const sim = parseFloat(nb.emb_sim);
          if (sim < cfg.simMin || sim >= cfg.simMax) continue;
          const key = anchor.id < nb.id ? `${anchor.id}:${nb.id}` : `${nb.id}:${anchor.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const [idA, idB] = anchor.id < nb.id ? [anchor.id, nb.id] : [nb.id, anchor.id];
          collected.push({ id_a: idA, id_b: idB, emb_sim: sim });
          break; // one pair per anchor to ensure diversity
        }
      }
    }

    for (const row of collected) {
      await query(`
        INSERT INTO hub_dedup_gold_pairs (id_a, id_b, band, emb_sim)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id_a, id_b) DO NOTHING
      `, [row.id_a, row.id_b, band, row.emb_sim]);
    }

    totalSampled += collected.length;
    log('info', 'gold_sample_band', { band, target, sampled: collected.length });
  }

  log('info', 'gold_sample_complete', { total: totalSampled });
  return { sampled: totalSampled, existing: 0 };
};

const LLM_MODEL = 'claude-haiku-4-5-20251001';
const LABEL_BATCH = 10;

const buildLabelPrompt = (pairs) => {
  const lines = pairs.map((p, i) =>
    `${i+1}. A: "${p.title_a}" (${p.supplier_a}, ${p.cat_a || 'n/a'}, $${p.price_a || '?'}, ${p.dur_a || '?'}min)\n` +
    `   B: "${p.title_b}" (${p.supplier_b}, ${p.cat_b || 'n/a'}, $${p.price_b || '?'}, ${p.dur_b || '?'}min)\n` +
    `   City: ${p.city_a} | Embedding Sim: ${p.emb_sim?.toFixed(3)}`
  ).join('\n\n');

  return `You are labeling a gold dataset for evaluating a travel product dedup engine. For each pair, decide the GROUND TRUTH: are these the same real-world experience?

DUPLICATE = a traveler buying both would do the same activity twice.
DISTINCT = different activities, even if related (e.g. walking tour vs bike tour, 2h vs 6h, morning vs sunset).

Be precise. This is a benchmark — errors compound into misleading precision/recall numbers.

${lines}

Respond with JSON array:
[{"pair":1,"label":"DUPLICATE"|"DISTINCT","reason":"<10 words>"},...]

Return ONLY the JSON array.`;
};

export const labelGoldPairs = async ({ onProgress } = {}) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'ANTHROPIC_API_KEY not set' };
  }

  const { rows: unlabeled } = await query(`
    SELECT g.id, g.id_a, g.id_b, g.band, g.emb_sim,
           a.title AS title_a, b.title AS title_b,
           a.supplier_slug AS supplier_a, b.supplier_slug AS supplier_b,
           a.category AS cat_a, b.category AS cat_b,
           a.city AS city_a, b.city AS city_b,
           a.price_from AS price_a, b.price_from AS price_b,
           a.duration_minutes AS dur_a, b.duration_minutes AS dur_b
    FROM hub_dedup_gold_pairs g
    JOIN hub_static_inventory a ON a.id = g.id_a
    JOIN hub_static_inventory b ON b.id = g.id_b
    WHERE g.label IS NULL
    ORDER BY g.band, g.emb_sim DESC
  `);

  if (unlabeled.length === 0) {
    return { labeled: 0, message: 'All pairs already labeled.' };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let totalLabeled = 0;
  let totalCost = 0;

  for (let i = 0; i < unlabeled.length; i += LABEL_BATCH) {
    const batch = unlabeled.slice(i, i + LABEL_BATCH);

    try {
      const resp = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildLabelPrompt(batch) }],
      });

      const inp = resp.usage?.input_tokens || 0;
      const out = resp.usage?.output_tokens || 0;
      totalCost += (inp / 1e6) * 0.80 + (out / 1e6) * 4.00;

      const text = resp.content[0]?.text || '[]';
      const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      for (let k = 0; k < batch.length; k++) {
        const llm = parsed[k];
        if (!llm) continue;
        const label = llm.label === 'DUPLICATE' ? 'DUPLICATE' : 'DISTINCT';
        await query(`
          UPDATE hub_dedup_gold_pairs
          SET label = $1, label_source = 'llm', label_reason = $2, labeled_at = now()
          WHERE id = $3
        `, [label, llm.reason || '', batch[k].id]);
        totalLabeled++;
      }
    } catch (e) {
      log('warn', 'gold_label_batch_error', { batch_start: i, error: e.message });
    }

    if (onProgress) {
      const pct = Math.round(Math.min(i + LABEL_BATCH, unlabeled.length) / unlabeled.length * 100);
      await onProgress(pct, { labeled: totalLabeled, remaining: unlabeled.length - totalLabeled }).catch(() => {});
    }
  }

  log('info', 'gold_label_complete', { labeled: totalLabeled, cost_usd: totalCost.toFixed(4) });
  return { labeled: totalLabeled, cost_usd: parseFloat(totalCost.toFixed(4)) };
};

export const evalGoldDataset = async (thresholdOverrides = {}) => {
  const { rows: pairs } = await query(`
    SELECT g.id, g.id_a, g.id_b, g.band, g.emb_sim, g.label,
           a.title AS title_a, b.title AS title_b,
           a.supplier_slug AS supplier_a, b.supplier_slug AS supplier_b,
           a.category AS cat_a, b.category AS cat_b,
           a.price_from AS price_a, b.price_from AS price_b,
           a.duration_minutes AS dur_a, b.duration_minutes AS dur_b,
           a.embedding AS emb_a, b.embedding AS emb_b
    FROM hub_dedup_gold_pairs g
    JOIN hub_static_inventory a ON a.id = g.id_a
    JOIN hub_static_inventory b ON b.id = g.id_b
    WHERE g.label IS NOT NULL
  `);

  if (pairs.length === 0) {
    return { error: 'No labeled pairs found. Run labeling first.' };
  }

  const cfg = await loadDedupConfig('t_demo');
  const dupThresh = thresholdOverrides.duplicate ?? cfg.thresholds?.embedding_duplicate ?? 0.85;
  const uncThresh = thresholdOverrides.uncertain ?? cfg.thresholds?.embedding_uncertain ?? 0.70;

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const perBand = {};
  const mismatches = [];

  for (const p of pairs) {
    const a = {
      id: p.id_a, title: p.title_a, supplier_slug: p.supplier_a,
      category: p.cat_a, duration_minutes: p.dur_a, price_from: p.price_a,
    };
    const b = {
      id: p.id_b, title: p.title_b, supplier_slug: p.supplier_b,
      category: p.cat_b, duration_minutes: p.dur_b, price_from: p.price_b,
    };

    const normA = normalize(a.title);
    const normB = normalize(b.title);
    const fSim = fuzzyScore(normA, normB);
    const { decision } = decide(p.emb_sim, fSim, a, b, { duplicate: dupThresh, uncertain: uncThresh });

    // Engine says DUPLICATE or UNCERTAIN→treat as DUPLICATE for recall purposes
    const predicted = decision === 'DUPLICATE' ? 'DUPLICATE' : 'DISTINCT';
    const actual = p.label;

    if (!perBand[p.band]) perBand[p.band] = { tp: 0, fp: 0, tn: 0, fn: 0, total: 0 };
    perBand[p.band].total++;

    if (predicted === 'DUPLICATE' && actual === 'DUPLICATE') { tp++; perBand[p.band].tp++; }
    else if (predicted === 'DUPLICATE' && actual === 'DISTINCT') {
      fp++; perBand[p.band].fp++;
      mismatches.push({ id: p.id, band: p.band, predicted, actual, title_a: p.title_a, title_b: p.title_b, emb_sim: p.emb_sim });
    }
    else if (predicted === 'DISTINCT' && actual === 'DISTINCT') { tn++; perBand[p.band].tn++; }
    else if (predicted === 'DISTINCT' && actual === 'DUPLICATE') {
      fn++; perBand[p.band].fn++;
      mismatches.push({ id: p.id, band: p.band, predicted, actual, title_a: p.title_a, title_b: p.title_b, emb_sim: p.emb_sim });
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  // Compute per-band P/R/F1
  for (const band of Object.values(perBand)) {
    band.precision = band.tp + band.fp > 0 ? band.tp / (band.tp + band.fp) : null;
    band.recall = band.tp + band.fn > 0 ? band.tp / (band.tp + band.fn) : null;
    band.f1 = band.precision != null && band.recall != null && band.precision + band.recall > 0
      ? 2 * band.precision * band.recall / (band.precision + band.recall) : null;
  }

  const configSnapshot = {
    duplicate_threshold: dupThresh,
    uncertain_threshold: uncThresh,
    ...thresholdOverrides,
  };

  await query(`
    INSERT INTO hub_dedup_eval_runs
      (config_snapshot, total_pairs, true_positives, false_positives, true_negatives, false_negatives,
       precision_val, recall_val, f1_val, per_band)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    JSON.stringify(configSnapshot), pairs.length,
    tp, fp, tn, fn,
    precision, recall, f1,
    JSON.stringify(perBand),
  ]);

  log('info', 'gold_eval_complete', {
    total: pairs.length, tp, fp, tn, fn,
    precision: precision.toFixed(3), recall: recall.toFixed(3), f1: f1.toFixed(3),
  });

  return {
    total_pairs: pairs.length,
    tp, fp, tn, fn,
    precision: parseFloat(precision.toFixed(4)),
    recall: parseFloat(recall.toFixed(4)),
    f1: parseFloat(f1.toFixed(4)),
    per_band: perBand,
    mismatches: mismatches.slice(0, 20),
    config: configSnapshot,
  };
};

export const getGoldDataset = async () => {
  const [summary, pairs, runs] = await Promise.all([
    query(`
      SELECT COUNT(*)::int AS total,
             COUNT(label)::int AS labeled,
             COUNT(*) FILTER (WHERE label = 'DUPLICATE')::int AS label_dup,
             COUNT(*) FILTER (WHERE label = 'DISTINCT')::int AS label_dist
      FROM hub_dedup_gold_pairs
    `),
    query(`
      SELECT g.id, g.band, g.emb_sim, g.label, g.label_source, g.label_reason,
             a.title AS title_a, b.title AS title_b,
             a.supplier_slug AS supplier_a, b.supplier_slug AS supplier_b,
             a.city AS city_a, a.category AS cat_a, b.category AS cat_b,
             a.price_from AS price_a, b.price_from AS price_b,
             a.duration_minutes AS dur_a, b.duration_minutes AS dur_b
      FROM hub_dedup_gold_pairs g
      JOIN hub_static_inventory a ON a.id = g.id_a
      JOIN hub_static_inventory b ON b.id = g.id_b
      ORDER BY g.band, g.emb_sim DESC
    `),
    query(`
      SELECT id, config_snapshot, total_pairs, true_positives, false_positives,
             true_negatives, false_negatives, precision_val, recall_val, f1_val,
             per_band, notes, created_at
      FROM hub_dedup_eval_runs
      ORDER BY created_at DESC
      LIMIT 20
    `),
  ]);

  const bandSummary = {};
  for (const p of pairs.rows) {
    if (!bandSummary[p.band]) bandSummary[p.band] = { total: 0, labeled: 0, dup: 0, dist: 0 };
    bandSummary[p.band].total++;
    if (p.label) {
      bandSummary[p.band].labeled++;
      if (p.label === 'DUPLICATE') bandSummary[p.band].dup++;
      else bandSummary[p.band].dist++;
    }
  }

  return {
    summary: summary.rows[0],
    band_summary: bandSummary,
    pairs: pairs.rows,
    eval_runs: runs.rows,
  };
};
