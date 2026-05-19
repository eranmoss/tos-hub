import { TosElement, renderStars, formatPrice, truncate, imgOrPlaceholder, firstImage, locationLabel } from '../base.js';

class TosExperienceCard extends HTMLElement {
  connectedCallback() {
    if (this._item) {
      this._render(this._item);
    } else if (this.getAttribute('product-id')) {
      this._fetchAndRender();
    }

    this.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id || this.getAttribute('product-id');
      if (btn.dataset.action === 'detail') {
        window.dispatchEvent(new CustomEvent('tos:navigate', { detail: { path: `/product/${id}` } }));
      }
      if (btn.dataset.action === 'book') {
        window.dispatchEvent(new CustomEvent('tos:navigate', { detail: { path: `/book/${id}` } }));
      }
    });
  }

  setData(item) {
    this._item = item;
    if (this.isConnected) this._render(item);
  }

  async _fetchAndRender() {
    const { detail } = await import('../../api/catalog.js');
    this.innerHTML = `<div class="tos-skeleton h-64 rounded-card"></div>`;
    try {
      const item = await detail(this.getAttribute('product-id'));
      this._render(item);
    } catch {
      this.innerHTML = `<div class="tos-card p-4 text-center text-text-secondary text-sm">Unable to load</div>`;
    }
  }

  _render(item) {
    const image    = firstImage(item);
    const location = locationLabel(item);
    const rating   = item.rating || 0;
    const reviews  = item.review_count || 0;
    const price    = item.price_from;
    const duration = item.duration_minutes
      ? (item.duration_minutes >= 60
          ? Math.round(item.duration_minutes / 60) + 'h'
          : item.duration_minutes + 'min')
      : null;

    this.innerHTML = `
      <div class="tos-card overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group h-full flex flex-col"
           data-action="detail" data-id="${item.id}">

        <!-- Image -->
        <div class="relative h-48 overflow-hidden">
          ${imgOrPlaceholder(image, item.title)}
          ${duration ? `<div class="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
            ${duration}
          </div>` : ''}
          <div class="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
        </div>

        <!-- Content -->
        <div class="p-4 flex flex-col flex-1">
          ${location ? `<p class="text-xs text-text-secondary mb-1 flex items-center gap-1">
            <svg class="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
            </svg>
            ${location}
          </p>` : ''}

          <h3 class="font-semibold text-text-primary mb-2 leading-snug flex-1"
              style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">
            ${item.title || 'Untitled'}
          </h3>

          ${rating ? `<div class="flex items-center gap-1.5 mb-3">
            ${renderStars(rating)}
            <span class="text-xs text-text-secondary">${rating.toFixed(1)}
              ${reviews ? `<span class="opacity-50">·</span> ${reviews.toLocaleString()} reviews` : ''}
            </span>
          </div>` : '<div class="mb-3"></div>'}

          <div class="flex items-end justify-between mt-auto pt-2 border-t border-border">
            <div>
              <span class="text-xs text-text-secondary block">From</span>
              ${formatPrice(price, item.price_currency || 'USD')}
              <span class="text-xs text-text-secondary">/person</span>
            </div>
            <button class="tos-btn-primary text-sm px-3 py-1.5" data-action="book" data-id="${item.id}">
              Book
            </button>
          </div>
        </div>
      </div>`;
  }
}

customElements.define('tos-experience-card', TosExperienceCard);
