/**
 * Client-side router — maps URL paths to page render functions.
 */
export const Router = {
  init(rootEl) {
    this._root = rootEl;

    window.addEventListener('tos:navigate', (e) => {
      const path = e.detail?.path || '/';
      window.history.pushState({}, '', path);
      this._dispatch();
    });

    window.addEventListener('popstate', () => this._dispatch());
    this._dispatch();
  },

  async _dispatch() {
    const path = window.location.pathname;

    // ── Static routes ──────────────────────────────────────────────────────
    if (path === '/') {
      const { renderHome } = await import('../pages/home.js');
      return renderHome(this._root);
    }

    if (path === '/search') {
      const { renderSearch } = await import('../pages/search.js');
      return renderSearch(this._root);
    }

    if (path === '/hotels') {
      const { renderBrowse } = await import('../pages/browse.js');
      return renderBrowse(this._root, { type: 'HOTEL', title: 'Hotels' });
    }

    if (path === '/experiences') {
      const { renderBrowse } = await import('../pages/browse.js');
      return renderBrowse(this._root, { type: 'EXPERIENCE', title: 'Experiences' });
    }

    if (path === '/transfers') {
      const { renderBrowse } = await import('../pages/browse.js');
      return renderBrowse(this._root, { type: 'TRANSFER', title: 'Transfers' });
    }

    if (path === '/attractions') {
      const { renderBrowse } = await import('../pages/browse.js');
      return renderBrowse(this._root, { type: '', title: 'Attractions & Points of Interest' });
    }

    // ── Dynamic routes ─────────────────────────────────────────────────────
    const productMatch = path.match(/^\/product\/([^/]+)$/);
    if (productMatch) {
      const { renderDetail } = await import('../pages/detail.js');
      return renderDetail(this._root, productMatch[1]);
    }

    const bookMatch = path.match(/^\/book\/([^/]+)$/);
    if (bookMatch) {
      const { renderBooking } = await import('../pages/booking.js');
      return renderBooking(this._root, bookMatch[1]);
    }

    const confirmMatch = path.match(/^\/booking\/([^/]+)$/);
    if (confirmMatch) {
      const { renderConfirmation } = await import('../pages/confirmation.js');
      return renderConfirmation(this._root, confirmMatch[1]);
    }

    // Trip planner (Phase 9b)
    if (path.startsWith('/trips')) {
      return this._stub('Trip Planner — coming in Phase 9b');
    }

    this._notFound(path);
  },

  _stub(message) {
    this._root.innerHTML = `
      <tos-header></tos-header>
      <div class="max-w-2xl mx-auto px-4 py-20 text-center">
        <p class="text-5xl mb-5">🚧</p>
        <h1 class="text-xl font-semibold text-text-primary mb-2">${message}</h1>
        <button onclick="window.dispatchEvent(new CustomEvent('tos:navigate',{detail:{path:'/'}}))"
                class="tos-btn-primary text-sm mt-4">Back to home</button>
      </div>
      <tos-footer></tos-footer>`;
  },

  _notFound(path) {
    this._root.innerHTML = `
      <tos-header></tos-header>
      <div class="max-w-2xl mx-auto px-4 py-20 text-center">
        <p class="text-6xl font-bold text-border-default mb-4">404</p>
        <p class="text-text-secondary mb-6">${path}</p>
        <button onclick="window.dispatchEvent(new CustomEvent('tos:navigate',{detail:{path:'/'}}))"
                class="tos-btn-primary text-sm">Home</button>
      </div>
      <tos-footer></tos-footer>`;
  },
};
