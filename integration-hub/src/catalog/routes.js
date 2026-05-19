import express from 'express';
import { pipeline } from '@xenova/transformers';
import { query } from '../db/client.js';
import { runLifecycleStep } from '../lifecycle/router.js';

let embedder = null;
const getEmbedder = async () => {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
};

const embedQuery = async (text) => {
  const model = await getEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
};

const SELECT_FIELDS = `
  si.id, si.supplier_slug, si.supplier_raw_ref, si.type, si.title, si.description,
  si.latitude, si.longitude, si.city, si.country, si.timezone, si.category,
  si.duration_minutes, si.vehicle_class, si.star_rating,
  si.image_urls, si.amenities, si.meal_plans,
  si.route_origin, si.route_destination,
  si.price_from, si.price_currency, si.rating, si.review_count,
  si.is_event
`;

const SELECT_FIELDS_PLAIN = `
  id, supplier_slug, supplier_raw_ref, type, title, description,
  latitude, longitude, city, country, timezone, category,
  duration_minutes, vehicle_class, star_rating,
  image_urls, amenities, meal_plans,
  route_origin, route_destination,
  price_from, price_currency, rating, review_count,
  is_event
`;

const resolveCategory = async (category) => {
  if (!category) return null;
  const { rows } = await query(
    `SELECT supplier_cat_id FROM hub_category_mappings WHERE canonical_cat_id = $1 LIMIT 50`,
    [category],
  );
  return rows.length > 0 ? rows.map(r => r.supplier_cat_id) : null;
};

const enrichCategory = (row) => {
  if (!row) return row;
  return row;
};

