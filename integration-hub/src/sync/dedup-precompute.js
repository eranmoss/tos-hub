import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';
import { query } from '../db/client.js';
import Fuse from 'fuse.js';
import { loadDedupConfig } from '../dedup/config.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const CITY_CONCURRENCY = 4;
const KNN_CONCURRENCY = 10;
const IVFFLAT_PROBES = 16;

let dedupPool = null;
const getDedupPool = () => {
  if (!dedupPool) {
    dedupPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 60000,
    });
  }
  return dedupPool;
};
const dedupQuery = (text, params) => getDedupPool().query(text, params);

let llmClient = null;
const getLLMClient = () => {
  if (!llmClient) llmClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return llmClient;
};

const STOP_WORDS = new Set([
  'tour', 'experience', 'visit', 'skip', 'the', 'a', 'an', 'in', 'of', 'and',
  'with', 'from', 'for', 'to', 'by', 'at', 'on', 'or',
  'line', 'access', 'priority', 'guided', 'private', 'group', 'day',
  'half', 'full', 'ticket', 'trip', 'excursion', 'entry', 'admission',
  'small', 'ride', 'pass', 'option', 'included', 'free',
]);

const normalize = (text) =>
  String(text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOP_WORDS.has(w))
    .join(' ')
    .trim();

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

const fuzzyScore = (normA, normB) => {
  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0;
  const fuse = new Fuse([{ n: normB }], { keys: ['n'], includeScore: true, threshold: 1.0 });
  const result = fuse.search(normA);
  return result[0] ? 1 - result[0].score : 0;
};

const DIFFERENTIATORS = {
  transport:  ['bike', 'e-bike', 'ebike', 'segway', 'bus', 'boat', 'kayak', 'canoe',
               'catamaran', 'helicopter', 'walking', 'sailing', 'scooter', 'vespa',
               'jet ski', 'horseback', 'horse', 'tuk-tuk', 'tuktuk', 'gondola',
               'hot air balloon', 'balloon', 'cable car', 'ferry', 'yacht', 'raft',
               'paddleboard', 'sup'],
  time:       ['sunset', 'sunrise', 'morning', 'evening', 'night', 'nighttime',
               'daytime', 'after dark', 'twilight', 'dawn'],
  format:     ['workshop', 'class', 'cooking', 'lesson', 'tasting', 'show',
               'concert', 'flamenco', 'performance', 'masterclass', 'demo'],
  scope:      ['combo', 'highlights', 'express', 'comprehensive', 'full-day',
               'full day', 'half-day', 'half day', 'multi-day', 'multi day'],
  venue:      ['museum', 'stadium', 'rooftop', 'underground', 'cave', 'vineyard',
               'winery', 'brewery', 'market', 'bazaar'],
  product:    ['ticket', 'entry ticket', 'skip the line', 'skip-the-line',
               'private tour', 'private guided', 'small group', 'small-group',
               'guided tour', 'self-guided', 'audioguide', 'audio tour',
               'hop-on hop-off', 'hop on hop off', 'transfer', 'airport transfer'],
  group_size: ['private', 'small group', 'small-group', 'group tour',
               'shared', 'vip', 'exclusive'],
  level:      ['summit', 'top', 'top floor', 'second level', '2nd level', '2nd floor',
               'first level', '1st level', '1st floor', 'third level', '3rd level',
               '3rd floor', 'ground floor', 'observation deck', 'all floors', 'all levels',
               'rooftop', 'terrace', 'basement', 'underground', 'climbing',
               'elevator', 'lift', 'stairs', 'steps'],
  meal:       ['dinner', 'lunch', 'breakfast', 'brunch', 'champagne', 'aperitif',
               'wine tasting', 'cocktail', 'picnic', 'afternoon tea', 'supper',
               'food tour', 'dessert'],
  addon:      ['cruise', 'river cruise', 'seine cruise', 'city tour', 'louvre',
               'notre dame', 'montmartre', 'versailles', 'disneyland',
               'arc de triomphe', 'sacre coeur', 'moulin rouge'],
};

const DIFF_WEIGHTS = {
  transport:  0.40,
  time:       0.25,
  format:     0.35,
  scope:      0.30,
  venue:      0.30,
  product:    0.25,
  group_size: 0.20,
  level:      0.40,
  meal:       0.30,
  addon:      0.30,
};

const extractDifferentiators = (title) => {
  const lower = title.toLowerCase().replace(/[-]/g, ' ');
  const collapsed = lower.replace(/\s+/g, '');
  const found = {};
  for (const [category, words] of Object.entries(DIFFERENTIATORS)) {
    for (const w of words) {
      const wCollapsed = w.replace(/[\s-]/g, '');
      if (lower.includes(w) || collapsed.includes(wCollapsed)) {
        if (!found[category]) found[category] = [];
        if (!found[category].includes(w)) found[category].push(w);
      }
    }
  }
  return found;
};

