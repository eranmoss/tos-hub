export function renderConfirmation(rootEl, ref) {
  const params = new URLSearchParams(window.location.search);
  const title  = params.get('title') || 'Your booking';

  rootEl.innerHTML = `
    <tos-header></tos-header>
    <main class="min-h-screen bg-page-bg">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <tos-booking-confirmation
          booking-ref="${ref}"
          product-title="${title}">
        </tos-booking-confirmation>
      </div>
    </main>
    <tos-footer></tos-footer>`;
}
