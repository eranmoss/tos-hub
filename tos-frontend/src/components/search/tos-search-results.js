import { TosElement } from '../base.js';
import { browse, search } from '../../api/catalog.js';

/**
 * <tos-search-results>
 * Attributes:
 *   query  — text search query
 *   type   — HOTEL | EXPERIENCE | TRANSFER (blank = all)
 *   dest   — destination filter
 *   sort   — rating | price | reviews | recent
 *   limit  — max results (default 20)
 */
class TosSearchResults extends TosElement {
  static get observedAttributes() {
    return ['query', 'type', 'dest', 'sort', 'limit'];
  }

  attributeChangedCallback() {
    if (this.isConnected) this.mount();
  }

  mount() {
    const q     = this.getAttribute('query') || '';
    const type  = this.getAttribute('type')  || '';
    const dest  = this.getAttribute('dest')  || '';
    const sort  = this.getAttribute('sort')  || 'rating';
    const limit = parseInt(this.getAttribute('limit') || '20', 10);

    if (q) {
      this.fetch(() => search(q, { type: type || undefined, destination: dest || undefined, limit }));
    } else {
      this.fetch(() => browse({ type: type || undefined, destination: dest || undefined, sort, limit }));
    }
  }

  loadingTemplate() {
    return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      ${Array.from({ length: 8 }, () =>
        `<div class="tos-skeleton rounded-card h-72"></div>`
      ).join('')}
    </div>`;
  }

  template() {
    const items = this._data?.results || [];
    if (!items.length) {
      return `<div class="py-16 text-center">
        <p class="text-4xl mb-3">🔍</p>
        <p class="text-text-secondary">No results found. Try a different search.</p>
      </div>`;
    }

    const type = this.getAttribute('type') || '';

    return `
      <p class="text-sm text-text-secondary mb-4">${items.length} result${items.length !== 1 ? 's' : ''}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        ${items.map(item => {
          const tag = item.type === 'HOTEL' || type === 'HOTEL'
            ? `<tos-hotel-card data-id="${item.id}"></tos-hotel-card>`
            : `<tos-experience-card data-id="${item.id}"></tos-experience-card>`;
          return `<div>${tag}</div>`;
        }).join('')}
      </div>`;
  }

  update() {
    super.update();
    if (this._data && !this._loading) {
      const items = this._data?.results || [];
      this.querySelectorAll('tos-hotel-card').forEach((el, i) => {
        const match = items.filter(x => x.type === 'HOTEL')[i];
        if (match) el.setData(match);
      });
      this.querySelectorAll('tos-experience-card').forEach((el, i) => {
        const match = items.filter(x => x.type !== 'HOTEL')[i];
        if (match) el.setData(match);
      });
    }
  }
}

customElements.define('tos-search-results', TosSearchResults);
