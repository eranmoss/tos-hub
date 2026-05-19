import { TosElement, formatPrice } from '../base.js';
import { detail, book } from '../../api/catalog.js';

class TosBookingForm extends TosElement {
  mount() {
    const id = this.getAttribute('product-id');
    if (!id) return;
    this._params = Object.fromEntries(new URLSearchParams(window.location.search));
    this.fetch(() => detail(id));
  }

  template() {
    const item = this._data;
    if (!item) return '';
    const p = this._params || {};

    return `
      <div class="max-w-2xl mx-auto">
        <h1 class="text-2xl font-bold text-text-primary mb-6">Complete your booking</h1>

        <!-- Summary card -->
        <div class="tos-card p-5 mb-6 flex gap-4">
          <div class="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br from-primary/20 to-accent/30">
            ${item.images?.[0] ? `<img src="${item.images[0]?.url || item.images[0]}" class="w-full h-full object-cover" />` : ''}
          </div>
          <div>
            <p class="font-semibold text-text-primary">${item.title}</p>
            <p class="text-sm text-text-secondary mt-1">
              ${p.checkin && p.checkout ? `${p.checkin} → ${p.checkout}` :
                p.date                 ? `Date: ${p.date}` : ''}
              ${p.guests ? ` · ${p.guests} guest${p.guests > 1 ? 's' : ''}` : ''}
            </p>
            <div class="mt-2">${formatPrice(item.price_from, item.price_currency)}</div>
          </div>
        </div>

        <!-- Guest details form -->
        <div class="tos-card p-6 mb-6">
          <h2 class="font-semibold text-text-primary mb-4">Guest details</h2>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-xs font-medium text-text-secondary block mb-1">First name</label>
                <input id="bf-firstname" type="text" placeholder="John"
                  class="w-full px-3 py-2.5 text-sm border border-border-default rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label class="text-xs font-medium text-text-secondary block mb-1">Last name</label>
                <input id="bf-lastname" type="text" placeholder="Smith"
                  class="w-full px-3 py-2.5 text-sm border border-border-default rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
            </div>
            <div>
              <label class="text-xs font-medium text-text-secondary block mb-1">Email</label>
              <input id="bf-email" type="email" placeholder="john@example.com"
                class="w-full px-3 py-2.5 text-sm border border-border-default rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label class="text-xs font-medium text-text-secondary block mb-1">Phone</label>
              <input id="bf-phone" type="tel" placeholder="+1 555 000 0000"
                class="w-full px-3 py-2.5 text-sm border border-border-default rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label class="text-xs font-medium text-text-secondary block mb-1">Special requests (optional)</label>
              <textarea id="bf-notes" rows="3" placeholder="Any dietary requirements, accessibility needs, etc."
                class="w-full px-3 py-2.5 text-sm border border-border-default rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-accent resize-none"></textarea>
            </div>
          </div>
        </div>

        <!-- Error message -->
        <div id="bf-error" class="hidden mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-danger"></div>

        <!-- Submit -->
        <button data-action="submit" id="bf-submit"
          class="w-full tos-btn-primary py-4 text-base font-semibold">
          Confirm Booking
        </button>
        <p class="text-xs text-text-secondary text-center mt-3">
          By confirming you agree to the cancellation policy.
        </p>
      </div>`;
  }

  handleAction(action) {
    if (action === 'submit') this._submit();
  }

  async _submit() {
    const item = this._data;
    if (!item) return;

    const firstname = this.querySelector('#bf-firstname')?.value?.trim();
    const lastname  = this.querySelector('#bf-lastname')?.value?.trim();
    const email     = this.querySelector('#bf-email')?.value?.trim();
    const phone     = this.querySelector('#bf-phone')?.value?.trim();
    const notes     = this.querySelector('#bf-notes')?.value?.trim();
    const errEl     = this.querySelector('#bf-error');
    const submitBtn = this.querySelector('#bf-submit');

    if (!firstname || !lastname || !email) {
      errEl.textContent = 'Please fill in all required fields.';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');

    submitBtn.textContent = 'Processing…';
    submitBtn.disabled = true;

    const p = this._params || {};
    try {
      const result = await book(item.id, {
        guests:  [{ first_name: firstname, last_name: lastname, email, phone }],
        date:    p.date || p.checkin,
        checkin: p.checkin,
        checkout: p.checkout,
        notes,
        contact: { email, phone },
      });

      const ref = result?.booking_ref || result?.id || 'PENDING';
      window.dispatchEvent(new CustomEvent('tos:navigate', {
        detail: { path: `/booking/${ref}?title=${encodeURIComponent(item.title)}` }
      }));
    } catch (e) {
      errEl.textContent = e.message || 'Booking failed. Please try again.';
      errEl.classList.remove('hidden');
      submitBtn.textContent = 'Confirm Booking';
      submitBtn.disabled = false;
    }
  }
}

customElements.define('tos-booking-form', TosBookingForm);
