class TosHero extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="search"]')) this._doSearch();
    });
    this.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.closest('.tos-hero-input')) this._doSearch();
    });
    this._render();
  }

  _doSearch() {
    const q = this.querySelector('#hero-search-input')?.value?.trim();
    const type = this.querySelector('#hero-type-select')?.value || '';
    if (!q) return;
    const params = new URLSearchParams({ q });
    if (type) params.set('type', type);
    window.dispatchEvent(new CustomEvent('tos:navigate', {
      detail: { path: `/search?${params}` }
    }));
  }

  _render() {
    const headline   = this.getAttribute('headline')   || 'Discover Your Next Adventure';
    const subheading = this.getAttribute('subheading') || 'Hotels, experiences, and transfers worldwide';
    const bgImage    = this.getAttribute('bg-image');

    const bgStyle = bgImage
      ? `background-image: linear-gradient(to bottom, rgba(13,59,110,0.7), rgba(13,59,110,0.85)), url('${bgImage}'); background-size: cover; background-position: center;`
      : `background: linear-gradient(135deg, #0D3B6E 0%, #1A56A0 50%, #0E7490 100%);`;

    this.innerHTML = `
      <section class="relative text-white py-20 md:py-28" style="${bgStyle}">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 class="text-4xl md:text-5xl font-bold mb-4 leading-tight">${headline}</h1>
          <p class="text-white/80 text-lg md:text-xl mb-10">${subheading}</p>

          <!-- Search bar -->
          <div class="bg-white rounded-xl shadow-2xl p-3 flex flex-col sm:flex-row gap-2 max-w-2xl mx-auto">
            <input id="hero-search-input" type="text"
              placeholder="Where are you going?"
              class="tos-hero-input flex-1 px-4 py-3 text-text-primary placeholder-text-secondary
                     rounded-lg border border-border-default focus:outline-none focus:ring-2
                     focus:ring-accent focus:border-transparent text-sm" />

            <select id="hero-type-select"
              class="sm:w-36 px-3 py-3 text-text-secondary text-sm rounded-lg border
                     border-border-default focus:outline-none focus:ring-2 focus:ring-accent
                     bg-white cursor-pointer">
              <option value="">All types</option>
              <option value="HOTEL">Hotels</option>
              <option value="EXPERIENCE">Experiences</option>
              <option value="TRANSFER">Transfers</option>
            </select>

            <button data-action="search"
              class="bg-accent hover:bg-primary text-white font-semibold px-6 py-3 rounded-lg
                     transition-colors text-sm whitespace-nowrap flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
              Search
            </button>
          </div>

          <!-- Quick links -->
          <div class="flex flex-wrap justify-center gap-3 mt-6">
            ${['Paris', 'London', 'Barcelona', 'Rome', 'Amsterdam'].map(city => `
              <button class="px-4 py-1.5 rounded-full text-sm bg-white/20 hover:bg-white/30
                             text-white border border-white/30 transition-colors backdrop-blur-sm"
                      data-action="quick-city" data-city="${city}">
                ${city}
              </button>`).join('')}
          </div>
        </div>
      </section>`;

    // Quick city buttons
    this.querySelectorAll('[data-action="quick-city"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const city = btn.dataset.city;
        window.dispatchEvent(new CustomEvent('tos:navigate', {
          detail: { path: `/search?q=${encodeURIComponent(city)}` }
        }));
      });
    });
  }
}

customElements.define('tos-hero', TosHero);
