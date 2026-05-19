import { TosElement } from '../base.js';
import { browse } from '../../api/catalog.js';

class TosExperienceCarousel extends TosElement {
  mount() {
    const limit = parseInt(this.getAttribute('limit') || '8', 10);
    const city  = this.getAttribute('city') || '';
    const sort  = this.getAttribute('sort') || 'rating';

    this.fetch(() => browse({
      type: 'EXPERIENCE',
      limit,
      sort,
      city: city || undefined,
    }));
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
      return `<div class="py-8 text-center text-text-secondary text-sm">No experiences found</div>`;
    }

    return `
      <div class="tos-carousel-track py-1">
        ${items.map(item => `
          <div style="width:280px">
            <tos-experience-card data-id="${item.id}"></tos-experience-card>
          </div>`).join('')}
      </div>`;
  }

  update() {
    super.update();
    if (this._data && !this._loading) {
      const items = this._data?.results || [];
      this.querySelectorAll('tos-experience-card').forEach((el, i) => {
        if (items[i]) el.setData(items[i]);
      });
    }
  }
}

customElements.define('tos-experience-carousel', TosExperienceCarousel);
