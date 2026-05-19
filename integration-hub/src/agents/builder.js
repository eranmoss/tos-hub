import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/client.js';

const MODEL = 'claude-sonnet-4-6';

let client = null;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
};

const loadComponents = async () => {
  const { rows } = await query(
    `SELECT name, category, description, schema, datasource_bindings
     FROM hub_component_registry ORDER BY category, name`,
  );
  return rows;
};

const loadManifest = async (tenantId, slugOrId) => {
  if (!slugOrId) return null;
  const { rows } = await query(
    `SELECT manifest FROM hub_page_manifests
     WHERE tenant_id = $1 AND (slug = $2 OR id::text = $2) AND is_active = true
     LIMIT 1`,
    [tenantId, slugOrId],
  );
  return rows[0]?.manifest || null;
};

const buildSystemPrompt = (components, currentManifest) => {
  const componentDocs = components.map(c => {
    const attrs = c.schema?.attrs?.length
      ? `  attrs: ${c.schema.attrs.join(', ')}`
      : '  attrs: (none)';
    const ds = c.datasource_bindings?.api
      ? `  data: ${c.datasource_bindings.api}`
      : '';
    return `- **${c.name}** [${c.category}]: ${c.description || ''}\n${attrs}${ds ? '\n' + ds : ''}`;
  }).join('\n');

  const currentJson = currentManifest
    ? JSON.stringify(currentManifest, null, 2)
    : '(no existing manifest — create a new one)';

  return `You are the TOS Page Builder Agent.
You help partners compose travel pages using Web Components from the TOS Frontend library.

## Available Components
${componentDocs}

## Manifest Format
Return a JSON object that strictly follows this schema:
\`\`\`json
{
  "layout": "default",
  "sections": [
    {
      "component": "<component-name>",
      "attrs": { "<attr-name>": "<value>" }
    }
  ]
}
\`\`\`

Rules:
- Only use components listed above — never invent component names
- "attrs" must only contain attributes declared in each component's "attrs" list
- The first section is almost always "tos-hero" for a home page
- Pages should always start with "tos-header" and end with "tos-footer" — these are automatically injected by the renderer, do NOT include them in sections
- Omit attrs that are empty or not needed
- Return ONLY the raw JSON object — no markdown, no commentary, no code fences

## Current Manifest
${currentJson}

## Your Task
Given the partner's natural language request, generate a complete updated manifest.
Preserve sections the user does not ask to change.
For new or changed sections, choose the most appropriate component and attrs.
If the user asks to explain what was changed, append an "explanation" field at the top level:
{ "layout": "...", "sections": [...], "explanation": "..." }`;
};

/**
 * Run the builder agent with a natural language prompt.
 *
 * @param {{ tenantId: string, prompt: string, pageSlugOrId?: string }} params
 * @returns {{ manifest: object, explanation: string }}
 */
export async function runBuilder({ tenantId, prompt, pageSlugOrId }) {
  const [components, currentManifest] = await Promise.all([
    loadComponents(),
    pageSlugOrId ? loadManifest(tenantId, pageSlugOrId) : Promise.resolve(null),
  ]);

  const systemPrompt = buildSystemPrompt(components, currentManifest);

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0]?.text?.trim() || '';

  let parsed;
  try {
    // Strip accidental markdown fences if the model wraps output
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`Builder agent returned invalid JSON.\n\nRaw response:\n${raw}`);
  }

  if (!Array.isArray(parsed.sections)) {
    throw new Error('Builder agent response missing "sections" array.');
  }

  const explanation = parsed.explanation || '';
  const manifest = { layout: parsed.layout || 'default', sections: parsed.sections };

  return { manifest, explanation };
}
