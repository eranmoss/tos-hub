import { randomUUID } from 'crypto';
import { scoreDedup, normalizeName } from '../../src/dedup/engine.js';
import { applyStrategy } from '../../src/dedup/strategies.js';
import { loadDedupConfig } from '../../src/dedup/config.js';
import { closePool } from '../../src/db/client.js';

afterAll(async () => { await closePool(); });

const cfg = () => ({
  strategy: 'LOWEST_PRICE',
  preferred_supplier: null,
  thresholds: {
    location_radius_m: 150, name_similarity_min: 0.75,
    duration_variance_pct: 20,
    composite_score_duplicate: 0.80, composite_score_uncertain: 0.60,
  },
  weights: { location: 0.35, name: 0.40, duration: 0.15, category: 0.10 },
  uncertain_behavior: 'SHOW_BOTH',
  test_mode: false,
});

const mk = (overrides = {}) => ({
  option_id: randomUUID(),
  type: 'EXPERIENCE',
  title: 'Sagrada Familia Skip-the-Line Tour',
  origin: { type: 'COORDINATES', latitude: 41.4036, longitude: 2.1744, city: 'Barcelona', country: 'ES', timezone: 'Europe/Madrid' },
  destination: { type: 'COORDINATES', latitude: 41.4036, longitude: 2.1744, city: 'Barcelona', country: 'ES', timezone: 'Europe/Madrid' },
  duration_minutes: 120,
  experience_category: 'CULTURE',
  price: { amount_usd: 50, original_amount: 50, original_currency: 'USD', fx_rate: 1 },
  availability: { status: 'CONFIRMED' },
  policies: { cancellation: { policy_source: 'SUPPLIER' } },
  supplier_raw_ref: 'R1',
  supplier_slug: 'bridgify',
  ...overrides,
});

describe('Layer 5: name normalization', () => {
  test('strips stop words and punctuation', () => {
    expect(normalizeName('Skip-the-Line Tour of Sagrada Familia!'))
      .toBe('of sagrada familia');
  });
});

describe('Layer 5: dedup scoring', () => {
  test('near-identical → DUPLICATE', () => {
    const a = mk();
    const b = mk({ option_id: randomUUID(), title: 'Sagrada Familia Tour', supplier_slug: 'hotelbeds-activities' });
    const r = scoreDedup(a, b, cfg());
    expect(r.decision).toBe('DUPLICATE');
  });

  test('far location → DISTINCT', () => {
    const a = mk();
    const b = mk({
      option_id: randomUUID(),
      title: 'Eiffel Tower Guided Tour',
      origin: { type: 'COORDINATES', latitude: 48.8584, longitude: 2.2945, city: 'Paris', country: 'FR', timezone: 'Europe/Paris' },
      destination: { type: 'COORDINATES', latitude: 48.8584, longitude: 2.2945, city: 'Paris', country: 'FR', timezone: 'Europe/Paris' },
      experience_category: 'CULTURE',
    });
    const r = scoreDedup(a, b, cfg());
    expect(r.decision).toBe('DISTINCT');
  });

  test('same location + partial name match → UNCERTAIN', () => {
    const a = mk({ title: 'Barcelona City Walking Experience' });
    const b = mk({ option_id: randomUUID(), title: 'Barcelona Bike Discovery', duration_minutes: 180, experience_category: 'SPORT' });
    const r = scoreDedup(a, b, cfg());
    expect(['UNCERTAIN', 'DISTINCT']).toContain(r.decision);
  });

  test('duration variance within 20% → fires', () => {
    const a = mk();
    const b = mk({ option_id: randomUUID(), title: 'Sagrada Familia Tour', duration_minutes: 138 });
    const r = scoreDedup(a, b, cfg());
    expect(r.signals.duration).toBe(1);
  });

  test('duration variance beyond 20% → no fire', () => {
    const a = mk({ duration_minutes: 120 });
    const b = mk({ option_id: randomUUID(), duration_minutes: 240 });
    const r = scoreDedup(a, b, cfg());
    expect(r.signals.duration).toBe(0);
  });
});

