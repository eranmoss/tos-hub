import { TosElement, renderStars, formatPrice, locationLabel, resolveImageUrl } from '../base.js';
import { detail } from '../../api/catalog.js';

function durationLabel(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${minutes}min`;
}

class TosExperienceDetail extends TosElement {
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
    const duration = durationLabel(item.duration_minutes);
    const inclusions = item.inclusions || [];
    const exclusions = item.exclusions || [];

    return `
      <div class="max-w-5xl mx-auto">

        <!-- Hero image -->
        <div class="relative h-72 md:h-96 rounded-xl overflow-hidden mb-8 bg-gradient-to-br from-primary/20 to-accent/30">
          ${resolveImageUrl(images[0]) ? `<img src="${resolveImageUrl(images[0])}" class="w-full h-full object-cover" loading="lazy" />` : `<div class="w-full h-full flex items-center justify-center"><span class="text-6xl opacity-30">🎭</span></div>`}
          <div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
          ${item.category ? `<div class="absolute top-4 left-4">
            <span class="tos-badge bg-white/90 text-text-primary text-sm px-3 py-1">${item.category}</span>
          </div>` : ''}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">

          <!-- Main info -->
          <div class="lg:col-span-2 space-y-6">
            <div>
              <h1 class="text-3xl font-bold text-text-primary mb-2">${item.title}</h1>
              ${location ? `<p class="text-text-secondary flex items-center gap-1 text-sm">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
                </svg>
                ${location}
              </p>` : ''}
            </div>

            <!-- Quick facts -->
            <div class="flex flex-wrap gap-4">
              ${duration ? `<div class="flex items-center gap-2 bg-page-bg px-4 py-2 rounded-lg">
                <span class="text-xl">⏱</span>
                <div><p class="text-xs text-text-secondary">Duration</p><p class="text-sm font-medium">${duration}</p></div>
              </div>` : ''}
              ${item.rating ? `<div class="flex items-center gap-2 bg-page-bg px-4 py-2 rounded-lg">
                <span class="text-xl">⭐</span>
                <div><p class="text-xs text-text-secondary">Rating</p>
                  <p class="text-sm font-medium">${item.rating.toFixed(1)} / 5
                    ${item.review_count ? `<span class="text-text-secondary font-normal">(${item.review_count.toLocaleString()})</span>` : ''}
                  </p>
                </div>
              </div>` : ''}
              ${item.availability_status ? `<div class="flex items-center gap-2 bg-green-50 px-4 py-2 rounded-lg">
                <span class="text-xl">✅</span>
                <div><p class="text-xs text-text-secondary">Availability</p><p class="text-sm font-medium text-success">Available</p></div>
              </div>` : ''}
            </div>

            ${item.description ? `<div>
              <h2 class="text-lg font-semibold text-text-primary mb-2">About this experience</h2>
              <p class="text-text-secondary leading-relaxed">${item.description}</p>
            </div>` : ''}

            ${inclusions.length ? `<div>
              <h2 class="text-lg font-semibold text-text-primary mb-3">What's included</h2>
              <ul class="space-y-1">
                ${inclusions.map(i => `<li class="flex items-start gap-2 text-sm text-text-secondary">
                  <span class="text-success mt-0.5">✓</span>${i}
                </li>`).join('')}
              </ul>
            </div>` : ''}

            ${exclusions.length ? `<div>
              <h2 class="text-lg font-semibold text-text-primary mb-3">Not included</h2>
              <ul class="space-y-1">
                ${exclusions.map(i => `<li class="flex items-start gap-2 text-sm text-text-secondary">
                  <span class="text-danger mt-0.5">✗</span>${i}
                </li>`).join('')}
              </ul>
            </div>` : ''}
          </div>

          <!-- Booking panel -->
          <div class="lg:col-span-1">
            <div class="tos-card p-5 sticky top-20">
              <div class="mb-5">
                <span class="text-xs text-text-secondary">From</span>
                <div>${formatPrice(item.price_from, item.price_currency)}</div>
                <span class="text-xs text-text-secondary">per person</span>
              </div>

              <div class="space-y-3 mb-5">
                <div>
                  <label class="text-xs font-medium text-text-secondary block mb-1">Date</label>
                  <input type="date" id="exp-date"
                    class="w-full px-3 py-2 text-sm border border-border-default rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label class="text-xs font-medium text-text-secondary block mb-1">Guests</label>
                  <select id="exp-guests"
                    class="w-full px-3 py-2 text-sm border border-border-default rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-accent bg-white">
                    ${[1,2,3,4,5,6,8,10].map(n => `<option value="${n}">${n} guest${n>1?'s':''}</option>`).join('')}
                  </select>
                </div>
              </div>

              <button data-action="book" data-id="${item.id}"
                class="w-full tos-btn-primary py-3 text-base">
                Book now
              </button>
              <p class="text-xs text-text-secondary text-center mt-3">Free cancellation available</p>
            </div>
          </div>
        </div>
      </div>`;
  }

  handleAction(action, dataset) {
    if (action === 'book') {
      const date   = this.querySelector('#exp-date')?.value;
      const guests = this.querySelector('#exp-guests')?.value;
      const params = new URLSearchParams({ id: dataset.id });
      if (date)   params.set('date',   date);
      if (guests) params.set('guests', guests);
      window.dispatchEvent(new CustomEvent('tos:navigate', {
        detail: { path: `/book/${dataset.id}?${params}` }
      }));
    }
  }
}

customElements.define('tos-experience-detail', TosExperienceDetail);
