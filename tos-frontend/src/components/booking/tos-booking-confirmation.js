class TosBookingConfirmation extends HTMLElement {
  connectedCallback() {
    const ref   = this.getAttribute('booking-ref') || 'CONF-0000';
    const title = this.getAttribute('product-title') || 'Your booking';

    this.innerHTML = `
      <div class="max-w-lg mx-auto text-center py-12">
        <!-- Success icon -->
        <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg class="w-10 h-10 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
          </svg>
        </div>

        <h1 class="text-3xl font-bold text-text-primary mb-2">Booking confirmed!</h1>
        <p class="text-text-secondary mb-8">${title}</p>

        <!-- Booking ref -->
        <div class="tos-card p-6 mb-8 text-left">
          <div class="flex items-center justify-between mb-4">
            <span class="text-sm text-text-secondary">Booking reference</span>
            <span class="font-mono font-bold text-text-primary text-lg">${ref}</span>
          </div>
          <p class="text-xs text-text-secondary">
            A confirmation has been sent to your email. Please keep this reference number for your records.
          </p>
        </div>

        <!-- Actions -->
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <button onclick="window.dispatchEvent(new CustomEvent('tos:navigate',{detail:{path:'/'}}))"
            class="tos-btn-primary px-8 py-3">
            Back to home
          </button>
          <button onclick="window.dispatchEvent(new CustomEvent('tos:navigate',{detail:{path:'/trips'}}))"
            class="tos-btn-secondary px-8 py-3">
            View in Trip Planner
          </button>
        </div>
      </div>`;
  }
}

customElements.define('tos-booking-confirmation', TosBookingConfirmation);
