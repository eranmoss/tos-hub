import Anthropic from '@anthropic-ai/sdk';
import { loadCategoryKnowledge } from './category-knowledge.js';
import { findSimilarVendors, saveVendorKnowledge } from './vendor-knowledge.js';

let _client = null;
const getLLM = () => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
};

const callLLM = async (prompt) => {
  const client = getLLM();
  if (!client) return null;
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content?.[0]?.text || '';
  } catch (e) {
    return { _error: e.message };
  }
};

const parseStructured = (text) => {
  // Expect: "---JSON---\n{...}\n---MARKDOWN---\n# ...".
  const jsonMatch = text.match(/---JSON---\s*([\s\S]*?)\s*---MARKDOWN---/);
  const mdMatch = text.match(/---MARKDOWN---\s*([\s\S]*)$/);
  let json = {};
  if (jsonMatch) {
    try { json = JSON.parse(jsonMatch[1].trim()); } catch {}
  }
  const md = mdMatch ? mdMatch[1].trim() : text.trim();
  return { json, md };
};

// Pass 1: generate vendor knowledge from manifest + sample probe + validation report.
export const generateVendorKnowledge = async ({ manifest, sample, validationReport }) => {
  const slug = manifest.supplier?.slug;
  const category = manifest.cts_mapping?.type_value || 'UNKNOWN';
  const cat = await loadCategoryKnowledge(category);
  const similar = await findSimilarVendors({ category, authType: manifest.auth?.type, excludeSlug: slug, limit: 2 });

  const prompt = `You are a travel-API integration expert. Distil what was just learned during a successful onboarding into a vendor knowledge file.

Output two parts, separated by markers exactly as shown:

---JSON---
{
  "auth_type": "...",
  "response_envelope": "e.g. attractions[]",
  "id_field": "external_id",
  "trailing_slash_required": true,
  "pagination": { "style": "limit_offset", "default_limit": 50 },
  "required_search_params": ["..."],
  "common_errors": [{ "symptom": "...", "cause": "..." }],
  "notes": "one short sentence"
}
---MARKDOWN---
# <slug> — Integration Notes
category: <CATEGORY> · auth: <TYPE> · first_onboarded: <ISO date>

## Auth quirks
- ...

## Response shape
- ...

## Gotchas
- ...

INPUT — manifest:
\`\`\`json
${JSON.stringify(manifest, null, 2).slice(0, 6000)}
\`\`\`

INPUT — sample probe response (first item only):
\`\`\`json
${JSON.stringify(sample, null, 2).slice(0, 4000)}
\`\`\`

INPUT — validation report:
\`\`\`json
${JSON.stringify(validationReport || {}, null, 2).slice(0, 2500)}
\`\`\`

INPUT — category baseline knowledge:
${cat?.knowledge_md?.slice(0, 2500) || '(none)'}

INPUT — similar vendors (${similar.length}):
${similar.map((s) => `- ${s.supplier_slug}: ${JSON.stringify(s.knowledge_json).slice(0, 400)}`).join('\n') || '(none)'}

Rules:
- Be concrete and specific. Cite field names and endpoint patterns from the actual sample.
- Do not invent quirks not supported by the inputs.
- Markdown should be ≤ 50 lines.`;

  const text = await callLLM(prompt);
  if (!text || typeof text !== 'string') return { ok: false, error: text?._error || 'llm unavailable' };
  const { json, md } = parseStructured(text);
  await saveVendorKnowledge(slug, { category, knowledge_md: md, knowledge_json: json, generated_by: 'llm' });
  return { ok: true, slug, category, knowledge_json: json };
};