const ASYMMETRIC_CATEGORIES = new Set(['level', 'meal', 'addon', 'product', 'scope']);

const computeDistinctnessScore = (titleA, titleB) => {
  const diffA = extractDifferentiators(titleA);
  const diffB = extractDifferentiators(titleB);

  let score = 0;
  const conflicts = [];

  for (const category of Object.keys(DIFFERENTIATORS)) {
    const setA = diffA[category];
    const setB = diffB[category];
    if (setA && setB) {
      const overlap = setA.some(w => setB.includes(w));
      if (!overlap) {
        score += DIFF_WEIGHTS[category] || 0.25;
        conflicts.push({ category, a: setA, b: setB });
      }
    } else if (ASYMMETRIC_CATEGORIES.has(category) && (setA || setB)) {
      // One title has a specific level/meal/addon the other lacks — partial signal
      score += (DIFF_WEIGHTS[category] || 0.25) * 0.5;
      conflicts.push({ category, a: setA || ['none'], b: setB || ['none'] });
    }
  }

  // Suffix divergence bonus: if titles share a landmark prefix but tails differ
  const wordsA = normalize(titleA).split(/\s+/);
  const wordsB = normalize(titleB).split(/\s+/);
  let shared = 0;
  while (shared < wordsA.length && shared < wordsB.length && wordsA[shared] === wordsB[shared]) shared++;
  if (shared >= 2) {
    const tailA = wordsA.slice(shared).join(' ');
    const tailB = wordsB.slice(shared).join(' ');
    if (tailA && tailB) {
      const tailSim = fuzzyScore(tailA, tailB);
      if (tailSim < 0.40) score += 0.25;
      else if (tailSim < 0.60) score += 0.10;
    } else if (tailA || tailB) {
      score += 0.15;
    }
  }

  return { score: Math.min(score, 1.0), conflicts };
};

const PRICE_DELTA_THRESHOLD = 0.50;

const priceDeltaPct = (a, b) => {
  const pa = a.price_from;
  const pb = b.price_from;
  if (pa == null || pb == null || pa <= 0 || pb <= 0) return null;
  return Math.abs(pa - pb) / Math.max(pa, pb);
};

const DURATION_DELTA_THRESHOLD = 0.50;

const durationDeltaPct = (a, b) => {
  const da = a.duration_minutes;
  const db = b.duration_minutes;
  if (da == null || db == null || da <= 0 || db <= 0) return null;
  return Math.abs(da - db) / Math.max(da, db);
};

const decide = (embSim, fuzzySim, a, b, thresholds = {}) => {
  const bothHaveCat = a.category && b.category
    && a.category !== 'TICKET' && b.category !== 'TICKET';
  const catMismatch = bothHaveCat
    && a.category.toLowerCase() !== b.category.toLowerCase();

  const { score: distinctness, conflicts } = computeDistinctnessScore(a.title, b.title);

  if (distinctness >= 0.50)
    return { decision: 'DISTINCT', rule: `distinctness(${distinctness.toFixed(2)})[${conflicts.map(c => c.category).join(',')}]` };

  const rawSim = Math.max(embSim, fuzzySim);
  const effectiveSim = rawSim - distinctness;

  const delta = priceDeltaPct(a, b);
  const priceConflict = delta != null && delta >= PRICE_DELTA_THRESHOLD;

  const durDelta = durationDeltaPct(a, b);
  const durationConflict = durDelta != null && durDelta >= DURATION_DELTA_THRESHOLD;

  const catPenalty = catMismatch ? 0.05 : 0;

  const dupThresh = (thresholds.duplicate ?? 0.85) - catPenalty;
  const uncertainThresh = (thresholds.uncertain ?? 0.75) - catPenalty;

  if (effectiveSim >= dupThresh) {
    if (durationConflict)
      return { decision: 'DISTINCT', rule: `eff(${effectiveSim.toFixed(2)})+duration_delta(${(durDelta*100).toFixed(0)}%: ${a.duration_minutes}m vs ${b.duration_minutes}m)` };
    if (priceConflict)
      return { decision: 'UNCERTAIN', rule: `eff(${effectiveSim.toFixed(2)})+price_delta(${(delta*100).toFixed(0)}%)`, embSim, fuzzySim, distinctness };
    return { decision: 'DUPLICATE', rule: `eff(${effectiveSim.toFixed(2)})>=dup(${dupThresh.toFixed(2)})` };
  }

  if (effectiveSim >= uncertainThresh) {
    if (durationConflict)
      return { decision: 'DISTINCT', rule: `eff(${effectiveSim.toFixed(2)})+duration_delta(${(durDelta*100).toFixed(0)}%: ${a.duration_minutes}m vs ${b.duration_minutes}m)` };
    return { decision: 'UNCERTAIN', rule: `eff(${effectiveSim.toFixed(2)})>=unc(${uncertainThresh.toFixed(2)})`, embSim, fuzzySim, distinctness };
  }

  return { decision: 'DISTINCT', rule: `eff(${effectiveSim.toFixed(2)})<unc(${uncertainThresh.toFixed(2)})` };
};