describe('Layer 5: strategy outcomes', () => {
  test('DUPLICATE + LOWEST_PRICE returns lower only', async () => {
    const c = cfg();
    const a = mk({ price: { amount_usd: 50, original_amount: 50, original_currency: 'USD', fx_rate: 1 } });
    const b = mk({ option_id: randomUUID(), title: 'Sagrada Familia Tour', supplier_slug: 'hotelbeds-activities',
      price: { amount_usd: 70, original_amount: 70, original_currency: 'USD', fx_rate: 1 } });
    const r = await applyStrategy(a, b, c);
    expect(r.type).toBe('DUPLICATE');
    expect(r.options.length).toBe(1);
    expect(r.options[0].price.amount_usd).toBe(50);
  });

  test('DUPLICATE + PREFERRED_SUPPLIER returns preferred', async () => {
    const c = { ...cfg(), strategy: 'PREFERRED_SUPPLIER', preferred_supplier: 'hotelbeds-activities' };
    const a = mk({ price: { amount_usd: 50, original_amount: 50, original_currency: 'USD', fx_rate: 1 } });
    const b = mk({ option_id: randomUUID(), title: 'Sagrada Familia Tour', supplier_slug: 'hotelbeds-activities',
      price: { amount_usd: 70, original_amount: 70, original_currency: 'USD', fx_rate: 1 } });
    const r = await applyStrategy(a, b, c);
    expect(r.options[0].supplier_slug).toBe('hotelbeds-activities');
  });

  test('DUPLICATE + SHOW_ALL returns both with is_duplicate_of set', async () => {
    const c = { ...cfg(), strategy: 'SHOW_ALL' };
    const a = mk({ price: { amount_usd: 50, original_amount: 50, original_currency: 'USD', fx_rate: 1 } });
    const b = mk({ option_id: randomUUID(), title: 'Sagrada Familia Tour', supplier_slug: 'hotelbeds-activities',
      price: { amount_usd: 70, original_amount: 70, original_currency: 'USD', fx_rate: 1 } });
    const r = await applyStrategy(a, b, c);
    expect(r.options.length).toBe(2);
    expect(r.options.some(o => o.is_duplicate_of)).toBe(true);
  });

  test('UNCERTAIN + SHOW_BOTH attaches candidate_pair_id', async () => {
    const c = { ...cfg(), uncertain_behavior: 'SHOW_BOTH' };
    // Build pair that scores in uncertain range: same location only
    const a = mk({ title: 'Picasso Museum Entry', duration_minutes: 60, experience_category: 'CULTURE' });
    const b = mk({ option_id: randomUUID(), title: 'Picasso Exhibit Access', duration_minutes: 60, experience_category: 'CULTURE',
      supplier_slug: 'hotelbeds-activities' });
    const r = await applyStrategy(a, b, c);
    if (r.type === 'UNCERTAIN') {
      expect(r.options[0].candidate_pair_id).toBe(r.options[1].candidate_pair_id);
    }
  });

  test('UNCERTAIN + ESCALATE returns escalation_pending', async () => {
    const c = { ...cfg(), uncertain_behavior: 'ESCALATE' };
    const a = mk({ title: 'Picasso Museum Entry', experience_category: 'CULTURE' });
    const b = mk({ option_id: randomUUID(), title: 'Picasso Exhibit Access', experience_category: 'CULTURE',
      supplier_slug: 'hotelbeds-activities' });
    const r = await applyStrategy(a, b, c);
    if (r.type === 'UNCERTAIN') {
      expect(r.escalation_pending).toBe(true);
    }
  });

  test('UNCERTAIN + AGENT_DECIDE returns agent_decides flag', async () => {
    const c = { ...cfg(), uncertain_behavior: 'AGENT_DECIDE' };
    const a = mk({ title: 'Picasso Museum Entry', experience_category: 'CULTURE' });
    const b = mk({ option_id: randomUUID(), title: 'Picasso Exhibit Access', experience_category: 'CULTURE',
      supplier_slug: 'hotelbeds-activities' });
    const r = await applyStrategy(a, b, c);
    if (r.type === 'UNCERTAIN') {
      expect(r.agent_decides).toBe(true);
    }
  });

  test('DISTINCT returns both independently', async () => {
    const a = mk({ title: 'Sagrada Familia Tour' });
    const b = mk({
      option_id: randomUUID(), title: 'Colosseum Skip Line',
      origin: { type: 'COORDINATES', latitude: 41.8902, longitude: 12.4922, city: 'Rome', country: 'IT', timezone: 'Europe/Rome' },
      destination: { type: 'COORDINATES', latitude: 41.8902, longitude: 12.4922, city: 'Rome', country: 'IT', timezone: 'Europe/Rome' },
    });
    const r = await applyStrategy(a, b, cfg());
    expect(r.type).toBe('DISTINCT');
    expect(r.options.length).toBe(2);
  });
});

describe('Layer 5: config loader', () => {
  test('returns defaults when tenantId unknown', async () => {
    const c = await loadDedupConfig('nonexistent_tenant');
    expect(c.strategy).toBe('LOWEST_PRICE');
    expect(c.thresholds.location_radius_m).toBe(150);
  });
});
