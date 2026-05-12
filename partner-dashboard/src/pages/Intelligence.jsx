import { useEffect, useState } from 'react';
import { usePageContext } from '../agent/usePageContext.js';
import { useNavigate } from 'react-router-dom';
import {
  getEscalations, getPrompts,
  triggerDedup, triggerLLMJudge, triggerGeoReview, triggerEnrichActivities,
  triggerAttractionCluster, triggerAttractionValidate, triggerPoiMatch,
  runEmbeddings,
} from '../api/dashboard.js';
import DedupConfigEditor from '../components/DedupConfigEditor.jsx';
import DedupClusterViewer from '../components/DedupClusterViewer.jsx';
import DedupReview from '../components/DedupReview.jsx';
import DedupLogTable from '../components/DedupLogTable.jsx';
import EscalationCard from '../components/EscalationCard.jsx';
import PromptCard from '../components/PromptCard.jsx';
import AttractionExplorer from '../components/AttractionExplorer.jsx';
import AttractionReview from '../components/AttractionReview.jsx';
import RankingConfigEditor from '../components/RankingConfigEditor.jsx';
import EvalDashboard from '../components/EvalDashboard.jsx';
import GoldDatasetEval from '../components/GoldDatasetEval.jsx';
import CategoryTaxonomy from '../components/CategoryTaxonomy.jsx';