export const buildCatalogRouter = () => {
  const r = express.Router();

  r.get('/v1/catalog/browse', async (req, res) => {
    try {
      const {
        type, city, category, supplier,
        sort = 'rating', limit = 20, page = 1,
      } = req.query;

      const pageNum = Math.max(1, parseInt(page));
      const lim = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * lim;

      const conditions = ['si.is_active = true', 'si.canonical_id IS NULL'];
      const params = [];
      let idx = 1;

      if (type) {
        conditions.push(`si.type = $${idx}`);
        params.push(type.toUpperCase());
        idx++;
      }
      if (city) {
        conditions.push(`si.city ILIKE $${idx}`);
        params.push(`%${city}%`);
        idx++;
      }
      if (category) {
        const catIds = await resolveCategory(category);
        if (catIds) {
          conditions.push(`si.category = ANY($${idx})`);
          params.push(catIds);
        } else {
          conditions.push(`si.category ILIKE $${idx}`);
          params.push(`%${category}%`);
        }
        idx++;
      }
      if (supplier) {
        conditions.push(`si.supplier_slug = $${idx}`);
        params.push(supplier);
        idx++;
      }

      const where = conditions.join(' AND ');

      const orderMap = {
        rating: 'si.rating DESC NULLS LAST, si.review_count DESC NULLS LAST',
        price: 'si.price_from ASC NULLS LAST',
        reviews: 'si.review_count DESC NULLS LAST',
        recent: 'si.last_synced_at DESC NULLS LAST',
      };
      const orderBy = orderMap[sort] || orderMap.rating;

      const countRes = await query(
        `SELECT COUNT(*)::int AS total FROM hub_static_inventory si WHERE ${where}`,
        params,
      );
      const total = countRes.rows[0].total;

      const rows = await query(
        `SELECT ${SELECT_FIELDS}, si.raw_content,
                cm.canonical_cat_id AS category_id,
                cm.supplier_cat_name AS category_name
         FROM hub_static_inventory si
         LEFT JOIN hub_category_mappings cm
           ON cm.supplier_slug = si.supplier_slug AND cm.supplier_cat_id = si.category
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, lim, offset],
      );

      res.json({
        results: rows.rows,
        total,
        page: pageNum,
        pages: Math.ceil(total / lim),
        limit: lim,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/v1/catalog/search', async (req, res) => {
    try {
      const {
        q, type, city, category, supplier,
        min_score = 0.30, limit = 20, page = 1,
      } = req.query;

      const pageNum = Math.max(1, parseInt(page));
      const lim = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * lim;

      if (!q) {
        return res.status(400).json({ error: 'q parameter is required' });
      }

      const t0 = Date.now();
      const vec = await embedQuery(q);
      const embedMs = Date.now() - t0;
      const vecStr = `[${vec.join(',')}]`;

      const conditions = [
        'si.is_active = true',
        'si.canonical_id IS NULL',
        'si.embedding IS NOT NULL',
        `1 - (si.embedding <=> $1) >= $2`,
      ];
      const params = [vecStr, parseFloat(min_score)];
      let idx = 3;

      if (type) {
        conditions.push(`si.type = $${idx}`);
        params.push(type.toUpperCase());
        idx++;
      }

      if (city) {
        conditions.push(`si.city ILIKE $${idx}`);
        params.push(`%${city}%`);
        idx++;
      }

      if (category) {
        const catIds = await resolveCategory(category);
        if (catIds) {
          conditions.push(`si.category = ANY($${idx})`);
          params.push(catIds);
        } else {
          conditions.push(`si.category ILIKE $${idx}`);
          params.push(`%${category}%`);
        }
        idx++;
      }

      if (supplier) {
        conditions.push(`si.supplier_slug = $${idx}`);
        params.push(supplier);
        idx++;
      }

      const where = conditions.join(' AND ');

      const t1 = Date.now();
      const countRes = await query(
        `SELECT COUNT(*)::int AS total FROM hub_static_inventory si WHERE ${where}`,
        params,
      );
      const total = countRes.rows[0].total;

      const rows = await query(
        `SELECT ${SELECT_FIELDS}, si.raw_content,
                cm.canonical_cat_id AS category_id,
                cm.supplier_cat_name AS category_name,
                1 - (si.embedding <=> $1) AS score
         FROM hub_static_inventory si
         LEFT JOIN hub_category_mappings cm
           ON cm.supplier_slug = si.supplier_slug AND cm.supplier_cat_id = si.category
         WHERE ${where}
         ORDER BY si.embedding <=> $1
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, lim, offset],
      );
      const searchMs = Date.now() - t1;

      res.json({
        results: rows.rows.map(r => ({
          ...r,
          score: parseFloat(r.score.toFixed(4)),
        })),
        total,
        page: pageNum,
        pages: Math.ceil(total / lim),
        limit: lim,
        query_embedding_ms: embedMs,
        search_ms: searchMs,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/v1/catalog/cities', async (req, res) => {
    try {
      const { type } = req.query;
      const conditions = ['is_active = true', 'canonical_id IS NULL', 'city IS NOT NULL'];
      const params = [];
      if (type) {
        conditions.push(`type = $1`);
        params.push(type.toUpperCase());
      }
      const { rows } = await query(
        `SELECT city, COUNT(*)::int AS count
         FROM hub_static_inventory
         WHERE ${conditions.join(' AND ')}
         GROUP BY city
         ORDER BY count DESC`,
        params,
      );
      res.json({ cities: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/v1/catalog/categories', async (req, res) => {
    try {
      const { type } = req.query;
      const conditions = ['si.is_active = true', 'si.canonical_id IS NULL', 'si.category IS NOT NULL'];
      const params = [];
      if (type) {
        conditions.push(`si.type = $1`);
        params.push(type.toUpperCase());
      }
      const { rows } = await query(
        `SELECT
           COALESCE(cm.canonical_cat_id, si.category) AS id,
           COALESCE(cm.supplier_cat_name, si.category) AS name,
           cc.parent_id,
           cc.level,
           COUNT(*)::int AS count
         FROM hub_static_inventory si
         LEFT JOIN hub_category_mappings cm
           ON cm.supplier_slug = si.supplier_slug AND cm.supplier_cat_id = si.category
         LEFT JOIN hub_canonical_categories cc
           ON cc.id = COALESCE(cm.canonical_cat_id, si.category)
         WHERE ${conditions.join(' AND ')}
           AND COALESCE(cc.level, 0) >= 0
         GROUP BY COALESCE(cm.canonical_cat_id, si.category),
                  COALESCE(cm.supplier_cat_name, si.category),
                  cc.parent_id, cc.level
         ORDER BY count DESC`,
        params,
      );
      res.json({ categories: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/v1/catalog/transfer-points', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || q.length < 2) return res.json({ points: [] });

      const like = `%${q}%`;
      const exact = q.trim().toUpperCase();
      const points = [];

      const { rows: terminals } = await query(`
        SELECT title, city, country, route_origin
        FROM hub_static_inventory
        WHERE type = 'TRANSFER'
          AND supplier_raw_ref LIKE 'TRM-%'
          AND is_active = true
          AND route_origin IS NOT NULL
          AND (title ILIKE $1 OR city ILIKE $1 OR route_origin = $2)
        ORDER BY CASE WHEN route_origin = $2 THEN 0 ELSE 1 END, city
        LIMIT 20
      `, [like, exact]);

      const seenCodes = new Set();
      terminals.forEach(r => {
        if (!seenCodes.has(r.route_origin)) {
          seenCodes.add(r.route_origin);
          const city = r.city || '';
          const title = r.title || '';
          const label = (city && city !== title) ? title + ', ' + city : title;
          points.push({
            label: label || r.route_origin,
            code: r.route_origin,
            codeType: 'IATA',
            city: r.city || null,
            country: r.country || null,
          });
        }
      });

      const { rows: hotels } = await query(`
        SELECT title, city, country, supplier_raw_ref
        FROM hub_static_inventory
        WHERE type = 'HOTEL'
          AND supplier_slug = 'hotelbeds-hotels'
          AND is_active = true
          AND (title ILIKE $1 OR city ILIKE $1)
        ORDER BY city, title
        LIMIT 10
      `, [like]);

      hotels.forEach(r => {
        const city = r.city || '';
        const title = r.title || '';
        const label = (city && !title.toUpperCase().includes(city.toUpperCase()))
          ? title + ', ' + city : title;
        points.push({
          label: label || r.supplier_raw_ref,
          code: r.supplier_raw_ref,
          codeType: 'ATLAS',
          city: r.city || null,
          country: r.country || null,
        });
      });

      res.json({ points: points.slice(0, 12) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Points of interest — canonical attraction registry
  r.get('/v1/catalog/pois', async (req, res) => {
    try {
      const { city, destination, category, limit = 24, offset = 0 } = req.query;
      const cityFilter = city || destination;
      const conditions = [];
      const params = [];

      if (cityFilter) {
        conditions.push(`city ILIKE $${params.length + 1}`);
        params.push(`%${cityFilter}%`);
      }
      if (category) {
        conditions.push(`category_id = $${params.length + 1}`);
        params.push(category);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await query(
        `SELECT id, name, display_name, city, country, latitude, longitude,
                category_id, description, image_url, experience_count
         FROM hub_global_pois
         ${where}
         ORDER BY experience_count DESC, confidence DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, Number(limit), Number(offset)],
      );

      const [{ count }] = (await query(
        `SELECT COUNT(*)::int AS count FROM hub_global_pois ${where}`,
        params,
      )).rows;

      res.json({ pois: rows, total: count });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/v1/catalog/:id', async (req, res) => {
    try {
      const item = await query(
        `SELECT ${SELECT_FIELDS_PLAIN}, raw_content,
                cm.canonical_cat_id AS category_id,
                cm.supplier_cat_name AS category_name
         FROM hub_static_inventory
         LEFT JOIN hub_category_mappings cm
           ON cm.supplier_slug = hub_static_inventory.supplier_slug
           AND cm.supplier_cat_id = hub_static_inventory.category
         WHERE hub_static_inventory.id = $1 AND hub_static_inventory.is_active = true`,
        [req.params.id],
      );
      if (!item.rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(item.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const resolveDefaultTenant = async (supplierSlug) => {
    if (supplierSlug) {
      const t = await query(
        `SELECT cm.tenant_id FROM hub_credentials_map cm
         WHERE cm.supplier_slug = $1 AND cm.credentials_encrypted IS NOT NULL
         LIMIT 1`,
        [supplierSlug],
      );
      if (t.rows[0]) return t.rows[0].tenant_id;
    }
    const t = await query(
      `SELECT tenant_id FROM hub_tenants ORDER BY tenant_id LIMIT 1`
    );
    return t.rows[0]?.tenant_id || null;
  };

  r.post('/v1/catalog/transfer-search', async (req, res) => {
    try {
      const tenantId = await resolveDefaultTenant('hotelbeds-transfers');
      if (!tenantId) return res.status(500).json({ error: 'no tenant configured' });

      const result = await runLifecycleStep({
        tenantId,
        slug: 'hotelbeds-transfers',
        step: 'availability',
        rawRef: null,
        rawContent: null,
        payload: req.body || {},
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.post('/v1/catalog/:id/availability', async (req, res) => {
    try {
      const inv = await query(
        `SELECT id, supplier_slug, supplier_raw_ref, raw_content
         FROM hub_static_inventory WHERE id = $1 AND is_active = true`,
        [req.params.id],
      );
      if (!inv.rows[0]) return res.status(404).json({ error: 'item not found' });
      const row = inv.rows[0];
      const tenantId = await resolveDefaultTenant(row.supplier_slug);
      if (!tenantId) return res.status(500).json({ error: 'no tenant configured' });

      const result = await runLifecycleStep({
        tenantId,
        slug: row.supplier_slug,
        step: 'availability',
        rawRef: row.supplier_raw_ref,
        rawContent: row.raw_content,
        payload: req.body || {},
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.post('/v1/catalog/:id/book', async (req, res) => {
    console.log('[DEBUG book] req.body:', JSON.stringify(req.body), 'content-type:', req.headers['content-type']);
    try {
      const inv = await query(
        `SELECT id, supplier_slug, supplier_raw_ref, raw_content
         FROM hub_static_inventory WHERE id = $1 AND is_active = true`,
        [req.params.id],
      );
      if (!inv.rows[0]) return res.status(404).json({ error: 'item not found' });
      const row = inv.rows[0];
      const tenantId = await resolveDefaultTenant(row.supplier_slug);
      if (!tenantId) return res.status(500).json({ error: 'no tenant configured' });

      const result = await runLifecycleStep({
        tenantId,
        slug: row.supplier_slug,
        step: 'book',
        rawRef: row.supplier_raw_ref,
        rawContent: row.raw_content,
        payload: req.body || {},
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Semantic search — natural language query, vector-ranked results
  r.post('/v1/catalog/query', async (req, res) => {
    try {
      const {
        q,
        type, city, category, supplier,
        limit = 20, page = 1,
      } = req.body || {};

      if (!q) return res.status(400).json({ error: 'q (query text) is required' });

      const pageNum = Math.max(1, parseInt(page));
      const lim = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * lim;

      const t0 = Date.now();
      const vec = await embedQuery(q);
      const embedMs = Date.now() - t0;
      const vecStr = `[${vec.join(',')}]`;

      const conditions = [
        'si.is_active = true',
        'si.canonical_id IS NULL',
        'si.embedding IS NOT NULL',
        `1 - (si.embedding <=> $1) >= 0.25`,
      ];
      const params = [vecStr];
      let idx = 2;

      if (type) {
        conditions.push(`si.type = $${idx}`);
        params.push(type.toUpperCase());
        idx++;
      }
      if (city) {
        conditions.push(`si.city ILIKE $${idx}`);
        params.push(`%${city}%`);
        idx++;
      }
      if (category) {
        const catIds = await resolveCategory(category);
        if (catIds) {
          conditions.push(`si.category = ANY($${idx})`);
          params.push(catIds);
        } else {
          conditions.push(`si.category ILIKE $${idx}`);
          params.push(`%${category}%`);
        }
        idx++;
      }
      if (supplier) {
        conditions.push(`si.supplier_slug = $${idx}`);
        params.push(supplier);
        idx++;
      }

      const where = conditions.join(' AND ');

      const countRes = await query(
        `SELECT COUNT(*)::int AS total FROM hub_static_inventory si WHERE ${where}`,
        params,
      );
      const total = countRes.rows[0].total;

      const rows = await query(
        `SELECT ${SELECT_FIELDS},
                cm.canonical_cat_id AS category_id,
                cm.supplier_cat_name AS category_name,
                1 - (si.embedding <=> $1) AS relevance
         FROM hub_static_inventory si
         LEFT JOIN hub_category_mappings cm
           ON cm.supplier_slug = si.supplier_slug AND cm.supplier_cat_id = si.category
         WHERE ${where}
         ORDER BY si.embedding <=> $1
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, lim, offset],
      );
      const searchMs = Date.now() - t0 - embedMs;

      res.json({
        results: rows.rows.map(r => ({
          ...r,
          relevance: parseFloat(parseFloat(r.relevance).toFixed(4)),
          is_event: r.is_event || false,
        })),
        total,
        page: pageNum,
        pages: Math.ceil(total / lim),
        limit: lim,
        meta: {
          query: q,
          embedding_ms: embedMs,
          search_ms: searchMs,
        },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get all occurrences for an event (all records sharing same title + city + supplier)
  r.get('/v1/catalog/:id/occurrences', async (req, res) => {
    try {
      const item = await query(
        `SELECT id, title, city, supplier_slug, is_event
         FROM hub_static_inventory WHERE id = $1 AND is_active = true`,
        [req.params.id],
      );
      if (!item.rows[0]) return res.status(404).json({ error: 'not found' });
      const { title, city, supplier_slug, is_event } = item.rows[0];

      if (!is_event) {
        return res.json({ occurrences: [], is_event: false, message: 'not an event item' });
      }

      const { rows } = await query(
        `SELECT id, supplier_raw_ref, raw_content->>'bridgify_uuid' AS bridgify_uuid
         FROM hub_static_inventory
         WHERE title = $1 AND city = $2 AND supplier_slug = $3 AND is_active = true
         ORDER BY supplier_raw_ref`,
        [title, city, supplier_slug],
      );

      res.json({
        is_event: true,
        canonical_id: req.params.id,
        title,
        city,
        supplier: supplier_slug,
        occurrence_count: rows.length,
        occurrences: rows,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Batch availability check — given item IDs + date range, return which are available
  r.post('/v1/catalog/availability', async (req, res) => {
    try {
      const { ids, date_from, date_to } = req.body || {};
      if (!ids?.length) return res.status(400).json({ error: 'ids array is required' });
      if (!date_from || !date_to) return res.status(400).json({ error: 'date_from and date_to are required' });

      const capped = ids.slice(0, 20);

      const { rows } = await query(
        `SELECT id, supplier_slug, supplier_raw_ref, raw_content, is_event
         FROM hub_static_inventory
         WHERE id = ANY($1) AND is_active = true`,
        [capped],
      );

      const checks = rows.map(async (item) => {
        try {
          const tenantId = await resolveDefaultTenant(item.supplier_slug);
          if (!tenantId) return { id: item.id, available: null, error: 'no tenant' };
          const result = await runLifecycleStep({
            tenantId,
            slug: item.supplier_slug,
            step: 'availability',
            rawRef: item.supplier_raw_ref,
            rawContent: item.raw_content,
            payload: { date_from, date_to },
          });
          const slots = result?.data?.slots || result?.data?.data?.slots || [];
          return {
            id: item.id,
            available: result?.ok && slots.length > 0,
            slot_count: slots.length,
            slots: slots.slice(0, 10),
          };
        } catch (e) {
          return { id: item.id, available: null, error: e.message };
        }
      });

      const results = await Promise.all(checks);

      res.json({
        date_from,
        date_to,
        checked: results.length,
        results,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Home page collection carousels — curated featured items per type
  r.get('/v1/catalog/collections/home', async (req, res) => {
    try {
      const LIMIT = 8;

      const [hotels, experiences, transfers] = await Promise.all([
        query(
          `SELECT ${SELECT_FIELDS_PLAIN}
           FROM hub_static_inventory
           WHERE type = 'HOTEL' AND is_active = true AND canonical_id IS NULL
           ORDER BY rating DESC NULLS LAST, review_count DESC NULLS LAST, last_synced_at DESC NULLS LAST
           LIMIT $1`,
          [LIMIT],
        ),
        query(
          `SELECT ${SELECT_FIELDS_PLAIN}
           FROM hub_static_inventory
           WHERE type = 'EXPERIENCE' AND is_active = true AND canonical_id IS NULL
           ORDER BY rating DESC NULLS LAST, review_count DESC NULLS LAST
           LIMIT $1`,
          [LIMIT],
        ),
        query(
          `SELECT ${SELECT_FIELDS_PLAIN}
           FROM hub_static_inventory
           WHERE type = 'TRANSFER' AND is_active = true AND canonical_id IS NULL
           ORDER BY RANDOM()
           LIMIT $1`,
          [LIMIT],
        ),
      ]);

      res.json({
        sections: [
          { id: 'featured-hotels',      title: 'Popular Hotels',      type: 'HOTEL',      items: hotels.rows },
          { id: 'top-experiences',      title: 'Top Experiences',     type: 'EXPERIENCE', items: experiences.rows },
          { id: 'available-transfers',  title: 'Airport Transfers',   type: 'TRANSFER',   items: transfers.rows },
        ],
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return r;
};
