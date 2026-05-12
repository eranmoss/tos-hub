import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/client.js';

let client = null;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
};

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

export const getUnmappedCategories = async (supplierSlug) => {
  const { rows } = await query(`
    SELECT DISTINCT si.category AS supplier_cat_id, COUNT(*)::int AS product_count
    FROM hub_static_inventory si
    LEFT JOIN hub_category_mappings cm
      ON cm.supplier_slug = si.supplier_slug AND cm.supplier_cat_id = si.category
    WHERE si.is_active = true
      AND si.category IS NOT NULL
      AND cm.canonical_cat_id IS NULL
      ${supplierSlug ? 'AND si.supplier_slug = $1' : ''}
    GROUP BY si.category
    ORDER BY product_count DESC
    LIMIT 200
  `, supplierSlug ? [supplierSlug] : []);
  return rows;
};

const loadCanonicalCategories = async () => {
  const { rows } = await query(`
    SELECT id, display, parent_id, level
    FROM hub_canonical_categories
    WHERE level >= 0
    ORDER BY level, display
  `);
  return rows;
};

const buildPrompt = (supplierSlug, supplierCats, canonicalCats) => {
  const canonicalList = canonicalCats
    .map(c => `  "${c.id}" — ${c.display}${c.parent_id ? ` (child of ${c.parent_id})` : ''}`)
    .join('\n');

  const supplierList = supplierCats
    .map(c => `  "${c.supplier_cat_id}" (${c.product_count} products)${c.name ? ` — "${c.name}"` : ''}`)
    .join('\n');

  return `You are mapping supplier product categories to a canonical taxonomy for a travel platform.

SUPPLIER: ${supplierSlug}
The supplier uses these category IDs that are NOT yet mapped:
${supplierList}

CANONICAL TAXONOMY (existing categories to map TO):
${canonicalList}

TASK:
For each supplier category, find the best matching canonical category. If no good match exists, propose a NEW canonical category.

Rules:
- Match by semantic meaning, not just string similarity
- "Walking & Hiking" maps to "walking-tours" or "hiking", not a new category
- "Gastronomic Experience" maps to "food-tours" or "food-drink"
- Operational/quality flags (like "Best Seller", "New", "Free Cancellation") are NOT real categories — mark them as skip=true
- New canonical IDs must be lowercase kebab-case (e.g. "wine-tasting")
- Confidence: 1.0 = exact match, 0.8+ = strong semantic match, 0.5-0.8 = partial/uncertain, <0.5 = no good match

Return a JSON array. Each element:
{
  "supplier_cat_id": "the supplier's ID",
  "canonical_cat_id": "matched or proposed canonical ID",
  "canonical_display": "Human-readable name (only needed for NEW categories)",
  "confidence": 0.95,
  "is_new": false,
  "skip": false,
  "reason": "short explanation"
}

Return ONLY the JSON array, no markdown fences.`;
};

export const mapCategoriesToCanonical = async (supplierSlug, supplierCats, { dryRun = false } = {}) => {
  if (!supplierCats?.length) return { mapped: 0, created: 0, skipped: 0, proposals: [] };

  const canonicalCats = await loadCanonicalCategories();
  const prompt = buildPrompt(supplierSlug, supplierCats, canonicalCats);

  log('info', 'category_mapper_llm_start', { supplier: supplierSlug, unmapped: supplierCats.length, canonical_count: canonicalCats.length });

  const resp = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content?.[0]?.text || '';
  let proposals;
  try {
    proposals = JSON.parse(text.replace(/```(?:json)?/g, '').trim());
  } catch (e) {
    log('error', 'category_mapper_parse_fail', { error: e.message, text: text.substring(0, 200) });
    throw new Error('Failed to parse LLM category mapping response');
  }

  if (!Array.isArray(proposals)) throw new Error('LLM response is not an array');

  const tokens = {
    input: resp.usage?.input_tokens || 0,
    output: resp.usage?.output_tokens || 0,
  };

  log('info', 'category_mapper_llm_done', {
    proposals: proposals.length,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
  });

  if (dryRun) {
    return { mapped: 0, created: 0, skipped: 0, proposals, tokens, dry_run: true };
  }

  let mapped = 0, created = 0, skipped = 0;

  for (const p of proposals) {
    if (p.skip) {
      await query(
        `INSERT INTO hub_canonical_categories (id, display, parent_id, level)
         VALUES ($1, $2, NULL, -1)
         ON CONFLICT (id) DO NOTHING`,
        [p.canonical_cat_id, p.canonical_display || p.canonical_cat_id]
      );
      skipped++;
      continue;
    }

    if (p.confidence < 0.5) continue;

    if (p.is_new) {
      await query(
        `INSERT INTO hub_canonical_categories (id, display, parent_id, level)
         VALUES ($1, $2, NULL, 0)
         ON CONFLICT (id) DO NOTHING`,
        [p.canonical_cat_id, p.canonical_display || p.canonical_cat_id]
      );
      created++;
    }

    await query(
      `INSERT INTO hub_category_mappings (supplier_slug, supplier_cat_id, supplier_cat_name, canonical_cat_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (supplier_slug, supplier_cat_id) DO UPDATE SET
         canonical_cat_id = EXCLUDED.canonical_cat_id,
         supplier_cat_name = COALESCE(EXCLUDED.supplier_cat_name, hub_category_mappings.supplier_cat_name)`,
      [supplierSlug, p.supplier_cat_id, p.canonical_display || null, p.canonical_cat_id]
    );
    mapped++;
  }

  log('info', 'category_mapper_complete', { supplier: supplierSlug, mapped, created, skipped });
  return { mapped, created, skipped, proposals, tokens };
};

export const autoMapUnmapped = async (supplierSlug, { dryRun = false } = {}) => {
  const unmapped = await getUnmappedCategories(supplierSlug);
  if (!unmapped.length) {
    return { unmapped: 0, mapped: 0, created: 0, skipped: 0, message: 'All categories are already mapped' };
  }

  const BATCH_SIZE = 50;
  let totalMapped = 0, totalCreated = 0, totalSkipped = 0;
  const allProposals = [];

  for (let i = 0; i < unmapped.length; i += BATCH_SIZE) {
    const batch = unmapped.slice(i, i + BATCH_SIZE);
    const result = await mapCategoriesToCanonical(supplierSlug, batch, { dryRun });
    totalMapped += result.mapped;
    totalCreated += result.created;
    totalSkipped += result.skipped;
    allProposals.push(...(result.proposals || []));
  }

  return {
    unmapped: unmapped.length,
    mapped: totalMapped,
    created: totalCreated,
    skipped: totalSkipped,
    proposals: allProposals,
    dry_run: dryRun,
  };
};
