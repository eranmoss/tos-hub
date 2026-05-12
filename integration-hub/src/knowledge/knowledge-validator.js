import Anthropic from '@anthropic-ai/sdk';
import { loadVendorKnowledge } from './vendor-knowledge.js';

let _client = null;
const getLLM = () => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
};

// Pass 2: validate generated knowledge against an actual probe sample.
// Returns { confirmed: [...], discrepancies: [...] } so the user can
// see whether the knowledge file describes reality.
export const validateKnowledgeAgainstSample = async ({ slug, sample }) => {
  const v = await loadVendorKnowledge(slug);
  if (!v) return { ok: false, reason: 'no knowledge for vendor' };
  const client = getLLM();
  if (!client) return { ok: true, confirmed: [], discrepancies: [], note: 'LLM unavailable, skipping' };

  const prompt = `You are validating a vendor knowledge file against a fresh sample API response.

VENDOR KNOWLEDGE (structured):
\`\`\`json
${JSON.stringify(v.knowledge_json, null, 2)}
\`\`\`

FRESH SAMPLE RESPONSE:
\`\`\`json
${JSON.stringify(sample, null, 2).slice(0, 6000)}
\`\`\`

For each claim in the knowledge JSON, decide:
- "confirmed" — the sample matches the claim
- "contradicted" — the sample shows otherwise
- "unknown" — sample doesn't show enough to judge

Respond with JSON ONLY:
{
  "confirmed": [{"claim": "id_field=external_id", "evidence": "..."}],
  "discrepancies": [{"claim": "...", "actual": "...", "suggested_update": "..."}]
}`;

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content?.[0]?.text || '';
    const clean = text.replace(/```(?:json)?/g, '').trim();
    return { ok: true, ...JSON.parse(clean) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
