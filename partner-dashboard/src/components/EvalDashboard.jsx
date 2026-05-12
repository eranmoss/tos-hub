import { useState, useEffect } from 'react';
import { getEvalStats } from '../api/dashboard.js';

/* ---- Info tooltip ---- */
const Info = ({ tip }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block ml-1 align-middle">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 text-[9px] font-semibold text-gray-400 hover:text-accent hover:border-accent cursor-help leading-none"
      >
        i
      </button>
      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-3 py-2 shadow-lg pointer-events-none">
          {tip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </span>
  );
};

const Metric = ({ label, value, sub, warn, info }) => (
  <div className="bg-white border border-border-default rounded-card p-3">
    <div className="text-[10px] text-text-secondary uppercase tracking-wider">
      {label}{info && <Info tip={info} />}
    </div>
    <div className={`text-xl font-semibold mt-1 ${warn ? 'text-amber-600' : 'text-text-primary'}`}>
      {value}
    </div>
    {sub && <div className="text-[10px] text-text-secondary mt-0.5">{sub}</div>}
  </div>
);

const SectionHeader = ({ children, info }) => (
  <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
    {children}{info && <Info tip={info} />}
  </h4>
);

const pct = (n, d) => d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';
const fmt = (n) => n != null ? Number(n).toLocaleString() : '—';
const fmtM = (m) => {
  if (m == null) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(1)}km`;
  return `${m}m`;
};

const Bar = ({ value, max, color = 'bg-accent' }) => (
  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
    <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
  </div>
);

const SizeChart = ({ data, labelKey = 'size', countKey = 'clusters' }) => {
  if (!data?.length) return null;
  const maxCount = Math.max(...data.map(d => d[countKey]));
  return (
    <div className="space-y-1">
      {data.slice(0, 12).map((d, i) => (
        <div key={i} className="grid grid-cols-[40px_1fr_50px] gap-2 items-center text-[10px]">
          <span className="text-right text-text-secondary font-mono">{d[labelKey]}</span>
          <Bar value={d[countKey]} max={maxCount} color="bg-blue-400" />
          <span className="text-text-secondary font-mono">{fmt(d[countKey])}</span>
        </div>
      ))}
    </div>
  );
};

/* ---- Scorecard ---- */
const SCORECARD_ITEMS = [
  {
    key: 'embedding',
    label: 'Embedding Coverage',
    info: 'Percentage of active inventory items that have a vector embedding. Embeddings power semantic search and dedup similarity. 100% means every item is searchable. Source: hub_static_inventory.embedding column.',
    calc: (d) => ((d.inventory.data_coverage.has_embedding / d.inventory.data_coverage.total) * 100).toFixed(1),
    thresholds: [95, 80, 50],
  },
  {
    key: 'dedup_cat',
    label: 'Dedup Category Match',
    info: 'Of all dedup pairs (items grouped as the same product), what % share the same category. Low scores are expected when suppliers use different category systems (e.g. "Architecture" vs "Culture" for the same tour). Source: comparing category field across items sharing a canonical_id.',
    calc: (d) => d.dedup.category_match?.total > 0
      ? ((d.dedup.category_match.same_cat / d.dedup.category_match.total) * 100).toFixed(1) : 0,
    thresholds: [80, 60, 40],
  },
  {
    key: 'price_tight',
    label: 'Price Tightness',
    info: 'Inverted median price spread within dedup clusters. If the median cluster has a 33% price spread between cheapest and most expensive, the tightness score is 67%. High spread may indicate false dedup matches (different products grouped together) or legitimate price differences across suppliers. Source: (MAX-MIN)/MIN of price_from within each canonical_id group.',
    calc: (d) => (100 - Math.min(100, d.dedup.price_spread?.median_pct || 0)).toFixed(1),
    thresholds: [80, 60, 40],
  },
  {
    key: 'geo_tight',
    label: 'Geo Tightness',
    info: 'How geographically tight dedup clusters are. Score of 100 = median cluster has items at the exact same coordinates. Drops as items within a cluster spread geographically. P99 > 100km is a red flag (items in different cities grouped together). Source: haversine distance between all item pairs sharing a canonical_id.',
    calc: (d) => d.dedup.geo_spread?.median_m === 0 ? '100.0'
      : Math.max(0, 100 - (d.dedup.geo_spread?.median_m || 0) / 100).toFixed(1),
    thresholds: [90, 70, 50],
  },
  {
    key: 'attr_city',
    label: 'Attraction City Match',
    info: 'Percentage of attraction clusters where all experiences are in the same city. Should be near 100% — an attraction (e.g. "Colosseum") should not span multiple cities. Multi-city clusters indicate clustering errors. Source: COUNT(DISTINCT city) per attraction_id in hub_static_inventory.',
    calc: (d) => {
      const s = d.attractions.city_consistency?.same_city || 0;
      const m = d.attractions.city_consistency?.multi_city || 0;
      return s + m > 0 ? ((s / (s + m)) * 100).toFixed(1) : 0;
    },
    thresholds: [99, 95, 90],
  },
  {
    key: 'attr_cov',
    label: 'Attraction Coverage',
    info: 'Percentage of experience inventory items assigned to an attraction cluster. Low coverage means most items are standalone (not grouped). Often caused by short titles that get filtered out after stop-word removal (MIN_PHRASE_COUNT threshold). Source: COUNT of hub_static_inventory rows where attraction_id IS NOT NULL.',
    calc: (d) => d.attractions.total_experiences > 0
      ? ((d.attractions.experiences_linked / d.attractions.total_experiences) * 100).toFixed(1) : 0,
    thresholds: [50, 20, 5],
  },
];

const gradeFor = (score, thresholds) => {
  const n = parseFloat(score);
  if (isNaN(n)) return { letter: '—', color: 'text-text-secondary' };
  const [a, b, c] = thresholds;
  if (n >= a) return { letter: 'A', color: 'text-emerald-600' };
  if (n >= b) return { letter: 'B', color: 'text-blue-600' };
  if (n >= c) return { letter: 'C', color: 'text-amber-600' };
  return { letter: 'D', color: 'text-red-600' };
};

/* ---- Coverage info tips ---- */
const COVERAGE_INFO = {
  Rating: 'Supplier-provided rating (0-5 stars). Used in the ranking engine rating_score with Bayesian averaging. Source: hub_static_inventory.rating',
  Reviews: 'Number of reviews. Used as confidence weight for rating — fewer reviews regresses the score toward the fallback. Source: hub_static_inventory.review_count',
  Price: 'Starting price for the item. Used in margin scoring and price spread analysis for dedup validation. Source: hub_static_inventory.price_from',
  Duration: 'Activity duration in minutes. Used as a dedup signal — items with >50% duration difference are forced DISTINCT. Source: hub_static_inventory.duration_minutes',
  Description: 'Text description of the item. Used in content quality scoring and enriched via LLM for items missing it. Source: hub_static_inventory.description',
  Images: 'Image URLs array. Used in content quality scoring. Source: hub_static_inventory.image_urls',
};

export default function EvalDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getEvalStats()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <div className="text-text-secondary text-sm py-8 text-center">Computing eval stats...</div>;
  if (error) return <div className="text-red-600 text-sm py-4">Error: {error}</div>;
  if (!data) return null;

  const { inventory, dedup, attractions } = data;
  const cov = inventory.data_coverage;
  const catMatchPct = dedup.category_match?.total > 0
    ? ((dedup.category_match.same_cat / dedup.category_match.total) * 100).toFixed(1) : 0;
  const crossSupplierPct = dedup.supplier_mix?.total > 0
    ? ((dedup.supplier_mix.cross_supplier / dedup.supplier_mix.total) * 100).toFixed(1) : 0;
  const attrCoveragePct = attractions.total_experiences > 0
    ? ((attractions.experiences_linked / attractions.total_experiences) * 100).toFixed(1) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Eval Statistics</h3>
          <div className="text-[10px] text-text-secondary">
            Generated {new Date(data.generated_at).toLocaleString()}
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-xs px-3 py-1 rounded-btn border border-border-default text-text-secondary hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* Quality Scorecard — moved to top */}
      <section className="bg-gray-50 border border-border-default rounded-card p-4">
        <div className="flex items-center gap-1 mb-3">
          <div className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Quality Scorecard</div>
          <Info tip="Each metric is graded A-D based on thresholds. A = excellent, B = good, C = needs attention, D = action required. Grades are computed from the raw stats below. Hover each metric's (i) for details on what it measures, how it's calculated, and where the data comes from." />
        </div>
        <div className="grid grid-cols-6 gap-3">
          {SCORECARD_ITEMS.map((item) => {
            const score = item.calc(data);
            const { letter, color } = gradeFor(score, item.thresholds);
            return (
              <div key={item.key} className="text-center">
                <div className={`text-2xl font-semibold ${color}`}>{letter}</div>
                <div className="text-[10px] text-text-secondary mt-1 flex items-center justify-center">
                  {item.label}<Info tip={item.info} />
                </div>
                <div className="text-[10px] font-mono text-text-secondary">{score}%</div>
                <div className="text-[8px] text-text-secondary mt-0.5">
                  {item.thresholds.map((t, i) => ['A','B','C'][i] + '>' + t).join(' ')}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Inventory Overview */}
      <section>
        <SectionHeader info="Overview of all records in hub_static_inventory. 'Active' excludes soft-deleted items. Embeddings are vector representations used for semantic search and dedup similarity matching.">
          Inventory
        </SectionHeader>
        <div className="grid grid-cols-4 gap-2">
          <Metric label="Total Records" value={fmt(inventory.total)} sub={`${fmt(inventory.active)} active`}
            info="Total rows in hub_static_inventory (active + soft-deleted). Soft-deleted items have is_active=false and are excluded from search but preserved for booking history." />
          <Metric label="Suppliers" value={inventory.suppliers}
            info="Count of distinct supplier_slug values in the inventory. Each supplier represents a data source (e.g. viator, getyourguide, stubhub) aggregated through Bridgify." />
          <Metric label="Cities" value={fmt(inventory.cities)}
            info="Count of distinct city values across active inventory. Used for geographic clustering and search scoping." />
          <Metric label="Embeddings" value={pct(cov.has_embedding, cov.total)} sub={`${fmt(cov.has_embedding)} / ${fmt(cov.total)}`}
            info="Items with a vector embedding (1536-dim OpenAI ada-002). Required for semantic search and embedding-based dedup. Items without embeddings are invisible to vector search." />
        </div>
        <div className="mt-3 bg-white border border-border-default rounded-card p-3">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">
            Data Coverage<Info tip="Percentage of active inventory items that have each field populated. Affects which ranking signals are real vs. fallback. Fields with 0% coverage (e.g. Reviews) mean the ranking engine uses a constant fallback value — no differentiation." />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {[
              { label: 'Rating', v: cov.has_rating, t: cov.total },
              { label: 'Reviews', v: cov.has_reviews, t: cov.total },
              { label: 'Price', v: cov.has_price, t: cov.total },
              { label: 'Duration', v: cov.has_duration, t: cov.total },
              { label: 'Description', v: cov.has_description, t: cov.total },
              { label: 'Images', v: cov.has_images, t: cov.total },
            ].map(({ label, v, t }) => (
              <div key={label} className="grid grid-cols-[90px_1fr_50px] gap-2 items-center text-[10px]">
                <span className="text-text-secondary flex items-center">{label}<Info tip={COVERAGE_INFO[label]} /></span>
                <Bar value={v} max={t} color={v / t > 0.5 ? 'bg-emerald-400' : v / t > 0.1 ? 'bg-amber-400' : 'bg-red-400'} />
                <span className="text-text-secondary font-mono text-right">{pct(v, t)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Dedup Eval */}
      <section>
        <SectionHeader info="Quality metrics for the embedding-based dedup engine. Items sharing a canonical_id are considered the same product from different suppliers (or duplicate listings). These stats measure how consistent those groupings are.">
          Dedup Quality
        </SectionHeader>
        <div className="grid grid-cols-4 gap-2">
          <Metric label="Clusters" value={fmt(dedup.clusters)}
            info="Number of distinct canonical_id groups. Each cluster represents one unique product that may have multiple listings across suppliers." />
          <Metric label="Duplicates Hidden" value={fmt(dedup.duplicates_hidden)}
            info="Items where canonical_id differs from their own id — these are duplicate listings that point to a canonical (primary) record. At search time, only the canonical is shown." />
          <Metric label="Category Match" value={`${catMatchPct}%`}
            sub={`${fmt(dedup.category_match?.same_cat)} / ${fmt(dedup.category_match?.total)} pairs`}
            warn={parseFloat(catMatchPct) < 70}
            info="Of all pairs within dedup clusters, what percentage share the same category. Suppliers often categorize the same tour differently (e.g. 'Architecture' vs 'Culture' for a Taj Mahal tour), so <100% is expected. Below 60% suggests false matches." />
          <Metric label="Cross-Supplier" value={`${crossSupplierPct}%`}
            sub={`${fmt(dedup.supplier_mix?.cross_supplier)} pairs`}
            info="Percentage of dedup pairs that span different suppliers (the primary dedup value). The rest are same-supplier duplicates, typically event listings with multiple dates from StubHub/LiveTickets." />
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="bg-white border border-border-default rounded-card p-3">
            <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">
              Price Spread Within Clusters<Info tip="For each dedup cluster with 2+ priced items, computes (MAX-MIN)/MIN as a percentage. Median 33% means the typical cluster's most expensive listing is 33% more than the cheapest. High P90 values indicate outlier clusters where items with very different prices were grouped — possible false matches or legitimate supplier price differences." />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs mt-2">
              <div>
                <div className="text-text-secondary text-[10px]">Median</div>
                <div className="font-mono font-medium">{dedup.price_spread?.median_pct ?? '—'}%</div>
              </div>
              <div>
                <div className="text-text-secondary text-[10px]">P90</div>
                <div className={`font-mono font-medium ${(dedup.price_spread?.p90_pct || 0) > 100 ? 'text-amber-600' : ''}`}>
                  {dedup.price_spread?.p90_pct ?? '—'}%
                </div>
              </div>
              <div>
                <div className="text-text-secondary text-[10px]">Avg</div>
                <div className="font-mono font-medium">{dedup.price_spread?.avg_pct ?? '—'}%</div>
              </div>
            </div>
            <div className="text-[10px] text-text-secondary mt-1">{fmt(dedup.price_spread?.clusters_with_prices)} clusters with prices</div>
          </div>

          <div className="bg-white border border-border-default rounded-card p-3">
            <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">
              Geo Spread Within Clusters<Info tip="Maximum haversine distance between any two items in the same dedup cluster. Median 0m means most clusters are co-located. P90 shows the long tail. P99 > 100km is a red flag — items in different cities grouped together, likely false dedup matches." />
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs mt-2">
              <div>
                <div className="text-text-secondary text-[10px]">Median</div>
                <div className="font-mono font-medium">{fmtM(dedup.geo_spread?.median_m)}</div>
              </div>
              <div>
                <div className="text-text-secondary text-[10px]">Avg</div>
                <div className="font-mono font-medium">{fmtM(dedup.geo_spread?.avg_m)}</div>
              </div>
              <div>
                <div className="text-text-secondary text-[10px]">P90</div>
                <div className={`font-mono font-medium ${(dedup.geo_spread?.p90_m || 0) > 50000 ? 'text-amber-600' : ''}`}>
                  {fmtM(dedup.geo_spread?.p90_m)}
                </div>
              </div>
              <div>
                <div className="text-text-secondary text-[10px]">P99</div>
                <div className={`font-mono font-medium ${(dedup.geo_spread?.p99_m || 0) > 100000 ? 'text-red-600' : ''}`}>
                  {fmtM(dedup.geo_spread?.p99_m)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-border-default rounded-card p-3 mt-3">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">
            Cluster Size Distribution<Info tip="How many items are in each dedup cluster. Size 1 = unique item (no duplicates found). Size 2 = one duplicate pair. Large clusters (9+) are often events with many date listings from StubHub/LiveTickets. Source: GROUP BY canonical_id." />
          </div>
          <SizeChart data={dedup.cluster_sizes} />
        </div>
      </section>

      {/* Attraction Eval */}
      <section>
        <SectionHeader info="Attraction clusters group related experiences under a single landmark or point of interest (e.g. all 'Colosseum' tours under one attraction). Built by the attraction-cluster job using name phrase extraction + geo proximity. Source: hub_attractions table + hub_static_inventory.attraction_id.">
          Attraction Clusters
        </SectionHeader>
        <div className="grid grid-cols-4 gap-2">
          <Metric label="Total Clusters" value={fmt(attractions.total_clusters)}
            info="Number of distinct attractions created. Each groups multiple experience listings that reference the same landmark or venue." />
          <Metric label="Experiences Linked" value={fmt(attractions.experiences_linked)}
            sub={`of ${fmt(attractions.total_experiences)}`}
            info="How many experience inventory items have been assigned to an attraction cluster (attraction_id IS NOT NULL). The remainder are standalone items not linked to any attraction." />
          <Metric label="Coverage" value={`${attrCoveragePct}%`} warn={parseFloat(attrCoveragePct) < 10}
            info="Experiences linked / total experiences. Low coverage is usually caused by the MIN_PHRASE_COUNT filter — short titles like 'City Tour' reduce to too few words after stop-word removal and get skipped." />
          <Metric label="City Consistency" value={pct(attractions.city_consistency?.same_city,
            (attractions.city_consistency?.same_city || 0) + (attractions.city_consistency?.multi_city || 0))}
            info="Percentage of attraction clusters where ALL experiences are in the same city. Should be ~100%. Multi-city clusters indicate the name-matching was too loose and grouped items from different locations." />
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="bg-white border border-border-default rounded-card p-3">
            <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">
              Category Consistency<Info tip="How many distinct categories appear within each attraction cluster. Avg 2.3 means the typical cluster has experiences in 2-3 categories. Expected to be >1 since suppliers categorize differently, but very high numbers may indicate loose clustering." />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs mt-2">
              <div>
                <div className="text-text-secondary text-[10px]">Avg Categories</div>
                <div className="font-mono font-medium">{attractions.category_consistency?.avg_categories ?? '—'}</div>
              </div>
              <div>
                <div className="text-text-secondary text-[10px]">Single Cat</div>
                <div className="font-mono font-medium">{fmt(attractions.category_consistency?.single_cat)}</div>
              </div>
              <div>
                <div className="text-text-secondary text-[10px]">Multi Cat</div>
                <div className="font-mono font-medium">{fmt(attractions.category_consistency?.multi_cat)}</div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-border-default rounded-card p-3">
            <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">
              Cluster Size Distribution<Info tip="Number of experiences per attraction cluster. Size 3 = minimum (MIN_PHRASE_COUNT). Large clusters (100+) are typically events with many date listings (e.g. 'Wizard of Oz' show with 600+ performance dates)." />
            </div>
            <SizeChart data={attractions.size_distribution} labelKey="size" />
          </div>
        </div>

        <div className="bg-white border border-border-default rounded-card p-3 mt-3">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">
            Largest Clusters<Info tip="Top 10 attraction clusters by total listing count. 'Unique Products' collapses same-title same-supplier records (event date slots) into one product. A cluster with 673 listings but 2 unique products is one event sold by 2 suppliers with many date slots each." />
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-text-secondary uppercase">
                <th className="text-left py-1">Name</th>
                <th className="text-left py-1">City</th>
                <th className="text-right py-1">
                  Unique Products<Info tip="Distinct (title + supplier) combinations. The real product count — date/ticket slots collapsed into one." />
                </th>
                <th className="text-right py-1">
                  Listings<Info tip="Total inventory records linked. High numbers with low unique products = event with many date slots." />
                </th>
              </tr>
            </thead>
            <tbody>
              {(attractions.largest_clusters || []).map((c, i) => (
                <tr key={i} className="border-t border-border-default">
                  <td className="py-1.5 font-medium">{c.display_name}</td>
                  <td className="py-1.5 text-text-secondary">{c.city}</td>
                  <td className="py-1.5 text-right font-mono font-medium">{c.unique_product_count ?? '—'}</td>
                  <td className="py-1.5 text-right font-mono text-text-secondary">{c.experience_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
