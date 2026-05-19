import { TosElement, renderStars, formatPrice, locationLabel, resolveImageUrl } from '../base.js';
import { detail, availability } from '../../api/catalog.js';

class TosHotelDetail extends TosElement {
  mount() {
    const id = this.getAttribute('product-id');
    if (!id) return;
    this.fetch(() => detail(id));
  }

  template() {
    const item = this._data;
    if (!item) return '';

    const images   = item.image_urls || item.images || [];
    const location = locationLabel(item);
    const amenities = (item.amenities || []).slice(0, 12);

    return `
      <div class="max-w-5xl mx-auto">

        <!-- Image gallery -->
        <div class="grid grid-cols-4 grid-rows-2 gap-2 h-80 rounded-xl overflow-hidden mb-8">
          ${images.slice(0, 5).map((img, i) => {
            const url = resolveImageUrl(img);
            const cls = i === 0 ? 'col-span-2 row-span-2' : 'col-span-1 row-span-1';
            return `<div class="${cls} bg-gradient-to-br from-primary/20 to-accent/30 overflow-hidden">
              ${url ? `<img src="${url}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-300" loading="lazy" />` : ''}
            </div>`;
          }).join('')}
          ${images.length === 0 ? `<div class="col-span-4 row-span-2 bg-gradient-to-br from-primary/20 to-accent/30 flex items-center justify-center">
            <span class="text-6xl opacity-30">🏨</span>
          </div>` : ''}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">

          <!-- Main info -->
          <div class="lg:col-span-2 space-y-6">
            <div>
              ${item.star_rating ? `<div class="flex gap-0.5 text-amber-400 mb-2">${'★'.repeat(item.star_rating)}</div>` : ''}
              <h1 class="text-3xl font-bold text-text-primary mb-2">${item.title}</h1>
              ${location ? `<p class="text-text-secondary flex items-center gap-1">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
                </svg>
                ${location}
              </p>` : ''}
            </div>

            ${item.rating ? `<div class="flex items-center gap-3 p-4 bg-amber-50 rounded-card">
              ${renderStars(item.rating)}
              <span class="font-bold text-text-primary">${item.rating.toFixed(1)}</span>
              ${item.review_count ? `<span class="text-text-secondary text-sm">${item.review_count.toLocaleString()} reviews</span>` : ''}
            </div>` : ''}

            ${item.description ? `<div>
              <h2 class="text-lg font-semibold text-text-primary mb-2">About</h2>
              <p class="text-text-secondary leading-relaxed">${item.description}</p>
            </div>` : ''}

            ${amenities.length ? `<div>
              <h2 class="text-lg font-semibold text-text-primary mb-3">Amenities</h2>
              <div class="flex flex-wrap gap-2">
                ${amenities.map(a => `
                  <span class="px-3 py-1 bg-page-bg border border-border-default rounded-full text-sm text-text-secondary">
                    ${a}
                  </span>`).join('')}
              </div>
            </div>` : ''}
          </div>

          <!-- Booking panel -->
          <div class="lg:col-span-1">
            <div class="tos-card p-5 sticky top-20">
              <div class="mb-4">
                <span class="text-xs text-text-secondary">From</span>
                <div>${formatPrice(item.price_from, item.price_currency)}</div>
                <span class="text-xs text-text-secondary">per night</span>
              </div>

              <div class="space-y-3 mb-4">
                <div>
                  <label class="text-xs font-medium text-text-secondary block mb-1">Check-in</label>
                  <input type="date" id="detail-checkin"
                    class="w-full px-3 py-2 text-sm border border-border-default rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label class="text-xs font-medium text-text-secondary block mb-1">Check-out</label>
                  <input type="date" id="detail-checkout"
                    class="w-full px-3 py-2 text-sm border border-border-default rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label class="text-xs font-medium text-text-secondary block mb-1">Guests</label>
                  <select id="detail-guests"
                    class="w-full px-3 py-2 text-sm border border-border-default rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-accent bg-white">
                    ${[1,2,3,4,5,6].map(n => `<option value="${n}">${n} guest${n>1?'s':''}</option>`).join('')}
                  </select>
                </div>
              </div>

              <button data-action="book" data-id="${item.id}"
                class="w-full tos-btn-primary py-3 text-base">
                Reserve
              </button>

              <p class="text-xs text-text-secondary text-center mt-3">No charge until confirmation</p>
            </div>
          </div>
        </div>
      </div>`;
  }

  handleAction(action, dataset) {
    if (action === 'book') {
      const checkin  = this.querySelector('#detail-checkin')?.value;
      const checkout = this.querySelector('#detail-checkout')?.value;
      const guests   = this.querySelector('#detail-guests')?.value;
      const params   = new URLSearchParams({ id: dataset.id });
      if (checkin)  params.set('checkin',  checkin);
      if (checkout) params.set('checkout', checkout);
      if (guests)   params.set('guests',   guests);
      window.dispatchEvent(new CustomEvent('tos:navigate', {
        detail: { path: `/book/${dataset.id}?${params}` }
      }));
    }
  }
}

customElements.define('tos-hotel-detail', TosHotelDetail);