// --- LLM ---

const LLM_BATCH_SIZE = 20;
const LLM_MODEL = 'claude-haiku-4-5-20251001';
const LLM_BUDGET_USD = parseFloat(process.env.DEDUP_LLM_BUDGET_USD || '3.00');
const HAIKU_INPUT_PER_M = 0.80;
const HAIKU_OUTPUT_PER_M = 4.00;

let llmSpendUSD = 0;
const trackCost = (resp) => {
  const inp = resp.usage?.input_tokens || 0;
  const out = resp.usage?.output_tokens || 0;
  const cost = (inp / 1_000_000) * HAIKU_INPUT_PER_M + (out / 1_000_000) * HAIKU_OUTPUT_PER_M;
  llmSpendUSD += cost;
  return cost;
};
const budgetExhausted = () => llmSpendUSD >= LLM_BUDGET_USD;

const buildLLMPrompt = (pairs) => {
  const lines = pairs.map((p, idx) =>
    `${idx + 1}. A: "${p.a.title}" (${p.a.supplier_slug}, ${p.a.category || 'n/a'})\n` +
    `   B: "${p.b.title}" (${p.b.supplier_slug}, ${p.b.category || 'n/a'})\n` +
    `   City: ${p.city} | Emb: ${p.embSim.toFixed(3)} | Fuzzy: ${p.fuzzySim.toFixed(3)}`
  ).join('\n\n');

  return `You are a travel product deduplication judge. For each pair below, decide whether they are the SAME real-world experience (DUPLICATE) or genuinely different products (DISTINCT).

DUPLICATE means: a traveler buying both would do the same activity twice.
DISTINCT means: they are different activities, even if related (e.g., a walking food tour vs a cooking class, a bus tour vs a bike tour, a 2-hour tour vs a full-day tour).

When in doubt, lean DISTINCT — false negatives (missing a duplicate) are less harmful than false positives (hiding a unique product).

${lines}

Respond with a JSON array of objects, one per pair, in order:
[{"pair":1,"decision":"DUPLICATE"|"DISTINCT","reason":"<10 words>"},...]

Return ONLY the JSON array, no other text.`;
};

const askLLM = async (pairs) => {
  if (pairs.length === 0) return [];
  const client = getLLMClient();

  const results = [];
  for (let i = 0; i < pairs.length; i += LLM_BATCH_SIZE) {
    if (budgetExhausted()) {
      log('warn', 'llm_budget_exhausted', {
        spent_usd: llmSpendUSD.toFixed(4), budget_usd: LLM_BUDGET_USD,
        skipped_pairs: pairs.length - i,
      });
      for (let k = i; k < pairs.length; k++) {
        results.push({ ...pairs[k], decision: 'DISTINCT', rule: 'budget_exhausted' });
      }
      break;
    }
    const batch = pairs.slice(i, i + LLM_BATCH_SIZE);
    try {
      const resp = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildLLMPrompt(batch) }],
      });
      const batchCost = trackCost(resp);
      log('info', 'llm_batch_cost', {
        batch_start: i, pairs: batch.length,
        cost_usd: batchCost.toFixed(4), total_spent_usd: llmSpendUSD.toFixed(4),
        budget_remaining_usd: (LLM_BUDGET_USD - llmSpendUSD).toFixed(4),
      });
      const text = resp.content[0]?.text || '[]';
      const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      for (let k = 0; k < batch.length; k++) {
        const llmResult = parsed[k];
        results.push({
          ...batch[k],
          decision: llmResult?.decision === 'DUPLICATE' ? 'DUPLICATE' : 'DISTINCT',
          rule: `llm:${llmResult?.reason || 'no_reason'}`,
        });
      }
    } catch (err) {
      log('warn', 'llm_batch_failed', { batch_start: i, error: err.message });
      for (const p of batch) {
        results.push({ ...p, decision: 'DISTINCT', rule: 'llm_error_fallback' });
      }
    }
  }
  return results;
};

// --- Canonical selection ---

const pickCanonical = (members) => {
  return members.reduce((best, r) => {
    const bIsBridgify = best.supplier_slug === 'bridgify' ? 1 : 0;
    const rIsBridgify = r.supplier_slug === 'bridgify' ? 1 : 0;
    if (rIsBridgify > bIsBridgify) return r;
    if (bIsBridgify > rIsBridgify) return best;

    let rScore = 0, bScore = 0;
    if (r.description) rScore += 2;
    if (r.image_urls?.length) rScore += 1;
    if (r.duration_minutes) rScore += 1;
    if (r.latitude) rScore += 1;
    if (best.description) bScore += 2;
    if (best.image_urls?.length) bScore += 1;
    if (best.duration_minutes) bScore += 1;
    if (best.latitude) bScore += 1;
    return rScore > bScore ? r : best;
  });
};

