/**
 * <tos-search-bar>
 * Attributes:
 *   type        — pre-selected type (HOTEL | EXPERIENCE | TRANSFER | all)
 *   query       — pre-filled search query
 *   destination — pre-filled destination
 */
class TosSearchBar extends HTMLElement {
  connectedCallback() {
    this._render();
    this.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="search"]')) this._submit();
    });
    this.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submit();
    });
  }

  _submit() {
    const q    = this.querySelector('#sb-query')?.value?.trim() || '';
    const type = this.querySelector('#sb-type')?.value || '';
    const dest = this.querySelector('#sb-dest')?.value?.trim() || '';
    if (!q && !dest) return;

    const params = new URLSearchParams();
    if (q)    params.set('q',    q);
    if (dest) params.set('dest', dest);
    if (type) params.set('type', type);

    window.dispatchEvent(new CustomEvent('tos:navigate', {
      detail: { path: `/search?${params}` }
    }));
  }

  _render() {
    const type  = this.getAttribute('type')        || '';
    const query = this.getAttribute('query')       || '';
    const dest  = this.getAttribute('destination') || '';

    this.innerHTML = `
      <div class="bg-white border border-border-default rounded-xl shadow-sm p-3
                  flex flex-col sm:flex-row gap-2">
        <input id="sb-query" type="text" value="${query}"
          placeholder="What are you looking for?"
          class="flex-1 px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary
                 border border-border-default rounded-lg focus:outline-none
                 focus:ring-2 focus:ring-accent focus:border-transparent" />

        <input id="sb-dest" type="text" value="${dest}"
          placeholder="Destination (optional)"
          class="sm:w-44 px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary
                 border border-border-default rounded-lg focus:outline-none
                 focus:ring-2 focus:ring-accent focus:border-transparent" />

        <select id="sb-type"
          class="sm:w-36 px-3 py-2.5 text-sm text-text-secondary border border-border-default
                 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent bg-white cursor-pointer">
          <option value=""           ${!type         ? 'selected' : ''}>All types</option>
          <option value="HOTEL"      ${type==='HOTEL' ? 'selected' : ''}>Hotels</option>
          <option value="EXPERIENCE" ${type==='EXPERIENCE' ? 'selected' : ''}>Experiences</option>
          <option value="TRANSFER"   ${type==='TRANSFER'   ? 'selected' : ''}>Transfers</option>
        </select>

        <button data-action="search"
          class="bg-accent hover:bg-primary text-white font-semibold px-5 py-2.5 rounded-lg
                 transition-colors text-sm flex items-center gap-2 justify-center whitespace-nowrap">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          Search
        </button>
      </div>`;
  }
}

customElements.define('tos-search-bar', TosSearchBar);