const SECTIONS = [
  {
    key: 'dedup',
    label: 'Dedup',
    icon: '⊞',
    tabs: [
      { key: 'clusters', label: 'Clusters' },
      { key: 'review', label: 'Precision Review' },
      { key: 'config', label: 'Config' },
      { key: 'log', label: 'Log' },
    ],
  },
  {
    key: 'attractions',
    label: 'Attractions',
    icon: '◎',
    tabs: [
      { key: 'explorer', label: 'Explorer' },
      { key: 'attr-review', label: 'Review' },
    ],
  },
  {
    key: 'taxonomy',
    label: 'Taxonomy',
    icon: '⊟',
    tabs: [
      { key: 'taxonomy-browser', label: 'Browser' },
    ],
  },
  {
    key: 'ranking',
    label: 'Ranking',
    icon: '≡',
    tabs: [
      { key: 'weights', label: 'Weight Config' },
    ],
  },
  {
    key: 'eval',
    label: 'Eval',
    icon: '✓',
    tabs: [
      { key: 'stats', label: 'Statistics' },
      { key: 'gold', label: 'Gold Dataset' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    icon: '⚙',
    tabs: [
      { key: 'escalations', label: 'Escalations' },
      { key: 'prompts', label: 'Prompts' },
    ],
  },
];

const SECTION_ACTIONS = {
  dedup: [
    { label: 'Run Dedup', fn: triggerDedup, style: 'bg-accent text-white' },
    { label: 'LLM Judge', fn: triggerLLMJudge, style: 'border border-accent text-accent hover:bg-accent/5' },
    { label: 'Geo Review', fn: triggerGeoReview, style: 'border border-red-500 text-red-600 hover:bg-red-50' },
    { label: 'Build Embeddings', fn: runEmbeddings, style: 'border border-blue-500 text-blue-600 hover:bg-blue-50' },
    { label: 'Enrich Descriptions', fn: triggerEnrichActivities, style: 'border border-amber-500 text-amber-600 hover:bg-amber-50' },
  ],
  attractions: [
    { label: 'Cluster Attractions', fn: triggerAttractionCluster, style: 'bg-accent text-white' },
    { label: 'POI Match', fn: triggerPoiMatch, style: 'border border-emerald-500 text-emerald-600 hover:bg-emerald-50' },
    { label: 'Validate Attractions', fn: triggerAttractionValidate, style: 'border border-violet-500 text-violet-600 hover:bg-violet-50' },
  ],
  taxonomy: [],
  ranking: [],
  eval: [],
  system: [],
};

const PIPELINE_STEPS = [
  {
    num: '1',
    label: 'Sync Suppliers',
    where: 'Integrations page',
    color: 'bg-blue-500',
    desc: 'Fetches all products from each supplier API (Bridgify, HotelBeds, Viator) and upserts them into hub_static_inventory. Each product gets geo coordinates, title, description, category, pricing, and images. Records not seen in the latest sync are soft-deleted (is_active = false).',
  },
  {
    num: '2',
    label: 'Build Embeddings',
    where: 'Dedup section',
    color: 'bg-blue-400',
    desc: 'Generates vector embeddings for every product title using an embedding model. These are stored alongside the inventory records and power the name-similarity signal in dedup scoring — comparing "Eiffel Tower Skip-the-Line" vs "Tour Eiffel Priority" semantically rather than just string matching.',
  },
  {
    num: '3',
    label: 'Run Dedup',
    where: 'Dedup section',
    color: 'bg-indigo-500',
    desc: 'Pre-computes duplicate pairs across suppliers. For each product, finds nearby candidates (geo + embedding similarity), scores them using a composite model (location, name, duration, category), and writes results to hub_dedup_pairs. Pairs scoring above the threshold are marked DUPLICATE; uncertain ones are flagged for review. Products are assigned a canonical_id pointing to the best representative.',
  },
  {
    num: '4',
    label: 'Cluster Attractions',
    where: 'Attractions section',
    color: 'bg-emerald-500',
    desc: 'Groups products by real-world attraction. Uses geo-clustering (200m radius) combined with title phrase extraction — strips stop words and generic activity terms to find landmark names (e.g., "Eiffel Tower", "Colosseum"). Products within the same geo cluster sharing a landmark phrase are grouped into one attraction in hub_attractions. This is different from dedup: dedup says "these are the same product", clustering says "these products are all about the same place".',
  },
  {
    num: '5',
    label: 'POI Match',
    where: 'Attractions section',
    color: 'bg-teal-500',
    desc: 'Three-step process: (a) Migrate — promotes clusters from hub_attractions into hub_global_pois (the canonical, supplier-agnostic attraction registry — "one Eiffel Tower"). (b) Match — scans all unlinked inventory records and fuzzy-matches them to existing global POIs by geo + title similarity. (c) Refresh — updates experience_count on each global POI. After this, every product is linked to a canonical attraction via global_poi_id.',
  },
  {
    num: '6',
    label: 'Validate Attractions',
    where: 'Attractions section',
    color: 'bg-violet-500',
    desc: 'LLM-powered quality check. Samples attractions and asks Claude to evaluate whether the grouping makes sense — flags questionable clusters (e.g., "River Seine" grouping both dinner cruises and kayak tours). Flagged items appear in the Review tab for human decision (keep or dismantle).',
  },
];


const EVAL_STEPS = [
  {
    num: '1',
    label: 'Run the Pipeline First',
    color: 'bg-gray-400',
    desc: 'Before evaluating, you need inventory in the system. Run Sync → Embeddings → Dedup (see pipeline info on any other section). The eval measures how well the dedup engine is performing.',
  },
  {
    num: '2',
    label: 'Review Statistics Tab',
    color: 'bg-blue-500',
    desc: 'The Statistics tab shows a quality scorecard computed from live data — no gold dataset needed. It grades six dimensions: Embedding Coverage (are all items searchable?), Dedup Category Match (do paired items share categories?), Price Tightness (are prices consistent within clusters?), Geo Tightness (are clusters geographically coherent?), Attraction City Match (are attraction clusters in one city?), and Attraction Coverage (how many items are grouped?). Each gets an A-D grade. Hover the (i) icon on each metric for details.',
  },
  {
    num: '3',
    label: 'Check Coverage Gaps',
    color: 'bg-indigo-500',
    desc: 'The Data Coverage bars show what percentage of inventory has each field populated (rating, reviews, price, duration, description, images). Missing fields mean the ranking engine falls back to constants — no differentiation. If Reviews is 0%, all items get the same review score. Run "Enrich Descriptions" from the Dedup section to fill in missing descriptions via LLM.',
  },
  {
    num: '4',
    label: 'Investigate Dedup Quality',
    color: 'bg-amber-500',
    desc: 'The Dedup Quality section shows price spread and geo spread within clusters. High P90 price spread (>100%) may indicate false merges. P99 geo spread > 100km is a red flag — items in different cities grouped together. The cluster size distribution shows how items are distributed. Size 1 = unique (no dups found). Large clusters (9+) are often event listings with many date slots.',
  },
  {
    num: '5',
    label: 'Assess Attraction Clusters',
    color: 'bg-emerald-500',
    desc: 'The bottom section evaluates attraction groupings. City Consistency should be ~100% (all experiences in an attraction cluster should be in the same city). Coverage shows what fraction of experiences are assigned to an attraction. The "Largest Clusters" table helps spot over-aggressive clustering — a cluster with 600+ listings but only 2 unique products is an event with many date slots, not a real problem.',
  },
];

const GOLD_STEPS = [
  {
    num: '1',
    label: 'Sample 200 Pairs',
    color: 'bg-blue-500',
    desc: 'Click "Sample 200 Pairs" to create a stratified test set. The sampler picks pairs across 5 confidence bands: High Dup (sim > 0.90 — obvious duplicates), Medium Dup (0.85-0.90), Borderline (0.70-0.85 — the hard zone where most errors happen), Near Miss (0.60-0.70 — should be distinct), and Clear Distinct (random cross-city pairs as negative controls). This balanced sampling ensures you test the engine at every difficulty level, not just the easy cases.',
  },
  {
    num: '2',
    label: 'Label with LLM',
    color: 'bg-violet-500',
    desc: 'Click "Label with LLM" to have Claude examine each pair and assign a ground-truth label: DUPLICATE (same real-world product from different suppliers) or DISTINCT (different products). The LLM sees both titles, descriptions, suppliers, cities, categories, and prices. It provides a reasoning string you can review in the Pair Browser. This is your ground truth — the "right answer" the engine should produce.',
  },
  {
    num: '3',
    label: 'Run Eval',
    color: 'bg-accent',
    desc: 'Click "Run Eval" to compare the dedup engine\'s decisions against the gold labels. The engine re-scores each pair using the current thresholds and produces: Precision (of pairs the engine called DUPLICATE, how many really are? Low = false merges hiding unique products), Recall (of real duplicates, how many did the engine find? Low = missed dups showing redundant results), F1 (harmonic mean — single quality number). The per-band breakdown shows where the engine struggles.',
  },
  {
    num: '4',
    label: 'Tune Thresholds',
    color: 'bg-teal-500',
    desc: 'Use the threshold sliders to adjust the duplicate cutoff (above = merge) and uncertain cutoff (between uncertain and duplicate = flag for review). Move the duplicate threshold lower for more aggressive dedup (higher recall, lower precision) or higher for conservative dedup (higher precision, lower recall). Re-run eval after each change to see the P/R/F1 impact. When satisfied, update the dedup config to match.',
  },
  {
    num: '5',
    label: 'Review Mismatches',
    color: 'bg-red-500',
    desc: 'After eval, the Mismatches section shows pairs where the engine disagreed with the gold label. FP (False Positive) = engine merged two distinct products — check if the engine was too aggressive or if the LLM label was wrong. FN (False Negative) = engine missed a real duplicate — check if the titles are too different or the similarity threshold is too high. Use these to decide whether to tune thresholds or improve embeddings.',
  },
  {
    num: '6',
    label: 'Track Over Time',
    color: 'bg-gray-500',
    desc: 'The Eval History tab stores every eval run with its thresholds and results. After re-running dedup with new settings (e.g., different embedding model, adjusted weights), re-run eval on the same gold set to measure improvement. If you add new suppliers or significantly change inventory, click "Reset" and create a fresh gold dataset — the old one may no longer be representative.',
  },
];

const InfoModal = ({ title, subtitle, steps, footer, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
    <div
      className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[85vh] overflow-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
      </div>
      <div className="px-6 py-4 space-y-1">
        {steps.map((step, i) => (
          <div key={step.num} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full ${step.color} text-white text-xs font-bold flex items-center justify-center`}>
                {step.num}
              </div>
              {i < steps.length - 1 && <div className="w-0.5 flex-1 bg-gray-200 my-1" />}
            </div>
            <div className="pb-4 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-gray-900">{step.label}</span>
                {step.where && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{step.where}</span>}
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
      {footer && (
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 rounded-b-xl">
          <div className="text-[11px] text-gray-500 leading-relaxed">{footer}</div>
        </div>
      )}
    </div>
  </div>
);

const PIPELINE_FOOTER = <><strong>Typical full run:</strong> Sync (hours) → Embeddings (minutes) → Dedup (minutes) → Cluster (seconds) → POI Match (seconds) → Validate (minutes). After the initial run, only re-run stages whose inputs changed.</>;
const GOLD_FOOTER = <><strong>Tip:</strong> After tuning thresholds in the Gold Dataset, update the same values in Dedup → Config to apply them to the live pipeline. Then re-run dedup to apply the new thresholds to all inventory.</>;

const SECTION_INFO = {
  dedup: { title: 'Intelligence Pipeline', subtitle: 'Run these stages in order. Each builds on the previous output.', steps: PIPELINE_STEPS, footer: PIPELINE_FOOTER },
  attractions: { title: 'Intelligence Pipeline', subtitle: 'Run these stages in order. Each builds on the previous output.', steps: PIPELINE_STEPS, footer: PIPELINE_FOOTER },
  eval: { title: 'How to Use Eval Statistics', subtitle: 'Understand and improve your dedup and clustering quality.', steps: EVAL_STEPS },
  taxonomy: null,
  ranking: null,
  system: null,
};

const GOLD_INFO = { title: 'How to Use the Gold Dataset', subtitle: 'Measure dedup precision and recall with a labeled test set.', steps: GOLD_STEPS, footer: GOLD_FOOTER };

const PROMPT_CATS = ['ALL', 'INVENTORY', 'INTEGRATION', 'PRICING', 'POLICY'];

export default function Intelligence() {
  const params = new URLSearchParams(window.location.search);
  const initSection = params.get('section') || 'dedup';
  const initTab = params.get('tab');
  const [section, setSection] = useState(initSection);
  const [tabBySection, setTabBySection] = useState({
    dedup: 'clusters',
    attractions: 'explorer',
    taxonomy: 'taxonomy-browser',
    ranking: 'weights',
    eval: 'stats',
    system: 'escalations',
    ...(initTab ? { [initSection]: initTab } : {}),
  });
  const [escalations, setEscalations] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [promptCat, setPromptCat] = useState('ALL');
  const [actionStatus, setActionStatus] = useState(null);
  const [showInfo, setShowInfo] = useState(null);
  const { register } = usePageContext();
  const navigate = useNavigate();

  const tab = tabBySection[section];
  const setTab = (t) => setTabBySection((prev) => ({ ...prev, [section]: t }));
  const currentSection = SECTIONS.find((s) => s.key === section);
  const actions = SECTION_ACTIONS[section] || [];

  const submitAction = (label, fn) => {
    setActionStatus({ text: `Starting ${label}...`, type: 'pending' });
    fn()
      .then(() => setActionStatus({ text: `${label} submitted — running in background.`, type: 'success' }))
      .catch((e) => setActionStatus({ text: `Error: ${e.message}`, type: 'error' }));
  };

  useEffect(() => { register('intelligence', { section, tab }); }, [section, tab, register]);

  useEffect(() => {
    if (tab === 'escalations') getEscalations().then((d) => setEscalations(d.escalations || []));
    if (tab === 'prompts') getPrompts().then((d) => setPrompts(d.prompts || []));
  }, [tab]);

  const shownPrompts = promptCat === 'ALL' ? prompts : prompts.filter((p) => p.category === promptCat);

  return (
    <div className="flex h-full">
      {/* Section sidebar */}
      <div className="w-[180px] shrink-0 border-r border-border-default bg-gray-50/50 py-4">
        <div className="px-4 mb-3 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Intelligence</span>
          {SECTION_INFO[section] && (
            <button
              type="button"
              onClick={() => setShowInfo(SECTION_INFO[section])}
              title="How does this work?"
              className="w-5 h-5 rounded-full border border-border-default text-text-secondary hover:bg-accent/10 hover:text-accent hover:border-accent flex items-center justify-center text-[10px] font-bold leading-none"
            >
              ?
            </button>
          )}
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={`w-full text-left px-4 py-2.5 text-sm font-medium flex items-center gap-2.5 transition-colors ${
              section === s.key
                ? 'bg-accent/10 text-accent border-r-2 border-accent'
                : 'text-text-secondary hover:bg-gray-100 hover:text-text-primary'
            }`}
          >
            <span className="text-base leading-none">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 p-6 overflow-auto">
        {/* Actions bar */}
        {actions.length > 0 && (
          <div className="bg-card-bg border border-border-default rounded-card p-3 mb-4">
            <div className="flex flex-wrap gap-2 items-center">
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => submitAction(a.label, a.fn)}
                  className={`rounded-btn text-xs px-3 py-1.5 hover:opacity-90 ${a.style}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {actionStatus && (
              <div
                className={`mt-3 flex items-center gap-3 text-xs px-3 py-2 rounded-btn ${
                  actionStatus.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : actionStatus.type === 'error'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}
              >
                <span className="flex-1">{actionStatus.text}</span>
                {actionStatus.type === 'success' && (
                  <button
                    type="button"
                    onClick={() => { navigate('/dashboard/system-log'); setActionStatus(null); }}
                    className="font-medium underline hover:no-underline whitespace-nowrap"
                  >
                    View in System Log
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActionStatus(null)}
                  className="text-current opacity-50 hover:opacity-100"
                >
                  &times;
                </button>
              </div>
            )}
          </div>
        )}

        {/* Sub-tabs */}
        {currentSection.tabs.length > 1 && (
          <div className="flex gap-1 mb-4">
            {currentSection.tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-btn border transition-colors ${
                  tab === t.key
                    ? 'bg-accent text-white border-accent'
                    : 'border-border-default text-text-secondary hover:bg-gray-50 hover:text-text-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Tab content */}
        {tab === 'clusters' && <DedupClusterViewer />}
        {tab === 'review' && <DedupReview />}
        {tab === 'config' && (
          <div className="bg-card-bg rounded-card border border-border-default p-4">
            <DedupConfigEditor />
          </div>
        )}
        {tab === 'log' && <DedupLogTable />}

        {tab === 'taxonomy-browser' && <CategoryTaxonomy />}

        {tab === 'weights' && (
          <div className="bg-card-bg rounded-card border border-border-default p-4">
            <RankingConfigEditor />
          </div>
        )}

        {tab === 'stats' && <EvalDashboard />}
        {tab === 'gold' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span />
              <button
                type="button"
                onClick={() => setShowInfo(GOLD_INFO)}
                className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-accent border border-border-default hover:border-accent rounded-btn px-2.5 py-1"
              >
                <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[9px] font-bold">?</span>
                How to use Gold Dataset
              </button>
            </div>
            <GoldDatasetEval />
          </div>
        )}

        {tab === 'explorer' && <AttractionExplorer />}
        {tab === 'attr-review' && <AttractionReview />}

        {tab === 'escalations' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {escalations.map((e) => (
              <EscalationCard
                key={e.id}
                escalation={e}
                onResolved={(id) => setEscalations((arr) => arr.filter((x) => x.id !== id))}
              />
            ))}
            {escalations.length === 0 && (
              <div className="text-text-secondary text-sm">No escalations</div>
            )}
          </div>
        )}
        {tab === 'prompts' && (
          <div>
            <div className="flex gap-1 mb-3">
              {PROMPT_CATS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPromptCat(c)}
                  className={`text-xs px-3 py-1 rounded-btn border ${
                    promptCat === c
                      ? 'bg-accent text-white border-accent'
                      : 'border-border-default text-text-secondary'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {shownPrompts.map((p) => (
                <PromptCard key={p.id} prompt={p} />
              ))}
              {shownPrompts.length === 0 && (
                <div className="text-text-secondary text-sm">No prompts</div>
              )}
            </div>
          </div>
        )}
      </div>

      {showInfo && <InfoModal {...showInfo} onClose={() => setShowInfo(null)} />}
    </div>
  );
}