// --- Candidate pair finding: in-memory for small cities, pgvector KNN for large ---

const KNN_NEIGHBORS = 30;
const SMALL_CITY_THRESHOLD = 200;

const parseEmbedding = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.replace(/^\[|\]$/g, '');
    return trimmed.split(',').map(Number);
  }
  return null;
};

const buildPair = (recA, recB, embSim) => ({
  id_a: recA.id, id_b: recB.id,
  emb_sim: embSim,
  title_a: recA.title, title_b: recB.title,
  supplier_a: recA.supplier_slug, supplier_b: recB.supplier_slug,
  cat_a: recA.category, cat_b: recB.category,
  dur_a: recA.duration_minutes, dur_b: recB.duration_minutes,
  desc_a: recA.description, desc_b: recB.description,
  imgs_a: recA.image_urls, imgs_b: recB.image_urls,
  lat_a: recA.latitude, lat_b: recB.latitude,
  price_a: recA.price_from, price_b: recB.price_from,
});

const findPairsInMemory = (records, simThreshold) => {
  const pairs = [];
  for (let i = 0; i < records.length; i++) {
    const vecA = parseEmbedding(records[i].embedding);
    if (!vecA) continue;
    for (let j = i + 1; j < records.length; j++) {
      if (records[i].supplier_slug === records[j].supplier_slug) continue;
      const vecB = parseEmbedding(records[j].embedding);
      if (!vecB) continue;
      const sim = cosine(vecA, vecB);
      if (sim >= simThreshold) {
        pairs.push(buildPair(records[i], records[j], sim));
      }
    }
  }
  return pairs;
};

