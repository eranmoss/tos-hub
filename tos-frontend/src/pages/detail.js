import { detail } from '../api/catalog.js';

export async function renderDetail(rootEl, id) {
  // Render shell immediately with loading state
  rootEl.innerHTML = `
    <tos-header></tos-header>
    <main class="min-h-screen bg-page-bg">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="tos-skeleton h-8 w-32 rounded mb-6"></div>
        <div class="tos-skeleton h-80 w-full rounded-xl mb-8"></div>
        <div class="grid grid-cols-3 gap-8">
          <div class="col-span-2 space-y-4">
            <div class="tos-skeleton h-8 w-3/4 rounded"></div>
            <div class="tos-skeleton h-4 w-1/2 rounded"></div>
            <div class="tos-skeleton h-32 w-full rounded"></div>
          </div>
          <div class="tos-skeleton h-64 rounded-card"></div>
        </div>
      </div>
    </main>
    <tos-footer></tos-footer>`;

  // Fetch product to determine type, then render the right detail component
  try {
    const item = await detail(id);
    const tag  = item.type === 'HOTEL' ? 'tos-hotel-detail' : 'tos-experience-detail';

    rootEl.innerHTML = `
      <tos-header></tos-header>
      <main class="min-h-screen bg-page-bg">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <button onclick="window.history.back()"
            class="flex items-center gap-1 text-text-secondary hover:text-text-primary text-sm mb-6 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
          <${tag} product-id="${id}"></${tag}>
        </div>
      </main>
      <tos-footer></tos-footer>

      <tos-agent-chat
        current-page="detail"
        product-title="${(item.title || '').replace(/"/g, '&quot;')}"
        position="bottom-right">
      </tos-agent-chat>`;

    // Inject data directly to avoid a second fetch
    const el = rootEl.querySelector(tag);
    if (el) {
      el._data = item;
      el._loading = false;
      el.update?.();
    }
  } catch (e) {
    rootEl.innerHTML = `
      <tos-header></tos-header>
      <div class="max-w-2xl mx-auto px-4 py-20 text-center">
        <p class="text-4xl mb-4">😕</p>
        <p class="text-text-secondary mb-6">${e.message}</p>
        <button onclick="window.history.back()" class="tos-btn-secondary text-sm">Go back</button>
      </div>
      <tos-footer></tos-footer>`;
  }
}
