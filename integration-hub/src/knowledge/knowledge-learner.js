import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/client.js';
import { loadVendorKnowledge, setPendingUpdate, saveVendorKnowledge } from './vendor-knowledge.js';
import { loadCategoryKnowledge, saveCategoryKnowledge } from './category-knowledge.js';

let _client = null;
const getLLM = () => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
};

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

export const recordEvent = async ({ supplierSlug, tenantId, eventType, payload }) => {
  const r = await query(
    `INSERT INTO hub_knowledge_events(supplier_slug, tenant_id, event_type, payload)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [supplierSlug, tenantId || null, eventType, payload || {}]
  );
  return r.rows[0]?.id;
};

const callLLM = async (prompt, maxTokens = 2000) => {
  const client = getLLM();
  if (!client) return null;
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content?.[0]?.text || '';
  } catch (e) {
    return null;
  }
};

// Pass 3a: vendor knowledge — process a single event into a proposed update.
export const processEvent = async (eventId) => {
  const r = await query(`SELECT * FROM hub_knowledge_events WHERE id=$1`, [eventId]);
  const ev = r.rows[0];
  if (!ev || ev.status !== 'PENDING') return null;

  const v = await loadVendorKnowledge(ev.supplier_slug);
  if (!v) {
    await query(`UPDATE hub_knowledge_events SET status='DISMISSED' WHERE id=$1`, [eventId]);
    return { dismissed: 'no vendor knowledge yet' };
  }

  const prompt = `You maintain a vendor knowledge file. A new event has occurred. Decide whether the knowledge needs an update.

CURRENT KNOWLEDGE (structured):
\`\`\`json
${JSON.stringify(v.knowledge_json, null, 2)}
\`\`\`

CURRENT KNOWLEDGE (markdown):
${v.knowledge_md}

EVENT (${ev.event_type}):
\`\`\`json
${JSON.stringify(ev.payload, null, 2).slice(0, 4000)}
\`\`\`

Respond with JSON ONLY. If no update needed, return {"update": false, "reason": "..."}.
Otherwise:
{
  "update": true,
  "knowledge_json": { ... full updated json ... },
  "knowledge_md": "... full updated markdown ...",
  "summary": "one short sentence describing the change"
}`;

  const text = await callLLM(prompt, 3000);
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text.replace(/```(?:json)?/g, '').trim()); } catch { return null; }

  if (!parsed.update) {
    await query(`UPDATE hub_knowledge_events SET status='DISMISSED', proposed_update=$1 WHERE id=$2`,
      [{ reason: parsed.reason }, eventId]);
    return parsed;
  }

  await setPendingUpdate(ev.supplier_slug, {
    knowledge_json: parsed.knowledge_json,
    knowledge_md: parsed.knowledge_md,
    summary: parsed.summary,
    event_id: eventId,
  });
  await query(`UPDATE hub_knowledge_events SET proposed_update=$1 WHERE id=$2`,
    [{ summary: parsed.summary }, eventId]);
  log('info', 'knowledge_update_proposed', { slug: ev.supplier_slug, event_id: eventId });
  return parsed;
};

// Pass 3b: category knowledge — distil patterns common to N+ vendors in the category.
export const distilCategoryPatterns = async (category) => {
  const r = await query(
    `SELECT supplier_slug, knowledge_md, knowledge_json FROM hub_vendor_knowledge WHERE category=$1`,
    [category]
  );
  if (r.rows.length < 2) return { skipped: 'need ≥2 vendors in category' };

  const cat = await loadCategoryKnowledge(category);
  const prompt = `Distil cross-vendor patterns for the ${category} category from these vendor knowledge files.
Keep what is true for the majority. Drop vendor-specific quirks.

EXISTING CATEGORY KNOWLEDGE:
${cat?.knowledge_md || '(none)'}

VENDORS (${r.rows.length}):
${r.rows.map((v) => `### ${v.supplier_slug}\n${JSON.stringify(v.knowledge_json, null, 2).slice(0, 1200)}`).join('\n\n')}

Respond with two parts separated by markers:

---JSON---
{ "common_auth_types": [...], "common_response_envelopes": [...], "common_id_fields": [...], "required_search_params": [...], "common_errors": [...] }
---MARKDOWN---
# ${category} — Category Integration Patterns
...`;

  const text = await callLLM(prompt, 3000);
  if (!text) return null;
  const jsonMatch = text.match(/---JSON---\s*([\s\S]*?)\s*---MARKDOWN---/);
  const mdMatch = text.match(/---MARKDOWN---\s*([\s\S]*)$/);
  let json = {};
  try { if (jsonMatch) json = JSON.parse(jsonMatch[1].trim()); } catch {}
  const md = mdMatch ? mdMatch[1].trim() : null;
  if (!md) return null;
  await saveCategoryKnowledge(category, {
    knowledge_md: md,
    knowledge_json: json,
    source_vendors: r.rows.map((v) => v.supplier_slug),
  });
  log('info', 'category_knowledge_distilled', { category, source_count: r.rows.length });
  return { ok: true, category, source_count: r.rows.length };
};
