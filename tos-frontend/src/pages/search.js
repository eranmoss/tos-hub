export function renderSearch(rootEl) {
  const params = new URLSearchParams(window.location.search);
  const q    = params.get('q')    || '';
  const type = params.get('type') || '';
  const dest = params.get('dest') || '';

  const typeLabel = { HOTEL: 'Hotels', EXPERIENCE: 'Experiences', TRANSFER: 'Transfers' }[type] || 'All';
  const heading   = q ? `Results for "${q}"` : dest ? `Results in ${dest}` : `${typeLabel}`;

  rootEl.innerHTML = `
    <tos-header></tos-header>
    <main class="min-h-screen bg-page-bg">
      <div class="bg-white border-b border-border-default py-5">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <tos-search-bar
            query="${q}"
            type="${type}"
            destination="${dest}">
          </tos-search-bar>
        </div>
      </div>

      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 class="text-2xl font-bold text-text-primary mb-6">${heading}</h1>
        <tos-search-results
          query="${q}"
          type="${type}"
          dest="${dest}"
          limit="24">
        </tos-search-results>
      </div>
    </main>
    <tos-footer></tos-footer>

    <tos-agent-chat current-page="search" destination="${dest}" position="bottom-right"></tos-agent-chat>`;
}
