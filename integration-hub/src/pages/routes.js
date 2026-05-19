import express from 'express';
import { query } from '../db/client.js';
import { jwtAuth } from '../middleware/jwt-auth.js';

export function buildPagesRouter() {
  const router = express.Router();

  // ── Component registry (public — TOS Frontend needs this at boot) ──────────
  router.get('/v1/components', async (_req, res) => {
    try {
      const { rows } = await query(
        `SELECT id, name, category, description, schema, datasource_bindings, thumbnail_url
         FROM hub_component_registry
         ORDER BY category, name`,
      );
      res.json({ components: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Page manifests (JWT auth — Partner Dashboard manages these) ─────────────
  router.use('/v1/pages', jwtAuth);

  router.get('/v1/pages', async (req, res) => {
    try {
      const tenantId = req.dashboardTenant.tenant_id;
      const { rows } = await query(
        `SELECT id, slug, title, is_active, created_at, updated_at
         FROM hub_page_manifests
         WHERE tenant_id = $1
         ORDER BY updated_at DESC`,
        [tenantId],
      );
      res.json({ pages: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/v1/pages/:slugOrId', async (req, res) => {
    try {
      const tenantId = req.dashboardTenant.tenant_id;
      const key = req.params.slugOrId;
      const { rows } = await query(
        `SELECT * FROM hub_page_manifests
         WHERE tenant_id = $1 AND (slug = $2 OR id::text = $2)
         LIMIT 1`,
        [tenantId, key],
      );
      if (!rows.length) return res.status(404).json({ error: 'page not found' });
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/v1/pages', async (req, res) => {
    try {
      const tenantId = req.dashboardTenant.tenant_id;
      const { slug, title, manifest } = req.body;
      if (!slug || !title || !manifest) {
        return res.status(400).json({ error: 'slug, title, and manifest are required' });
      }
      const { rows } = await query(
        `INSERT INTO hub_page_manifests (tenant_id, slug, title, manifest)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [tenantId, slug, title, JSON.stringify(manifest)],
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'slug already exists for this tenant' });
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/v1/pages/:slugOrId', async (req, res) => {
    try {
      const tenantId = req.dashboardTenant.tenant_id;
      const key = req.params.slugOrId;
      const { title, manifest, is_active } = req.body;

      const setClauses = [];
      const vals = [tenantId, key];
      let idx = 3;

      if (title     !== undefined) { setClauses.push(`title = $${idx++}`);      vals.push(title); }
      if (manifest  !== undefined) { setClauses.push(`manifest = $${idx++}`);   vals.push(JSON.stringify(manifest)); }
      if (is_active !== undefined) { setClauses.push(`is_active = $${idx++}`);  vals.push(is_active); }

      if (!setClauses.length) return res.status(400).json({ error: 'nothing to update' });
      setClauses.push(`updated_at = now()`);

      const { rows } = await query(
        `UPDATE hub_page_manifests
         SET ${setClauses.join(', ')}
         WHERE tenant_id = $1 AND (slug = $2 OR id::text = $2)
         RETURNING *`,
        vals,
      );
      if (!rows.length) return res.status(404).json({ error: 'page not found' });
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/v1/pages/:slugOrId', async (req, res) => {
    try {
      const tenantId = req.dashboardTenant.tenant_id;
      const key = req.params.slugOrId;
      const { rowCount } = await query(
        `DELETE FROM hub_page_manifests
         WHERE tenant_id = $1 AND (slug = $2 OR id::text = $2)`,
        [tenantId, key],
      );
      if (!rowCount) return res.status(404).json({ error: 'page not found' });
      res.sendStatus(204);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Public slug endpoint — used by TravelShellRenderer (no auth, tenant from query param)
  router.get('/v1/pages-public/:slug', async (req, res) => {
    try {
      const { tenant_id } = req.query;
      if (!tenant_id) return res.status(400).json({ error: 'tenant_id query param required' });
      const { rows } = await query(
        `SELECT manifest FROM hub_page_manifests
         WHERE tenant_id = $1 AND slug = $2 AND is_active = true
         LIMIT 1`,
        [tenant_id, req.params.slug],
      );
      if (!rows.length) return res.status(404).json({ error: 'page not found' });
      res.json(rows[0].manifest);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
