import './styles/base.css';
import { config } from './config.js';

// ── Layout ─────────────────────────────────────────────────────────────────
import './components/layout/tos-header.js';
import './components/layout/tos-footer.js';
import './components/layout/tos-hero.js';
import './components/layout/tos-section-title.js';

// ── Search ─────────────────────────────────────────────────────────────────
import './components/search/tos-search-bar.js';
import './components/search/tos-search-results.js';

// ── Hotels ─────────────────────────────────────────────────────────────────
import './components/hotels/tos-hotel-card.js';
import './components/hotels/tos-hotel-carousel.js';
import './components/hotels/tos-hotel-detail.js';

// ── Experiences ────────────────────────────────────────────────────────────
import './components/experiences/tos-experience-card.js';
import './components/experiences/tos-experience-carousel.js';
import './components/experiences/tos-experience-detail.js';

// ── POIs ───────────────────────────────────────────────────────────────────
import './components/pois/tos-poi-card.js';
import './components/pois/tos-poi-grid.js';

// ── Booking ────────────────────────────────────────────────────────────────
import './components/booking/tos-booking-form.js';
import './components/booking/tos-booking-confirmation.js';

// Phase 6 — Agent chat
import './components/agent/tos-agent-chat.js';

// Phase 9b — Trip planner
// import './components/trip-planner/tos-trip-dashboard.js';

// ── Branding ───────────────────────────────────────────────────────────────
function applyBranding() {
  const { primaryColor, fontFamily } = config.branding;
  const root = document.documentElement;
  if (primaryColor) root.style.setProperty('--tos-primary', primaryColor);
  if (fontFamily)   root.style.setProperty('--tos-font',    fontFamily);
}

window.addEventListener('tos:auth-expired', () => {
  console.warn('[TOS] Auth token expired');
});

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  applyBranding();
  const root = document.getElementById('tos-root');
  if (!root) { console.error('[TOS] #tos-root not found'); return; }

  if (config.preview) {
    // Component preview mode — renders a single component with real catalog data
    const tag = config.preview;
    root.innerHTML = `
      <div style="padding:24px;background:#F9FAFB;min-height:100vh;max-width:480px">
        <div style="font-family:monospace;font-size:11px;color:#9CA3AF;margin-bottom:16px">
          &lt;${tag}&gt;
        </div>
        <div id="preview-slot"></div>
      </div>`;

    const slot = root.querySelector('#preview-slot');
    const el = document.createElement(tag);
    slot.appendChild(el);

    // For card/detail components — inject real catalog data
    const isCard = tag.includes('card') || tag.includes('detail') || tag.includes('carousel') || tag.includes('grid');
    if (isCard) {
      try {
        const r = await fetch(`${config.apiBase}/v1/catalog/collections/home`);
        if (r.ok) {
          const data = await r.json();
          const items = [
            ...(data.experiences || []),
            ...(data.hotels || []),
            ...(data.transfers || []),
          ];
          if (items.length && typeof el.setData === 'function') {
            el.setData(items[0]);
          } else if (items.length && tag.includes('carousel')) {
            // carousels get the full list
            if (typeof el.setItems === 'function') el.setItems(items);
          }
        }
      } catch { /* catalog unavailable — component shows its own skeleton */ }
    }
  } else if (config.pageSlug) {
    const { TravelShellRenderer } = await import('./shell/TravelShellRenderer.js');
    TravelShellRenderer.render(config.pageSlug, root);
  } else {
    const { Router } = await import('./shell/router.js');
    Router.init(root);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

window.TOS = {
  version: '1.0.0',
  config,
  navigate(path) {
    window.dispatchEvent(new CustomEvent('tos:navigate', { detail: { path } }));
  },
};
