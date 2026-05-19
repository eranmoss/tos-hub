/**
 * TOS Frontend — Express host reference implementation.
 *
 * Shows the minimal contract an Express app must satisfy to embed
 * the TOS Frontend bundle on any page.
 *
 * Setup:
 *   npm install express dotenv
 *   cp .env.example .env   # fill in your values
 *   node server.js         # http://localhost:4000
 */

import 'dotenv/config';
import express from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Config pulled from environment ────────────────────────────────────────────
const TOS_API_BASE = process.env.TOS_API_BASE || 'http://localhost:3000';
const TOS_API_KEY  = process.env.TOS_API_KEY  || '';
const TOS_TENANT   = process.env.TOS_TENANT_ID || '';

const BRANDING = {
  primaryColor: process.env.TOS_PRIMARY_COLOR || '#0D3B6E',
  logoUrl:      process.env.TOS_LOGO_URL      || null,
  fontFamily:   process.env.TOS_FONT_FAMILY   || 'Inter',
};

// ── Serve the TOS bundle from your static directory ──────────────────────────
app.use('/static', express.static(join(__dirname, 'public')));

// ── Helper: build TOS_CONFIG object ──────────────────────────────────────────
function tosConfig({ pageSlug = null, authToken = null } = {}) {
  return {
    apiBase:  TOS_API_BASE,
    tenantId: TOS_TENANT,
    pageSlug,
    branding: BRANDING,
    auth: { token: authToken || TOS_API_KEY || null },
  };
}

// ── Inline HTML builder (no template engine required) ────────────────────────
function renderPage({ title = 'TOS Travel', config, bodyContent = '' }) {
  const configJson = JSON.stringify(config);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <script>window.TOS_CONFIG = ${configJson};</script>
</head>
<body>
  ${bodyContent}
  <div id="tos-root"></div>
  <script src="/static/tos-frontend.js"></script>
</body>
</html>`;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// Full-site router mode — TOS Frontend manages all /travel/* routing
app.get('/travel*', (req, res) => {
  res.send(renderPage({
    title: 'TOS Travel',
    config: tosConfig(),
  }));
});

// Single-page manifest mode — load named page from hub
app.get('/destinations', (req, res) => {
  res.send(renderPage({
    title: 'Destinations',
    config: tosConfig({ pageSlug: 'home' }),
  }));
});

// Dynamic manifest per city
app.get('/destinations/:city', (req, res) => {
  const slug = `city-${req.params.city.toLowerCase().replace(/\s+/g, '-')}`;
  res.send(renderPage({
    title: `${req.params.city} — Travel`,
    config: tosConfig({ pageSlug: slug }),
  }));
});

// Embed inside a larger page (partial embed example)
app.get('/book', (req, res) => {
  const { productId } = req.query;
  const bodyContent = `
    <header style="padding:16px;background:#0D3B6E;color:white">
      <a href="/" style="color:white;text-decoration:none">My Brand</a>
    </header>`;

  res.send(renderPage({
    title: 'Book Now',
    config: tosConfig({ pageSlug: null }),   // router mode, deep-link via JS
    bodyContent,
  }));
});

// Optional: intercept TOS navigation server-side (for SSR pre-rendering)
// This is only needed for SEO — the bundle handles routing client-side.

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[TOS Host] Express server running at http://localhost:${PORT}`);
});