const findCandidatePairs = async (city, simThreshold = 0.65, onKnnProgress) => {
  const { rows: records } = await dedupQuery(`
    SELECT id, title, supplier_slug, category, duration_minutes,
           description, image_urls, latitude, price_from, embedding
    FROM hub_static_inventory
    WHERE type = 'EXPERIENCE' AND is_active = true AND embedding IS NOT NULL
      AND LOWER(TRIM(city)) = $1
    ORDER BY id
  `, [city]);

  if (records.length < 2) return [];

  // Small cities: all-pairs in memory (no DB round-trips)
  if (records.length <= SMALL_CITY_THRESHOLD) {
    return findPairsInMemory(records, simThreshold);
  }

  // Large cities: pgvector KNN
  const seen = new Set();
  const pairs = [];

  const knnForRecord = async (rec) => {
    const client = await getDedupPool().connect();
    try {
      await client.query(`SET LOCAL ivfflat.probes = ${IVFFLAT_PROBES}`);
      const { rows: neighbors } = await client.query(`
        SELECT id, title, supplier_slug, category, duration_minutes,
               description, image_urls, latitude, price_from,
               1 - (embedding <=> $1) AS emb_sim
        FROM hub_static_inventory
        WHERE type = 'EXPERIENCE' AND is_active = true AND embedding IS NOT NULL
          AND LOWER(TRIM(city)) = $2
          AND id != $3
        ORDER BY embedding <=> $1
        LIMIT $4
      `, [rec.embedding, city, rec.id, KNN_NEIGHBORS]);
      return neighbors;
    } finally {
      client.release();
    }
  };

  let knnDone = 0;
  for (let i = 0; i < records.length; i += KNN_CONCURRENCY) {
    const batch = records.slice(i, i + KNN_CONCURRENCY);
    const allNeighbors = await Promise.all(batch.map(rec =>
      knnForRecord(rec).then(neighbors => ({ rec, neighbors }))
    ));

    knnDone += batch.length;
    if (onKnnProgress && records.length >= 50 && knnDone % 50 === 0) {
      onKnnProgress(knnDone, records.length, pairs.length);
    }

    for (const { rec, neighbors } of allNeighbors) {
      for (const nb of neighbors) {
        if (nb.emb_sim < simThreshold) continue;
        const pairKey = rec.id < nb.id ? `${rec.id}:${nb.id}` : `${nb.id}:${rec.id}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        pairs.push(buildPair(rec, nb, parseFloat(nb.emb_sim)));
      }
    }
  }

  return pairs;
};

// --- Main dedup: rule-based using stored pgvector embeddings ---

export const precomputeDedup = async (tenantId = 't_demo', { onProgress } = {}) => {
  const t0 = Date.now();
  log('info', 'dedup_precompute_start');

  const cfg = await loadDedupConfig(tenantId);
  const dupThreshold = cfg.thresholds?.embedding_duplicate ?? 0.85;
  const uncertainThreshold = cfg.thresholds?.embedding_uncertain ?? 0.70;
  const maxCluster = cfg.thresholds?.max_cluster_size ?? 10;

  log('info', 'dedup_config_loaded', {
    dupThreshold, uncertainThreshold, maxCluster,
    strategy: 'or_gate_v3_pgvector',
  });

  await dedupQuery(`UPDATE hub_static_inventory SET canonical_id = NULL WHERE canonical_id IS NOT NULL AND type = 'EXPERIENCE'`);

  const { rows: cities } = await dedupQuery(`
    SELECT LOWER(TRIM(city)) AS city, COUNT(*)::int AS cnt
    FROM hub_static_inventory
    WHERE type = 'EXPERIENCE' AND is_active = true
      AND city IS NOT NULL AND TRIM(city) != ''
      AND embedding IS NOT NULL
    GROUP BY LOWER(TRIM(city))
    HAVING COUNT(*) >= 2
    ORDER BY cnt DESC
  `);

  const totalRecords = cities.reduce((s, c) => s + c.cnt, 0);
  log('info', 'dedup_cities', { count: cities.length, total_records: totalRecords, concurrency: CITY_CONCURRENCY, knn_concurrency: KNN_CONCURRENCY, probes: IVFFLAT_PROBES });

  if (onProgress) {
    onProgress(0, {
      progress: `Starting: ${cities.length} cities, ${totalRecords.toLocaleString()} records`,
      totals: { duplicates: 0, clusters: 0, uncertain: 0, pairs_checked: 0 },
    }).catch(() => {});
  }

  let totalDuplicates = 0;
  let totalClusters = 0;
  let totalUncertain = 0;
  let totalPairsChecked = 0;
  let citiesProcessed = 0;
  let recordsProcessed = 0;

  const processCity = async ({ city, cnt }) => {
    if (cnt >= 100) {
      log('info', 'dedup_city_start', { city, records: cnt });
    }
    const cityT0 = Date.now();

    const knnProgress = onProgress ? (knnDone, knnTotal, pairsFound) => {
      const totalElapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const pct = Math.max(1, Math.round(((recordsProcessed + knnDone) / totalRecords) * 100));
      onProgress(pct, {
        progress: `${city}: KNN ${knnDone}/${knnTotal} records, ${pairsFound} pairs found (${totalElapsed}s elapsed)`,
        totals: { duplicates: totalDuplicates, clusters: totalClusters, uncertain: totalUncertain, pairs_checked: totalPairsChecked },
      }).catch(() => {});
    } : null;

    const pairs = await findCandidatePairs(city, uncertainThreshold, knnProgress);

    const recordMap = new Map();
    const edges = [];

    for (const p of pairs) {
      if (!recordMap.has(p.id_a)) {
        recordMap.set(p.id_a, {
          id: p.id_a, title: p.title_a, supplier_slug: p.supplier_a,
          category: p.cat_a, duration_minutes: p.dur_a,
          description: p.desc_a, image_urls: p.imgs_a, latitude: p.lat_a,
          price_from: p.price_a,
        });
      }
      if (!recordMap.has(p.id_b)) {
        recordMap.set(p.id_b, {
          id: p.id_b, title: p.title_b, supplier_slug: p.supplier_b,
          category: p.cat_b, duration_minutes: p.dur_b,
          description: p.desc_b, image_urls: p.imgs_b, latitude: p.lat_b,
          price_from: p.price_b,
        });
      }

      const a = recordMap.get(p.id_a);
      const b = recordMap.get(p.id_b);
      const normA = normalize(a.title);
      const normB = normalize(b.title);
      const fuzzySim = fuzzyScore(normA, normB);
      const { decision } = decide(p.emb_sim, fuzzySim, a, b, { duplicate: dupThreshold, uncertain: uncertainThreshold });

      if (decision === 'DUPLICATE') {
        edges.push({ idA: p.id_a, idB: p.id_b, score: Math.max(p.emb_sim, fuzzySim) });
      } else if (decision === 'UNCERTAIN') {
        totalUncertain++;
      }
    }

    edges.sort((a, b) => b.score - a.score);

    const clusterOf = new Map();
    const clusters = [];

    for (const { idA, idB } of edges) {
      const ci = clusterOf.get(idA) ?? -1;
      const cj = clusterOf.get(idB) ?? -1;

      if (ci === -1 && cj === -1) {
        const idx = clusters.length;
        clusters.push({ members: new Set([idA, idB]) });
        clusterOf.set(idA, idx);
        clusterOf.set(idB, idx);
      } else if (ci !== -1 && cj === -1) {
        if (clusters[ci].members.size < maxCluster) {
          clusters[ci].members.add(idB);
          clusterOf.set(idB, ci);
        }
      } else if (ci === -1 && cj !== -1) {
        if (clusters[cj].members.size < maxCluster) {
          clusters[cj].members.add(idA);
          clusterOf.set(idA, cj);
        }
      }
    }

    let cityDuplicates = 0;
    let cityClusters = 0;
    for (const cluster of clusters) {
      const members = [...cluster.members].map(id => recordMap.get(id));
      const canonical = pickCanonical(members);
      const nonCanonicalIds = members.filter(m => m.id !== canonical.id).map(m => m.id);

      if (nonCanonicalIds.length > 0) {
        cityDuplicates += nonCanonicalIds.length;
        cityClusters++;
        await dedupQuery(
          `UPDATE hub_static_inventory SET canonical_id = $1 WHERE id = ANY($2)`,
          [canonical.id, nonCanonicalIds],
        );
      }
    }

    totalDuplicates += cityDuplicates;
    totalClusters += cityClusters;
    totalPairsChecked += pairs.length;
    citiesProcessed++;
    recordsProcessed += cnt;

    const shouldLog = cnt >= 50 || citiesProcessed % 500 === 0;
    const shouldProgress = citiesProcessed % 10 === 0 || citiesProcessed === cities.length || cnt >= 50;

    if (shouldLog || shouldProgress) {
      const citySec = ((Date.now() - cityT0) / 1000).toFixed(1);
      const totalElapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const pct = Math.max(1, Math.round((recordsProcessed / totalRecords) * 100));
      const detail = {
        city, records: cnt, pairs: pairs.length,
        clusters: cityClusters, duplicates: cityDuplicates, city_sec: citySec,
        progress: `${citiesProcessed}/${cities.length} cities (${recordsProcessed.toLocaleString()}/${totalRecords.toLocaleString()} records), ${totalElapsed}s elapsed`,
        totals: { duplicates: totalDuplicates, clusters: totalClusters, uncertain: totalUncertain, pairs_checked: totalPairsChecked },
      };
      if (shouldLog) log('info', 'dedup_city_done', detail);
      if (shouldProgress && onProgress) {
        onProgress(pct, detail).catch(() => {});
      }
    }
  };

  // Process large cities (100+ records) sequentially — they saturate all connections
  // Process smaller cities in parallel batches
  const largeCities = cities.filter(c => c.cnt >= 100);
  const smallCities = cities.filter(c => c.cnt < 100);

  for (const city of largeCities) {
    await processCity(city);
  }

  for (let i = 0; i < smallCities.length; i += CITY_CONCURRENCY) {
    const batch = smallCities.slice(i, i + CITY_CONCURRENCY);
    await Promise.all(batch.map(city => processCity(city)));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log('info', 'dedup_precompute_complete', {
    elapsed_sec: elapsed,
    cities: cities.length,
    pairs_checked: totalPairsChecked,
    duplicates_marked: totalDuplicates,
    clusters: totalClusters,
    uncertain_pairs: totalUncertain,
  });

  if (dedupPool) {
    const poolCloseTimeout = setTimeout(() => {
      log('warn', 'dedup_pool_close_timeout', { msg: 'pool.end() took >10s, forcing' });
      dedupPool = null;
    }, 10000);
    try { await dedupPool.end(); } catch (e) { log('warn', 'dedup_pool_close_error', { error: e.message }); }
    clearTimeout(poolCloseTimeout);
    dedupPool = null;
  }

  return {
    elapsed_sec: parseFloat(elapsed),
    duplicates_marked: totalDuplicates,
    clusters: totalClusters,
    uncertain_pairs: totalUncertain,
  };
};

// --- LLM judge: separate pass on uncertain pairs using stored embeddings ---

export const llmJudgePass = async (tenantId = 't_demo') => {
  const t0 = Date.now();
  log('info', 'llm_judge_pass_start');
  llmSpendUSD = 0;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'ANTHROPIC_API_KEY not set' };
  }

  const cfg = await loadDedupConfig(tenantId);
  const uncertainThreshold = cfg.thresholds?.embedding_uncertain ?? 0.70;
  const dupThreshold = cfg.thresholds?.embedding_duplicate ?? 0.85;
  const maxCluster = cfg.thresholds?.max_cluster_size ?? 10;

  const { rows: cities } = await query(`
    SELECT LOWER(TRIM(city)) AS city, COUNT(*)::int AS cnt
    FROM hub_static_inventory
    WHERE type = 'EXPERIENCE' AND is_active = true AND city IS NOT NULL
      AND embedding IS NOT NULL AND canonical_id IS NULL
    GROUP BY LOWER(TRIM(city))
    HAVING COUNT(*) >= 2
    ORDER BY cnt DESC
  `);

  log('info', 'llm_judge_cities', { count: cities.length });

  let totalPairsJudged = 0;
  let totalNewDuplicates = 0;

  for (const { city, cnt } of cities) {
    if (budgetExhausted()) {
      log('warn', 'llm_budget_exhausted_skipping_city', { city, spent_usd: llmSpendUSD.toFixed(4) });
      break;
    }

    // Find uncertain pairs: similarity between uncertain and duplicate thresholds, only among canonicals
    const { rows: pairs } = await query(`
      SELECT
        a.id AS id_a, b.id AS id_b,
        1 - (a.embedding <=> b.embedding) AS emb_sim,
        a.title AS title_a, b.title AS title_b,
        a.supplier_slug AS supplier_a, b.supplier_slug AS supplier_b,
        a.category AS cat_a, b.category AS cat_b,
        a.duration_minutes AS dur_a, b.duration_minutes AS dur_b,
        a.price_from AS price_a, b.price_from AS price_b
      FROM hub_static_inventory a
      JOIN hub_static_inventory b
        ON a.city = b.city AND a.id < b.id AND a.type = b.type
      WHERE a.type = 'EXPERIENCE'
        AND a.is_active = true AND b.is_active = true
        AND a.canonical_id IS NULL AND b.canonical_id IS NULL
        AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
        AND LOWER(TRIM(a.city)) = $1
        AND 1 - (a.embedding <=> b.embedding) >= $2
        AND 1 - (a.embedding <=> b.embedding) < $3
    `, [city, uncertainThreshold, dupThreshold]);

    const uncertainPairs = [];
    for (const p of pairs) {
      const a = { id: p.id_a, title: p.title_a, supplier_slug: p.supplier_a, category: p.cat_a, duration_minutes: p.dur_a, price_from: p.price_a };
      const b = { id: p.id_b, title: p.title_b, supplier_slug: p.supplier_b, category: p.cat_b, duration_minutes: p.dur_b, price_from: p.price_b };
      const fuzzySim = fuzzyScore(normalize(a.title), normalize(b.title));
      const { decision } = decide(p.emb_sim, fuzzySim, a, b, { duplicate: dupThreshold, uncertain: uncertainThreshold });

      if (decision === 'UNCERTAIN') {
        uncertainPairs.push({ a, b, embSim: p.emb_sim, fuzzySim, city });
      }
    }

    if (uncertainPairs.length === 0) continue;

    uncertainPairs.sort((a, b) => b.embSim - a.embSim);
    log('info', 'llm_judge_city', {
      city, pairs: uncertainPairs.length,
      spent_usd: llmSpendUSD.toFixed(4),
    });

    const llmResults = await askLLM(uncertainPairs);
    totalPairsJudged += uncertainPairs.length;

    for (const r of llmResults) {
      if (r.decision !== 'DUPLICATE') continue;

      const canonical = pickCanonical([r.a, r.b]);
      const duplicate = canonical.id === r.a.id ? r.b : r.a;

      const clusterSize = await query(
        `SELECT COUNT(*)::int AS cnt FROM hub_static_inventory WHERE canonical_id = $1`,
        [canonical.id],
      );
      if (clusterSize.rows[0].cnt >= maxCluster) continue;

      await query(
        `UPDATE hub_static_inventory SET canonical_id = $1 WHERE id = $2 AND canonical_id IS NULL`,
        [canonical.id, duplicate.id],
      );
      totalNewDuplicates++;
    }

    if (cnt >= 50) {
      log('info', 'llm_judge_city_done', { city, pairs: uncertainPairs.length });
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log('info', 'llm_judge_pass_complete', {
    elapsed_sec: elapsed,
    pairs_judged: totalPairsJudged,
    new_duplicates: totalNewDuplicates,
    llm_cost_usd: llmSpendUSD.toFixed(4),
    budget_exhausted: budgetExhausted(),
  });

  return {
    elapsed_sec: parseFloat(elapsed),
    pairs_judged: totalPairsJudged,
    new_duplicates: totalNewDuplicates,
    llm_cost_usd: parseFloat(llmSpendUSD.toFixed(4)),
    budget_exhausted: budgetExhausted(),
  };
};

const GEO_REVIEW_RADIUS_M = 50000;

const buildGeoReviewPrompt = (pairs) => {
  const lines = pairs.map((p, idx) =>
    `${idx + 1}. A: "${p.title_a}" (${p.supplier_a}, ${p.city_a}, ${p.cat_a || 'n/a'}, $${p.price_a || '?'}, ${p.dur_a || '?'}min)\n` +
    `   B: "${p.title_b}" (${p.supplier_b}, ${p.city_b}, ${p.cat_b || 'n/a'}, $${p.price_b || '?'}, ${p.dur_b || '?'}min)\n` +
    `   Distance: ${(p.dist_m / 1000).toFixed(0)}km apart`
  ).join('\n\n');

  return `You are a travel product deduplication reviewer. These pairs were matched as duplicates but are geographically far apart (${(GEO_REVIEW_RADIUS_M/1000)}km+). Review each pair and decide:

KEEP_PAIRED — they ARE the same product (multi-day tour, different pickup points, same attraction in a large area)
SPLIT — they are genuinely different products that were incorrectly grouped

Key rules:
- Multi-day safaris, road trips, or tours that cover large areas = KEEP_PAIRED (even 200km+ is normal)
- Same attraction name but clearly different cities = SPLIT
- Same tour operator, same route, slightly different departure points = KEEP_PAIRED
- Generic tour names that happen to match across cities = SPLIT
- When in doubt, SPLIT — it's safer to show both than to hide one

${lines}

Respond with a JSON array:
[{"pair":1,"decision":"KEEP_PAIRED"|"SPLIT","reason":"<10 words>"},...]

Return ONLY the JSON array.`;
};

export { normalize, fuzzyScore, cosine, decide };

export const llmGeoReview = async ({ onProgress } = {}) => {
  const t0 = Date.now();
  log('info', 'llm_geo_review_start', { radius_m: GEO_REVIEW_RADIUS_M });
  llmSpendUSD = 0;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'ANTHROPIC_API_KEY not set' };
  }

  const { rows: badPairs } = await query(`
    SELECT a.canonical_id, a.id AS id_a, b.id AS id_b,
           a.title AS title_a, b.title AS title_b,
           a.city AS city_a, b.city AS city_b,
           a.supplier_slug AS supplier_a, b.supplier_slug AS supplier_b,
           a.category AS cat_a, b.category AS cat_b,
           a.price_from AS price_a, b.price_from AS price_b,
           a.duration_minutes AS dur_a, b.duration_minutes AS dur_b,
           ROUND((6371000*acos(LEAST(1,
             cos(radians(a.latitude))*cos(radians(b.latitude))*
             cos(radians(b.longitude)-radians(a.longitude))+
             sin(radians(a.latitude))*sin(radians(b.latitude))
           )))::numeric) AS dist_m
    FROM hub_static_inventory a
    JOIN hub_static_inventory b ON a.canonical_id = b.canonical_id AND a.id < b.id
    WHERE a.canonical_id IS NOT NULL AND a.is_active AND b.is_active
      AND a.latitude IS NOT NULL AND b.latitude IS NOT NULL
      AND 6371000*acos(LEAST(1,
            cos(radians(a.latitude))*cos(radians(b.latitude))*
            cos(radians(b.longitude)-radians(a.longitude))+
            sin(radians(a.latitude))*sin(radians(b.latitude))
          )) > $1
    ORDER BY dist_m DESC
  `, [GEO_REVIEW_RADIUS_M]);

  log('info', 'llm_geo_review_pairs_found', { count: badPairs.length });

  if (badPairs.length === 0) {
    return { pairs_reviewed: 0, splits: 0, kept: 0, llm_cost_usd: 0 };
  }

  const client = getLLMClient();
  let totalSplits = 0;
  let totalKept = 0;
  let totalReviewed = 0;

  for (let i = 0; i < badPairs.length; i += LLM_BATCH_SIZE) {
    if (budgetExhausted()) {
      log('warn', 'geo_review_budget_exhausted', { spent_usd: llmSpendUSD.toFixed(4), reviewed: totalReviewed });
      break;
    }

    const batch = badPairs.slice(i, i + LLM_BATCH_SIZE);

    try {
      const resp = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildGeoReviewPrompt(batch) }],
      });
      const batchCost = trackCost(resp);
      log('info', 'geo_review_batch', {
        batch_start: i, pairs: batch.length,
        cost_usd: batchCost.toFixed(4), total_spent_usd: llmSpendUSD.toFixed(4),
      });

      const text = resp.content[0]?.text || '[]';
      const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      for (let k = 0; k < batch.length; k++) {
        const llmResult = parsed[k];
        const pair = batch[k];

        if (llmResult?.decision === 'SPLIT') {
          await query(
            `UPDATE hub_static_inventory SET canonical_id = NULL WHERE id = $1`,
            [pair.id_b],
          );
          totalSplits++;
          log('info', 'geo_review_split', {
            id_a: pair.id_a, id_b: pair.id_b,
            title_a: pair.title_a?.slice(0, 50), title_b: pair.title_b?.slice(0, 50),
            dist_km: (pair.dist_m / 1000).toFixed(0),
            reason: llmResult.reason,
          });
        } else {
          totalKept++;
        }
        totalReviewed++;
      }
    } catch (e) {
      log('error', 'geo_review_batch_error', { batch_start: i, error: e.message });
    }

    if (onProgress) {
      const pct = Math.round((Math.min(i + LLM_BATCH_SIZE, badPairs.length) / badPairs.length) * 100);
      await onProgress(pct, { reviewed: totalReviewed, splits: totalSplits, kept: totalKept }).catch(() => {});
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log('info', 'llm_geo_review_complete', {
    elapsed_sec: elapsed, pairs_reviewed: totalReviewed,
    splits: totalSplits, kept: totalKept,
    llm_cost_usd: llmSpendUSD.toFixed(4),
  });

  return {
    elapsed_sec: parseFloat(elapsed),
    pairs_reviewed: totalReviewed,
    splits: totalSplits,
    kept: totalKept,
    llm_cost_usd: parseFloat(llmSpendUSD.toFixed(4)),
    budget_exhausted: budgetExhausted(),
  };
};
