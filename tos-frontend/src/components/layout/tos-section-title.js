class TosSectionTitle extends HTMLElement {
  connectedCallback() {
    const title       = this.getAttribute('title')         || '';
    const viewAllHref = this.getAttribute('view-all-href') || '';
    const viewAllText = this.getAttribute('view-all-text') || 'View all';

    this.innerHTML = `
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-xl md:text-2xl font-bold text-text-primary">${title}</h2>
        ${viewAllHref ? `
          <a href="${viewAllHref}" data-nav="${viewAllHref}"
             class="text-accent hover:text-primary text-sm font-medium flex items-center gap-1 transition-colors">
            ${viewAllText}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </a>` : ''}
      </div>`;

    // Wire up view-all nav
    this.querySelector('[data-nav]')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('tos:navigate', {
        detail: { path: viewAllHref }
      }));
    });
  }
}

customElements.define('tos-section-title', TosSectionTitle);
