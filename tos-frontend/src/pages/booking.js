export function renderBooking(rootEl, id) {
  rootEl.innerHTML = `
    <tos-header></tos-header>
    <main class="min-h-screen bg-page-bg">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button onclick="window.history.back()"
          class="flex items-center gap-1 text-text-secondary hover:text-text-primary text-sm mb-6 transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
          </svg>
          Back to product
        </button>
        <tos-booking-form product-id="${id}"></tos-booking-form>
      </div>
    </main>
    <tos-footer></tos-footer>`;
}
