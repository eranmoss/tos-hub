import express from 'express';
import { createReadStream, writeFileSync, mkdirSync, existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/client.js';
import { jwtAuth } from '../middleware/jwt-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to tos-frontend from integration-hub/src/builder/
const TOS_FRONTEND_ROOT = process.env.TOS_FRONTEND_DIR
  || path.resolve(__dirname, '../../../tos-frontend');
const COMPONENTS_ROOT = path.join(TOS_FRONTEND_ROOT, 'src', 'components');
const INDEX_PATH      = path.join(TOS_FRONTEND_ROOT, 'src', 'index.js');

let aiClient = null;
const getAI = () => {
  if (!aiClient) aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return aiClient;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const toPascalCase = (s) =>
  s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');

const toCamelCase = (s) =>
  s.split('-').map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');

function generateCode({ name, attrs = [], hasDataFetch = false, datasource = '', templateHtml = '' }) {
  const className  = toPascalCase(name);
  const attrList   = attrs.filter(Boolean);
  const observedStr = attrList.map(a => `'${a}'`).join(', ');
  const attrVars   = attrList.length
    ? attrList.map(a => `    const ${toCamelCase(a)} = this.getAttribute('${a}') || '';`).join('\n') + '\n'
    : '';

  const safeHtml = (templateHtml || `<div class="tos-card p-4">\n  <!-- ${name} -->\n</div>`)
    .replace(/`/g, '\\`');

  if (hasDataFetch) {
    return `import { TosElement } from '../base.js';

class ${className} extends TosElement {${attrList.length ? `
  static get observedAttributes() { return [${observedStr}]; }
  attributeChangedCallback() { this.update(); }
` : ''}
  mount() {
    this.fetch(async () => {
      const { config } = await import('../../config.js');
      const r = await fetch(\`\${config.apiBase}${datasource || '/v1/catalog'}\`);
      if (!r.ok) throw new Error('Failed to load data');
      return r.json();
    });
  }

  template() {
    const data = this._data;
${attrVars}    return \`${safeHtml}\`;
  }
}

customElements.define('${name}', ${className});
`;
  }

  return `class ${className} extends HTMLElement {${attrList.length ? `
  static get observedAttributes() { return [${observedStr}]; }
  attributeChangedCallback() { this._render(); }
` : ''}
  connectedCallback() { this._render(); }

  _render() {
${attrVars}    this.innerHTML = \`${safeHtml}\`;
  }
}

customElements.define('${name}', ${className});
`;
}

async function addImportToIndex(category, name) {
  const importLine = `import './components/${category}/${name}.js';`;
  let content = await readFile(INDEX_PATH, 'utf-8');
  if (content.includes(importLine)) return;

  const title = category.charAt(0).toUpperCase() + category.slice(1);
  const dashes = '─'.repeat(Math.max(0, 74 - title.length));

  // Find section block: header line + any import lines immediately after
  const sectionRe = new RegExp(
    `(// ── ${title}[^\\n]*\\n(?:import '\\./components/${category}/[^\\n]*\\n)*)`, 'i',
  );
  const match = sectionRe.exec(content);

  if (match) {
    const insertAt = match.index + match[0].length;
    content = content.slice(0, insertAt) + importLine + '\n' + content.slice(insertAt);
  } else {
    // Insert a new section before Phase comments or branding section
    const insertBefore = ['\n// Phase 9b', '\n// ── Branding']
      .map(m => content.indexOf(m))
      .find(i => i > 0) ?? content.length;
    const newSection = `\n// ── ${title} ${dashes}\n${importLine}`;
    content = content.slice(0, insertBefore) + newSection + content.slice(insertBefore);
  }

  await writeFile(INDEX_PATH, content, 'utf-8');
}

// ── Router ────────────────────────────────────────────────────────────────────

export function buildComponentRouter() {
  const router = express.Router();
  router.use(jwtAuth);

  // GET /v1/builder/components — all components (incl. inactive) with page usage
  router.get('/v1/builder/components', async (req, res) => {
    try {
      const tenantId = req.dashboardTenant.tenant_id;
      const { rows } = await query(
        `SELECT
           c.id, c.name, c.category, c.description, c.schema, c.datasource_bindings,
           c.template_html, c.has_data_fetch, c.is_active, c.thumbnail_url,
           COALESCE(u.pages, '[]'::jsonb) AS used_in_pages,
           COALESCE(u.usage_count, 0)     AS usage_count
         FROM hub_component_registry c
         LEFT JOIN LATERAL (
           SELECT
             jsonb_agg(jsonb_build_object('slug', p.slug, 'title', p.title)) AS pages,
             COUNT(*)::int AS usage_count
           FROM hub_page_manifests p
           WHERE p.tenant_id = $1
             AND p.manifest::text LIKE '%' || c.name || '%'
         ) u ON true
         ORDER BY c.category, c.name`,
        [tenantId],
      );
      res.json({ components: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /v1/builder/components/generate — AI generates the template HTML
  router.post('/v1/builder/components/generate', async (req, res) => {
    try {
      const { name, category, description, attrs = [], has_data_fetch = false, datasource = '' } = req.body;
      if (!name || !category) return res.status(400).json({ error: 'name and category required' });

      const attrList  = attrs.filter(Boolean);
      const attrVars  = attrList.map(a => `${toCamelCase(a)} (from attr "${a}")`).join(', ');
      const dataNote  = has_data_fetch
        ? `\nThe component fetches data from ${datasource || '/v1/catalog'}. Use \${data.propertyName} to reference fetched fields.`
        : '';

      const systemPrompt = `You are a TOS Web Component HTML template generator.
Generate the inner HTML string body for a TOS travel Web Component.

This HTML will be placed inside a JavaScript template literal in the _render() / template() method.
Available JS variables: ${attrVars || '(none)'}${dataNote}

TOS design system:
- tos-card: white card with border and shadow (rounded-card)
- tos-btn-primary: accent blue button
- tos-btn-secondary: white bordered button
- tos-badge, tos-badge-success, tos-badge-warning, tos-badge-danger: status badges
- tos-skeleton: animate-pulse skeleton
- Tailwind: text-text-primary (#111827), text-text-secondary (#6B7280), bg-page-bg (#F9FAFB)
- Accent: #1A56A0, Primary: #0D3B6E

Use \${varName} to interpolate variables. Keep HTML clean and semantic.
Return ONLY the raw HTML — no JS, no backticks, no markdown fences.`;

      const message = await getAI().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Generate a template for: ${name}\nCategory: ${category}\nDescription: ${description || name}` }],
      });

      const template_html = message.content[0]?.text?.trim() || '';
      res.json({ template_html });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /v1/builder/components — create new component
  router.post('/v1/builder/components', async (req, res) => {
    try {
      const { name, category, description, attrs = [], has_data_fetch = false, datasource = '', template_html = '' } = req.body;

      if (!name || !category) return res.status(400).json({ error: 'name and category required' });
      if (!/^tos-[a-z][a-z0-9-]*$/.test(name)) {
        return res.status(400).json({ error: 'name must start with "tos-" and be kebab-case' });
      }

      const attrList = attrs.filter(Boolean);
      const code = generateCode({ name, attrs: attrList, hasDataFetch: has_data_fetch, datasource, templateHtml: template_html });

      // Write the JS file
      const dir = path.join(COMPONENTS_ROOT, category);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${name}.js`), code, 'utf-8');

      // Update index.js
      if (existsSync(INDEX_PATH)) await addImportToIndex(category, name);

      // Upsert registry
      const { rows } = await query(
        `INSERT INTO hub_component_registry
           (name, category, description, schema, datasource_bindings, template_html, has_data_fetch)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (name) DO UPDATE SET
           category             = EXCLUDED.category,
           description          = EXCLUDED.description,
           schema               = EXCLUDED.schema,
           datasource_bindings  = EXCLUDED.datasource_bindings,
           template_html        = EXCLUDED.template_html,
           has_data_fetch       = EXCLUDED.has_data_fetch,
           is_active            = true
         RETURNING *`,
        [
          name, category, description || null,
          JSON.stringify({ attrs: attrList }),
          datasource ? JSON.stringify({ api: datasource }) : null,
          template_html || null,
          !!has_data_fetch,
        ],
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /v1/builder/components/:name — update existing component
  router.put('/v1/builder/components/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const { category, description, attrs = [], has_data_fetch = false, datasource = '', template_html = '' } = req.body;

      const { rows: existing } = await query(
        `SELECT * FROM hub_component_registry WHERE name = $1`, [name],
      );
      if (!existing.length) return res.status(404).json({ error: 'component not found' });

      const attrList  = attrs.filter(Boolean);
      const finalCat  = category || existing[0].category;
      const code = generateCode({ name, attrs: attrList, hasDataFetch: has_data_fetch, datasource, templateHtml: template_html });

      const dir = path.join(COMPONENTS_ROOT, finalCat);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${name}.js`), code, 'utf-8');

      if (existsSync(INDEX_PATH)) await addImportToIndex(finalCat, name);

      const { rows } = await query(
        `UPDATE hub_component_registry SET
           category            = $2,
           description         = $3,
           schema              = $4,
           datasource_bindings = $5,
           template_html       = $6,
           has_data_fetch      = $7,
           is_active           = true
         WHERE name = $1
         RETURNING *`,
        [
          name, finalCat, description ?? existing[0].description,
          JSON.stringify({ attrs: attrList }),
          datasource ? JSON.stringify({ api: datasource }) : null,
          template_html || null,
          !!has_data_fetch,
        ],
      );
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /v1/builder/components/:name/source — overwrite the JS file on disk
  router.put('/v1/builder/components/:name/source', async (req, res) => {
    try {
      const { source } = req.body;
      if (typeof source !== 'string') return res.status(400).json({ error: 'source string required' });

      const { rows } = await query(
        `SELECT category FROM hub_component_registry WHERE name = $1`, [req.params.name],
      );
      if (!rows.length) return res.status(404).json({ error: 'component not found' });

      const filePath = path.join(COMPONENTS_ROOT, rows[0].category, `${req.params.name}.js`);
      writeFileSync(filePath, source, 'utf-8');
      res.json({ saved: true, path: filePath.replace(TOS_FRONTEND_ROOT, 'tos-frontend') });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /v1/builder/components/:name/source — read the actual JS file from disk
  router.get('/v1/builder/components/:name/source', async (req, res) => {
    try {
      const { rows } = await query(
        `SELECT category FROM hub_component_registry WHERE name = $1`, [req.params.name],
      );
      if (!rows.length) return res.status(404).json({ error: 'component not found' });

      const filePath = path.join(COMPONENTS_ROOT, rows[0].category, `${req.params.name}.js`);
      if (!existsSync(filePath)) {
        return res.json({ source: null, path: filePath });
      }
      const source = await readFile(filePath, 'utf-8');
      res.json({ source, path: filePath.replace(TOS_FRONTEND_ROOT, 'tos-frontend') });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /v1/builder/components/:name — soft delete (marks inactive, keeps file)
  router.delete('/v1/builder/components/:name', async (req, res) => {
    try {
      const { rows } = await query(
        `UPDATE hub_component_registry SET is_active = false WHERE name = $1 RETURNING name`,
        [req.params.name],
      );
      if (!rows.length) return res.status(404).json({ error: 'component not found' });
      res.json({ deleted: rows[0].name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
