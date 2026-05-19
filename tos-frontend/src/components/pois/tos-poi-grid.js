import { TosElement } from '../base.js';
import { pois } from '../../api/catalog.js';

class TosPoiGrid extends TosElement {
  mount() {
    const limit = parseInt(this.getAttribute('limit') || '8', 10);
    const dest  = this.getAttribute('destination') || '';
    this.fetch(() => pois({ limit, destination: dest || undefined }));
  }

  loadingTemplate() {
    return `<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      ${Array.from({ length: 8 }, () =>
        `<div class="tos-skeleton rounded-card h-32"></div>`
      ).join('')}
    </div>`;
  }

  template() {
    const items = this._data?.pois || [];
    if (!items.length) {
      return `<div class="py-8 text-center text-text-secondary text-sm col-span-4">No attractions found</div>`;
    }
    return `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        ${items.map(item => `<tos-poi-card data-id="${item.id}"></tos-poi-card>`).join('')}
      </div>`;
  }

  update() {
    super.update();
    if (this._data && !this._loading) {
      const items = this._data?.pois || [];
      this.querySelectorAll('tos-poi-card').forEach((el, i) => {
        if (items[i]) el.setData(items[i]);
      });
    }
  }
}

customElements.define('tos-poi-grid', TosPoiGrid);
