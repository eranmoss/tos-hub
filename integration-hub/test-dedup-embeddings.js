import { pipeline } from '@xenova/transformers';
import Fuse from 'fuse.js';

const TEST_PAIRS = [
  // === OBVIOUS DUPLICATES ===
  {
    label: 'DUPLICATE — Big Fun Museum (exact title match)',
    a: { title: 'Big Fun Museum with Museum of Illusions Option - Ticket', supplier: 'bridgify', city: 'Barcelona', category: 'Museums' },
    b: { title: 'Big Fun Museum with Museum of Illusions Option - Ticket', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },
  {
    label: 'DUPLICATE — Barcelona Chill Out Catamaran',
    a: { title: 'Barcelona Chill Out Catamaran Cruise', supplier: 'bridgify', city: 'Barcelona', category: 'Nature' },
    b: { title: 'Barcelona Chill Out Catamaran Cruise', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },
  {
    label: 'DUPLICATE — Barcelona Card (different wording)',
    a: { title: 'Barcelona Card: 25+ Museums and Free Public Transportation', supplier: 'bridgify', city: 'Barcelona', category: 'Transportation' },
    b: { title: 'Barcelona Card with Guidebook - Access to 20+ Attractions', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },
  {
    label: 'DUPLICATE — Barcelona Tapas Tour (different framing)',
    a: { title: "Barcelona's Lunch or Dinner Tapas Tour: Food and Happiness", supplier: 'bridgify', city: 'Barcelona', category: 'Culinary Experiences' },
    b: { title: 'Barcelona Old Town Tapas Tour', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },
  {
    label: 'DUPLICATE — Aquarium (skip-the-line vs regular)',
    a: { title: 'Barcelona Aquarium Skip the Line Ticket', supplier: 'bridgify', city: 'Barcelona', category: 'Nature' },
    b: { title: 'Barcelona Aquarium: Entry Ticket', supplier: 'bridgify', city: 'Barcelona', category: 'Nature' },
  },
  {
    label: 'DUPLICATE — Hop-On Hop-Off (different suppliers)',
    a: { title: 'Barcelona Hop-On Hop-Off Bus Tour', supplier: 'bridgify', city: 'Barcelona', category: 'Guided Tours' },
    b: { title: 'Barcelona City Tour Hop-On Hop-Off', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },

  // === SHOULD BE UNCERTAIN / RELATED ===
  {
    label: 'UNCERTAIN — Gaudi tours (different scope)',
    a: { title: 'Barcelona Architecture & Gaudi Private Walking Tour (4h)', supplier: 'bridgify', city: 'Barcelona', category: 'Architecture' },
    b: { title: 'Barcelona Gaudi Masterpieces and Sagrada Familia by bike - Half-Day Tour', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },
  {
    label: 'UNCERTAIN — Food tours (walking vs tapas)',
    a: { title: 'Barcelona Food Tour: Market & Gothic Quarter with Expert Guide', supplier: 'bridgify', city: 'Barcelona', category: 'Culinary Experiences' },
    b: { title: 'Barcelona Art and Tapas with Picasso Museum - Walking Tour', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },

  // === CLEARLY DISTINCT ===
  {
    label: 'DISTINCT — Flamenco vs Catamaran',
    a: { title: 'Authentic Flamenco Show Barcelona : Intimate Casa Sors Experience', supplier: 'bridgify', city: 'Barcelona', category: 'Music' },
    b: { title: 'Barcelona Chill Out Catamaran Cruise', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },
  {
    label: 'DISTINCT — Museum vs Bike Tour',
    a: { title: 'Banksy Museum Barcelona: Skip The Line Ticket', supplier: 'bridgify', city: 'Barcelona', category: 'Museums' },
    b: { title: 'Barcelona by E-Bike: From Coastline to the Vineyards with Wine Tour and Tasting', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },
  {
    label: 'DISTINCT — Barcelona vs Madrid (different city!)',
    a: { title: 'Barcelona Highlights Tour', supplier: 'bridgify', city: 'Barcelona', category: 'Guided Tours' },
    b: { title: 'Madrid Highlights Tour', supplier: 'hotelbeds-activities', city: 'Madrid', category: 'TICKET' },
  },
  {
    label: 'DISTINCT — Ceramic workshop vs Sagrada Familia',
    a: { title: 'Artisan Ceramic Experience: Private Events and Team Building', supplier: 'bridgify', city: 'Barcelona', category: 'Classes & workshops' },
    b: { title: 'Sagrada Familia with Official Guide and Fast-Track Entry - Small Group Tour', supplier: 'hotelbeds-activities', city: 'Barcelona', category: 'TICKET' },
  },
];

const STOP_WORDS = new Set([
  'tour', 'experience', 'visit', 'skip', 'the', 'a', 'an', 'in', 'of', 'and',
  'with', 'from', 'for', 'to', 'by', 'at', 'on', 'or',
  'line', 'access', 'priority', 'guided', 'private', 'group', 'day',
  'half', 'full', 'ticket', 'trip', 'excursion', 'entry', 'admission',
  'small', 'walking', 'ride', 'pass', 'option', 'included', 'free',
]);

const normalize = (text) =>
  String(text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOP_WORDS.has(w))
    .join(' ')
    .trim();

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

const fuzzyScore = (normA, normB) => {
  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0;
  const fuse = new Fuse([{ n: normB }], { keys: ['n'], includeScore: true, threshold: 1.0 });
  const result = fuse.search(normA);
  return result[0] ? 1 - result[0].score : 0;
};

// OR-gate decision: multiple independent paths to DUPLICATE
const decide = (embSim, fuzzySim, a, b) => {
  const sameCity = a.city.toLowerCase() === b.city.toLowerCase();
  if (!sameCity) return { decision: 'DISTINCT', rule: 'diff_city' };

  // Same Bridgify category that differs → less likely duplicate
  const bothHaveCat = a.category && b.category && a.category !== 'TICKET' && b.category !== 'TICKET';
  const catMismatch = bothHaveCat && a.category.toLowerCase() !== b.category.toLowerCase();

  // Rule 1: Near-exact text match (fuzzy catches lexical similarity)
  if (fuzzySim >= 0.90) return { decision: 'DUPLICATE', rule: 'fuzzy>=0.90' };

  // Rule 2: Strong semantic match (embeddings catch meaning)
  const embThreshold = catMismatch ? 0.90 : 0.85;
  if (embSim >= embThreshold) return { decision: 'DUPLICATE', rule: `emb>=${embThreshold}` };

  // Rule 3: Mutual confirmation (both moderate)
  if (embSim >= 0.75 && fuzzySim >= 0.55) return { decision: 'DUPLICATE', rule: 'mutual' };

  return { decision: 'DISTINCT', rule: 'below_all' };
};

const run = async () => {
  console.log('Loading embedding model...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Model loaded.\n');

  // Embed RAW titles (model needs full context), normalize only for fuzzy
  const texts = [];
  const textMap = new Map();
  for (const pair of TEST_PAIRS) {
    for (const item of [pair.a, pair.b]) {
      const input = `${item.title} | ${item.city}`;
      if (!textMap.has(input)) {
        textMap.set(input, texts.length);
        texts.push(input);
      }
    }
  }

  console.log(`Embedding ${texts.length} unique texts...`);
  const embeddings = [];
  for (const text of texts) {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    embeddings.push(Array.from(output.data));
  }
  console.log(`Done.\n`);

  console.log('='.repeat(115));
  console.log('OR-GATE MULTI-SIGNAL: fuzzy>=0.90 OR emb>=0.85 OR (emb>=0.75 AND fuzzy>=0.55) + category penalty');
  console.log('='.repeat(115));
  console.log('PAIR'.padEnd(55) + 'EMB    FUZZY  VERDICT       RULE');
  console.log('-'.repeat(115));

  let correct = 0;
  for (const pair of TEST_PAIRS) {
    const normA = normalize(pair.a.title);
    const normB = normalize(pair.b.title);
    const keyA = `${pair.a.title} | ${pair.a.city}`;
    const keyB = `${pair.b.title} | ${pair.b.city}`;
    const embSim = cosine(embeddings[textMap.get(keyA)], embeddings[textMap.get(keyB)]);
    const fSim = fuzzyScore(normA, normB);
    const { decision, rule } = decide(embSim, fSim, pair.a, pair.b);

    const expected = pair.label.split(' — ')[0];
    const ok = expected === decision;
    if (ok) correct++;
    console.log(
      `${pair.label.substring(0, 54).padEnd(55)} ${embSim.toFixed(2)}   ${fSim.toFixed(2)}   ${decision.padEnd(12)}  ${rule} ${!ok ? '<-- MISS' : ''}`
    );
  }
  console.log(`\nAccuracy: ${correct}/${TEST_PAIRS.length} (${(correct/TEST_PAIRS.length*100).toFixed(0)}%)`);
};

run().catch(e => { console.error(e); process.exit(1); });
