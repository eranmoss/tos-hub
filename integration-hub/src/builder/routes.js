import express from 'express';
import { query } from '../db/client.js';
import { jwtAuth } from '../middleware/jwt-auth.js';
import { runBuilder } from '../agents/builder.js';

export function buildBuilderRouter() {
  const router = express.Router();
  router.use(jwtAuth);

  const tid = (req) => req.dashboardTenant.tenant_id;

  // GET /v1/builder/state — current manifest + component registry for a page
  router.get('/v1/builder/state', async (req, res) => {
    try {
      const { slug } = req.query;
      const [compRows, pageRows, allPages] = await Promise.all([
        query(`SELECT name, category, description, schema, datasource_bindings
               FROM hub_component_registry ORDER BY category, name`),
        slug
          ? query(
              `SELECT id, slug, title, manifest FROM hub_page_manifests
               WHERE tenant_id = $1 AND (slug = $2 OR id::text = $2) AND is_active = true LIMIT 1`,
              [tid(req), slug],
            )
          : Promise.resolve({ rows: [] }),
        query(
          `SELECT id, slug, title, updated_at FROM hub_page_manifests
           WHERE tenant_id = $1 AND is_active = true ORDER BY updated_at DESC`,
          [tid(req)],
        ),
      ]);

      res.json({
        components: compRows.rows,
        current_page: pageRows.rows[0] || null,
        pages: allPages.rows,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /v1/builder/prompt — NL prompt → suggested manifest
  router.post('/v1/builder/prompt', async (req, res) => {
    try {
      const { prompt, page_slug } = req.body;
      if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });

      const result = await runBuilder({
        tenantId: tid(req),
        prompt,
        pageSlugOrId: page_slug || null,
      });

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /v1/builder/apply — save a manifest to the DB
  router.post('/v1/builder/apply', async (req, res) => {
    try {
      const { page_id, page_slug, title, manifest } = req.body;
      if (!Array.isArray(manifest?.sections)) return res.status(400).json({ error: 'manifest.sections must be an array' });

      if (page_id) {
        // Update existing
        const { rows } = await query(
          `UPDATE hub_page_manifests
           SET manifest = $1, title = COALESCE($2, title), updated_at = now()
           WHERE tenant_id = $3 AND (id::text = $4 OR slug = $4)
           RETURNING *`,
          [JSON.stringify(manifest), title || null, tid(req), page_id],
        );
        if (!rows.length) return res.status(404).json({ error: 'page not found' });
        return res.json(rows[0]);
      }

      // Create new
      if (!page_slug || !title) {
        return res.status(400).json({ error: 'page_slug and title required for new pages' });
      }
      const { rows } = await query(
        `INSERT INTO hub_page_manifests (tenant_id, slug, title, manifest)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [tid(req), page_slug, title, JSON.stringify(manifest)],
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'slug already exists' });
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
