/**
 * TosElement — base class for all TOS Web Components.
 *
 * Pattern:
 *  - No Shadow DOM → Tailwind classes work globally
 *  - Event delegation via data-action attributes → survives innerHTML re-renders
 *  - this.fetch(fn) handles loading / error state automatically
 *  - this.emit(name, detail) dispatches bubbling custom events
 */
export class TosElement extends HTMLElement {
  constructor() {
    super();
    this._loading = false;
    this._error   = null;
    this._data    = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connectedCallback() {
    this._clickHandler = (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) this.handleAction(btn.dataset.action, btn.dataset, e);
    };
    this.addEventListener('click', this._clickHandler);
    this.mount();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._clickHandler);
    this.unmount();
  }

  /** Override to run logic on first connect (e.g. fetch data). */
  mount()   { this.update(); }
  /** Override for cleanup on disconnect. */
  unmount() {}

  // ── Rendering ─────────────────────────────────────────────────────────────

  update() {
    if (this._loading) { this.innerHTML = this.loadingTemplate(); return; }
    if (this._error)   { this.innerHTML = this.errorTemplate();   return; }
    this.innerHTML = this.template();
  }

  /** Main content template — override in subclass. */
  template() { return ''; }

  loadingTemplate() {
    const rows = parseInt(this.getAttribute('skeleton-rows') || '1', 10);
    return Array.from({ length: rows }, () =>
      `<div class="tos-skeleton h-48 w-full rounded-card mb-3"></div>`
    ).join('');
  }

  errorTemplate() {
    return `
      <div class="flex flex-col items-center justify-center py-12 text-center px-4">
        <div class="text-4xl mb-3">⚠️</div>
        <p class="text-text-secondary text-sm mb-4">${this._error || 'Something went wrong'}</p>
        <button class="tos-btn-secondary text-sm" data-action="retry">Try again</button>
      </div>`;
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  /** Wraps an async fn with loading/error state and triggers re-render. */
  async fetch(fn) {
    this._loading = true;
    this._error   = null;
    this.update();
    try {
      this._data = await fn();
    } catch (e) {
      this._error = e.message || 'Failed to load data';
    } finally {
      this._loading = false;
      this.update();
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /** Dispatch a bubbling custom event (crosses component boundaries). */
  emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  /** Override to handle data-action clicks. */
  handleAction(action, dataset, _e) {
    if (action === 'retry') this.mount();
    if (action === 'navigate') {
      this.emit('tos:navigate', { path: dataset.path });
      window.dispatchEvent(new CustomEvent('tos:navigate', { detail: { path: dataset.path } }));
    }
  }
}

// ── Shared template helpers ────────────────────────────────────────────────

/** Render 1–5 filled/empty stars from a numeric rating. */
export function renderStars(rating) {
  if (!rating) return '<span class="text-text-secondary text-xs">No rating</span>';
  const full  = Math.floor(rating);
  const empty = 5 - full;
  const stars = '★'.repeat(full) + '☆'.repeat(empty);
  return `<span class="text-amber-400 text-sm">${stars}</span>`;
}

/** Format a price value as currency string. */
export function formatPrice(amount, currency = 'USD') {
  if (!amount && amount !== 0) return '<span class="text-text-secondary text-sm">Price on request</span>';
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(amount);
  return `<span class="text-xl font-bold text-text-primary">${formatted}</span>`;
}

/** Shorten a string with an ellipsis. */
export function truncate(str, max = 60) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max).trimEnd() + '…' : str;
}

/** Return a gradient placeholder when no image is available. */
export function imgOrPlaceholder(url, alt = '') {
  if (url) return `<img src="${url}" alt="${alt}" class="w-full h-full object-cover" loading="lazy" />`;
  return `<div class="w-full h-full bg-gradient-to-br from-primary/20 to-accent/30 flex items-center justify-center">
    <span class="text-4xl opacity-40">🏖️</span>
  </div>`;
}

const HOTELBEDS_CDN = 'https://photos.hotelbeds.com/giata/';

/** Resolve a raw image path to a full URL (handles HotelBeds relative paths). */
export function resolveImageUrl(raw) {
  if (!raw) return null;
  const url = raw?.url || raw;
  if (typeof url !== 'string') return null;
  return url.startsWith('http') ? url : HOTELBEDS_CDN + url;
}

/** Resolve the first image URL from a CTS product's images array. */
export function firstImage(item) {
  // Catalog returns image_urls: string[]; detail may return images: {url}[]
  const src = item?.image_urls?.[0] || item?.images?.[0];
  return resolveImageUrl(src);
}

/** Resolve a readable location string from a CTS product. */
export function locationLabel(item) {
  // Catalog returns flat city/country; some wrappers nest under location
  const city    = item?.city    || item?.location?.city;
  const country = item?.country || item?.location?.country;
  return [city, country].filter(Boolean).join(', ');
}
