import { TosElement } from '../base.js';
import { config } from '../../config.js';

class TosHeader extends HTMLElement {
  connectedCallback() {
    this._render();
    this.addEventListener('click', (e) => {
      const link = e.target.closest('[data-nav]');
      if (link) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('tos:navigate', { detail: { path: link.dataset.nav } }));
      }
      if (e.target.closest('[data-action="menu-toggle"]')) {
        this._menuOpen = !this._menuOpen;
        this._render();
      }
    });
  }

  _render() {
    const logo = config.branding.logoUrl
      ? `<img src="${config.branding.logoUrl}" alt="Logo" class="h-8" />`
      : `<span class="text-xl font-bold text-white tracking-tight">TOS</span>`;

    const navLinks = [
      { label: 'Hotels',      path: '/hotels' },
      { label: 'Experiences', path: '/experiences' },
      { label: 'Transfers',   path: '/transfers' },
      { label: 'Attractions', path: '/attractions' },
      { label: 'Plan a Trip', path: '/trips' },
    ];

    const links = navLinks.map(({ label, path }) => `
      <a href="${path}" data-nav="${path}"
         class="text-white/80 hover:text-white text-sm font-medium transition-colors px-1">
        ${label}
      </a>`).join('');

    const mobileLinks = navLinks.map(({ label, path }) => `
      <a href="${path}" data-nav="${path}"
         class="block px-4 py-3 text-white/80 hover:text-white hover:bg-white/10 text-sm font-medium transition-colors">
        ${label}
      </a>`).join('');

    this.innerHTML = `
      <header class="bg-primary shadow-sm sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between h-16">

            <!-- Logo -->
            <a href="/" data-nav="/" class="flex items-center gap-2 flex-shrink-0">
              ${logo}
            </a>

            <!-- Desktop nav -->
            <nav class="hidden md:flex items-center gap-6">
              ${links}
            </nav>

            <!-- Right actions -->
            <div class="flex items-center gap-3">
              <button class="hidden md:flex items-center gap-1 text-white/80 hover:text-white text-sm transition-colors"
                      data-action="search-toggle" aria-label="Search">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
              </button>

              <!-- Mobile menu button -->
              <button class="md:hidden text-white/80 hover:text-white transition-colors p-1"
                      data-action="menu-toggle" aria-label="Menu">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="${this._menuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Mobile menu -->
        ${this._menuOpen ? `
          <div class="md:hidden border-t border-white/10 bg-primary">
            ${mobileLinks}
          </div>` : ''}
      </header>`;
  }
}

customElements.define('tos-header', TosHeader);
