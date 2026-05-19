import { TosElement } from '../base.js';
import { browse } from '../../api/catalog.js';

class TosHotelCarousel extends TosElement {
  mount() {
    const limit = parseInt(this.getAttribute('limit') || '8', 10);
    const sort  = this.getAttribute('sort') || 'rating';
    const dest  = this.getAttribute('destination') || '';

    this.fetch(() => browse({ type: 'HOTEL', limit, sort, destination: dest || undefined }));
  }

  loadingTemplate() {
    return `<div class="tos-carousel-track py-1">
      ${Array.from({ length: 4 }, () =>
        `<div class="tos-skeleton rounded-card flex-shrink-0" style="width:280px;height:320px"></div>`
      ).join('')}
    </div>`;
  }

  template() {
    const items = this._data?.results || [];
    if (!items.length) {
      return `<div class="py-8 text-center text-text-secondary text-sm">No hotels found</div>`;
    }

    return `
      <div class="tos-carousel-track py-1">
        ${items.map(item => `
          <div style="width:280px">
            <tos-hotel-card data-id="${item.id}"></tos-hotel-card>
          </div>`).join('')}
      </div>`;
  }

  // After rendering, inject data into each card (avoids N+1 API calls)
  update() {
    super.update();
    if (this._data && !this._loading) {
      const items = this._data?.results || [];
      this.querySelectorAll('tos-hotel-card').forEach((el, i) => {
        if (items[i]) el.setData(items[i]);
      });
    }
  }
}

customElements.define('tos-hotel-carousel', TosHotelCarousel);
