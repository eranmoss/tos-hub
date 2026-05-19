/** Generic browse page — used for /hotels, /experiences, /transfers, /attractions */
export function renderBrowse(rootEl, { type, title, viewAllHref }) {
  rootEl.innerHTML = `
    <tos-header></tos-header>
    <main class="min-h-screen bg-page-bg">
      <div class="bg-white border-b border-border-default py-5">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <tos-search-bar type="${type}"></tos-search-bar>
        </div>
      </div>

      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 class="text-2xl font-bold text-text-primary mb-6">${title}</h1>
        <tos-search-results type="${type}" limit="24"></tos-search-results>
      </div>
    </main>
    <tos-footer></tos-footer>

    <tos-agent-chat current-page="browse" position="bottom-right"></tos-agent-chat>`;
}
