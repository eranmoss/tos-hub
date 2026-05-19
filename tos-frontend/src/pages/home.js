export function renderHome(rootEl) {
  rootEl.innerHTML = `
    <tos-header></tos-header>

    <main class="min-h-screen bg-page-bg">
      <tos-hero
        headline="Discover Your Next Adventure"
        subheading="Hotels, experiences, and transfers worldwide">
      </tos-hero>

      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-14">

        <section>
          <tos-section-title title="Popular Hotels" view-all-href="/hotels" view-all-text="View all hotels">
          </tos-section-title>
          <tos-hotel-carousel limit="8" sort="rating"></tos-hotel-carousel>
        </section>

        <section>
          <tos-section-title title="Top Experiences" view-all-href="/experiences" view-all-text="View all experiences">
          </tos-section-title>
          <tos-experience-carousel limit="8"></tos-experience-carousel>
        </section>

        <section>
          <tos-section-title title="Points of Interest" view-all-href="/attractions" view-all-text="Explore all">
          </tos-section-title>
          <tos-poi-grid limit="8"></tos-poi-grid>
        </section>

      </div>
    </main>

    <tos-footer></tos-footer>

    <tos-agent-chat current-page="home" position="bottom-right"></tos-agent-chat>`;
}
