import { config } from '../../config.js';

class TosFooter extends HTMLElement {
  connectedCallback() {
    this._render();
  }

  _render() {
    const logo = config.branding.logoUrl
      ? `<img src="${config.branding.logoUrl}" alt="Logo" class="h-6" />`
      : `<span class="text-lg font-bold tracking-tight">TOS</span>`;

    this.innerHTML = `
      <footer class="bg-primary text-white/70 mt-12">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div class="mb-3">${logo}</div>
              <p class="text-xs leading-relaxed text-white/50">
                Discover experiences, hotels &amp; transfers around the world.
              </p>
            </div>

            <div>
              <h4 class="text-sm font-semibold text-white mb-3">Explore</h4>
              <ul class="space-y-2 text-xs">
                <li><a href="/hotels"      data-nav="/hotels"      class="hover:text-white transition-colors cursor-pointer">Hotels</a></li>
                <li><a href="/experiences" data-nav="/experiences" class="hover:text-white transition-colors cursor-pointer">Experiences</a></li>
                <li><a href="/transfers"   data-nav="/transfers"   class="hover:text-white transition-colors cursor-pointer">Transfers</a></li>
                <li><a href="/attractions" data-nav="/attractions" class="hover:text-white transition-colors cursor-pointer">Attractions</a></li>
              </ul>
            </div>

            <div>
              <h4 class="text-sm font-semibold text-white mb-3">Plan</h4>
              <ul class="space-y-2 text-xs">
                <li><a href="/trips" data-nav="/trips" class="hover:text-white transition-colors cursor-pointer">Trip Planner</a></li>
                <li><a href="/search" data-nav="/search" class="hover:text-white transition-colors cursor-pointer">Search</a></li>
              </ul>
            </div>

            <div>
              <h4 class="text-sm font-semibold text-white mb-3">Support</h4>
              <ul class="space-y-2 text-xs">
                <li><span class="text-white/50">Help Centre</span></li>
                <li><span class="text-white/50">Privacy Policy</span></li>
                <li><span class="text-white/50">Terms of Service</span></li>
              </ul>
            </div>
          </div>

          <div class="border-t border-white/10 pt-6 text-xs text-white/30 text-center">
            &copy; ${new Date().getFullYear()} Travel Operating System. All rights reserved.
          </div>
        </div>
      </footer>`;

    this.addEventListener('click', (e) => {
      const link = e.target.closest('[data-nav]');
      if (link) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('tos:navigate', { detail: { path: link.dataset.nav } }));
      }
    });
  }
}

customElements.define('tos-footer', TosFooter);
