import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDORS_DIR = path.resolve(__dirname, '../../config/vendors');

export const loadVendorKnowledge = async (slug) => {
  if (!slug) return null;
  const r = await query(
    `SELECT supplier_slug, category, knowledge_md, knowledge_json, pending_update, version, updated_at
     FROM hub_vendor_knowledge WHERE supplier_slug=$1`,
    [slug]
  );
  return r.rows[0] || null;
};

export const findSimilarVendors = async ({ category, authType, excludeSlug, limit = 3 }) => {
  if (!category) return [];
  const r = await query(
    `SELECT supplier_slug, category, knowledge_md, knowledge_json
     FROM hub_vendor_knowledge
     WHERE category=$1 AND ($2::text IS NULL OR supplier_slug<>$2)
     ORDER BY updated_at DESC LIMIT $3`,
    [category, excludeSlug || null, limit * 2]
  );
  // Re-rank: prefer matching auth type when provided.
  const rows = r.rows;
  if (!authType) return rows.slice(0, limit);
  const matches = rows.filter((x) => x.knowledge_json?.auth_type === authType);
  const others = rows.filter((x) => x.knowledge_json?.auth_type !== authType);
  return [...matches, ...others].slice(0, limit);
};

const PROTECTED_GENERATED_BY = new Set(['admin', 'human', 'disk']);

export const saveVendorKnowledge = async (slug, { category, knowledge_md, knowledge_json, generated_by = 'llm', force = false }) => {
  await mkdir(VENDORS_DIR, { recursive: true });
  const existing = await loadVendorKnowledge(slug);

  // Protect hand-written knowledge: if an existing row is admin/human/disk,
  // or the LLM is overwriting another LLM pass, park the new version in
  // pending_update instead of overwriting.
  const isLlmOverwrite = !force && existing && !PROTECTED_GENERATED_BY.has(generated_by);
  const isProtected = !force && existing && PROTECTED_GENERATED_BY.has(existing.generated_by);

  if (existing && (isProtected || isLlmOverwrite)) {
    await query(
      `UPDATE hub_vendor_knowledge
         SET pending_update = $1, updated_at = now()
       WHERE supplier_slug = $2`,
      [{ category, knowledge_md, knowledge_json: knowledge_json || {}, generated_by }, slug]
    );
    // Mirror pending to disk alongside canonical.
    await writeFile(path.join(VENDORS_DIR, `${slug}.pending.md`), knowledge_md, 'utf-8');
    await writeFile(path.join(VENDORS_DIR, `${slug}.pending.json`), JSON.stringify(knowledge_json || {}, null, 2), 'utf-8');
    return { stored: 'pending', generated_by };
  }

  // First-time seed or forced overwrite: write canonical.
  await writeFile(path.join(VENDORS_DIR, `${slug}.md`), knowledge_md, 'utf-8');
  await writeFile(path.join(VENDORS_DIR, `${slug}.json`), JSON.stringify(knowledge_json || {}, null, 2), 'utf-8');
  await query(
    `INSERT INTO hub_vendor_knowledge(supplier_slug, category, knowledge_md, knowledge_json, generated_by, version, updated_at)
     VALUES($1,$2,$3,$4,$5,1,now())
     ON CONFLICT (supplier_slug) DO UPDATE SET
       category=EXCLUDED.category,
       knowledge_md=EXCLUDED.knowledge_md,
       knowledge_json=EXCLUDED.knowledge_json,
       generated_by=EXCLUDED.generated_by,
       version=hub_vendor_knowledge.version+1,
       updated_at=now()`,
    [slug, category, knowledge_md, knowledge_json || {}, generated_by]
  );
  return { stored: 'canonical', generated_by };
};

export const setPendingUpdate = async (slug, proposed) => {
  await query(
    `UPDATE hub_vendor_knowledge SET pending_update=$1, updated_at=now() WHERE supplier_slug=$2`,
    [proposed, slug]
  );
};

export const applyPendingUpdate = async (slug) => {
  const v = await loadVendorKnowledge(slug);
  if (!v?.pending_update) return null;
  await saveVendorKnowledge(slug, {
    category: v.pending_update.category || v.category,
    knowledge_md: v.pending_update.knowledge_md || v.knowledge_md,
    knowledge_json: v.pending_update.knowledge_json || v.knowledge_json,
    generated_by: 'llm_update',
    force: true,
  });
  await query(`UPDATE hub_vendor_knowledge SET pending_update=NULL WHERE supplier_slug=$1`, [slug]);
  return loadVendorKnowledge(slug);
};
