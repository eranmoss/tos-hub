import { config } from '../config.js';
import { getPage } from '../api/pages.js';

/**
 * Travel Shell Renderer — Phase 4.
 *
 * Fetches a JSON page manifest from the Integration Hub and assembles
 * the declared Web Components into the host root element.
 *
 * Manifest schema:
 * {
 *   "layout": "default",          // optional wrapper hint
 *   "sections": [
 *     {
 *       "component": "tos-hero",
 *       "attrs": { "headline": "...", "subheading": "..." }
 *     },
 *     {
 *       "component": "tos-hotel-carousel",
 *       "attrs": { "city": "Tel Aviv", "limit": "6" }
 *     }
 *   ]
 * }
 */
export const TravelShellRenderer = {
  async render(pageSlug, rootEl) {
    if (!rootEl) return;

    rootEl.innerHTML = `
      <tos-header></tos-header>
      <main class="min-h-screen bg-page-bg">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <p class="text-text-secondary text-sm animate-pulse">Loading page…</p>
        </div>
      </main>
      <tos-footer></tos-footer>`;

    let manifest;
    try {
      manifest = await getPage(pageSlug);
    } catch (err) {
      rootEl.innerHTML = `
        <tos-header></tos-header>
        <main class="min-h-screen bg-page-bg flex items-center justify-center">
          <div class="text-center px-4">
            <p class="text-4xl mb-4">⚠️</p>
            <p class="text-text-secondary">Could not load page "${pageSlug}"</p>
            <p class="text-xs text-border-default mt-2">${err.message}</p>
          </div>
        </main>
        <tos-footer></tos-footer>`;
      return;
    }

    if (!manifest?.sections?.length) {
      rootEl.innerHTML = `
        <tos-header></tos-header>
        <main class="min-h-screen bg-page-bg flex items-center justify-center">
          <p class="text-text-secondary">Page has no sections.</p>
        </main>
        <tos-footer></tos-footer>`;
      return;
    }

    const sectionHtml = manifest.sections.map(section => {
      const { component, attrs = {} } = section;
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
        .join(' ');
      return `<${component} ${attrStr}></${component}>`;
    }).join('\n        ');

    rootEl.innerHTML = `
      <tos-header></tos-header>
      <main class="min-h-screen bg-page-bg">
        ${sectionHtml}
      </main>
      <tos-footer></tos-footer>`;
  },
};
