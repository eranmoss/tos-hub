import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATEGORIES_DIR = path.resolve(__dirname, '../../config/categories');

const safeReadFile = async (p) => {
  try { return await readFile(p, 'utf-8'); } catch { return null; }
};

const loadFromDisk = async (category) => {
  const md = await safeReadFile(path.join(CATEGORIES_DIR, `${category}.md`));
  const jsonText = await safeReadFile(path.join(CATEGORIES_DIR, `${category}.json`));
  let json = {};
  try { if (jsonText) json = JSON.parse(jsonText); } catch {}
  return md ? { knowledge_md: md, knowledge_json: json } : null;
};

export const loadCategoryKnowledge = async (category) => {
  if (!category) return null;
  const r = await query(
    `SELECT knowledge_md, knowledge_json, version, updated_at FROM hub_category_knowledge WHERE category=$1`,
    [category]
  );
  if (r.rows[0]) return r.rows[0];
  // Fallback to seed file on disk.
  const disk = await loadFromDisk(category);
  if (disk) {
    await query(
      `INSERT INTO hub_category_knowledge(category, knowledge_md, knowledge_json)
       VALUES($1,$2,$3) ON CONFLICT (category) DO NOTHING`,
      [category, disk.knowledge_md, disk.knowledge_json]
    );
    return { ...disk, version: 1, updated_at: new Date() };
  }
  return null;
};

export const saveCategoryKnowledge = async (category, { knowledge_md, knowledge_json, source_vendors }) => {
  await mkdir(CATEGORIES_DIR, { recursive: true });
  await writeFile(path.join(CATEGORIES_DIR, `${category}.md`), knowledge_md, 'utf-8');
  await writeFile(path.join(CATEGORIES_DIR, `${category}.json`), JSON.stringify(knowledge_json || {}, null, 2), 'utf-8');
  await query(
    `INSERT INTO hub_category_knowledge(category, knowledge_md, knowledge_json, source_vendors, version, updated_at)
     VALUES($1,$2,$3,$4,1,now())
     ON CONFLICT (category) DO UPDATE SET
       knowledge_md=EXCLUDED.knowledge_md,
       knowledge_json=EXCLUDED.knowledge_json,
       source_vendors=EXCLUDED.source_vendors,
       version=hub_category_knowledge.version+1,
       updated_at=now()`,
    [category, knowledge_md, knowledge_json || {}, source_vendors || []]
  );
};

export const ensureSeeded = async () => {
  for (const category of ['HOTEL', 'EXPERIENCE', 'TRANSFER', 'FLIGHT', 'RAIL']) {
    if (!existsSync(path.join(CATEGORIES_DIR, `${category}.md`))) continue;
    await loadCategoryKnowledge(category);
  }
};
