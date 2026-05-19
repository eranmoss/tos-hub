import { imgOrPlaceholder, firstImage, locationLabel } from '../base.js';

class TosPoiCard extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', () => {
      if (this._item?.id) {
        window.dispatchEvent(new CustomEvent('tos:navigate', {
          detail: { path: `/product/${this._item.id}` }
        }));
      }
    });
    if (this._item) this._render(this._item);
  }

  setData(item) {
    this._item = item;
    if (this.isConnected) this._render(item);
  }

  _render(item) {
    const image    = firstImage(item);
    const location = locationLabel(item);

    this.innerHTML = `
      <div class="tos-card overflow-hidden hover:shadow-md transition-shadow cursor-pointer group">
        <div class="relative h-32 overflow-hidden">
          ${imgOrPlaceholder(image, item.title)}
          <div class="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
          <div class="absolute bottom-2 left-2 right-2">
            <p class="text-white font-medium text-sm leading-tight
                       overflow-hidden" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">
              ${item.title || 'Point of Interest'}
            </p>
            ${location ? `<p class="text-white/70 text-xs mt-0.5">${location}</p>` : ''}
          </div>
        </div>
      </div>`;
  }
}

customElements.define('tos-poi-card', TosPoiCard);
