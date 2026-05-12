import { query } from '../db/client.js';

const DEFAULT_WEIGHTS = {
  semantic: 0.55,
  popularity: 0.15,
  rating: 0.10,
  margin: 0.10,
  availability: 0.07,
  supplier_priority: 0.03,
};

const DEFAULT_CONFIG = {
  weights: DEFAULT_WEIGHTS,
  popularity_fallback: 0.3,
  rating_fallback: 0.5,
  margin_fallback: 0.3,
  availability_fallback: 0.5,
  rating_confidence_threshold: 50,
  boost_events_with_availability: true,
};

export const loadRankingConfig = async (tenantId) => {
  const { rows } = await query(
    `SELECT config_json FROM hub_ranking_config
     WHERE tenant_id = $1 AND is_active = true
     ORDER BY updated_at DESC LIMIT 1`,
    [tenantId],
  );
  if (!rows[0]) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...rows[0].config_json };
};

export const saveRankingConfig = async (tenantId, config) => {
  const merged = { ...DEFAULT_CONFIG, ...config };
  await query(`
    INSERT INTO hub_ranking_config (tenant_id, config_json, is_active)
    VALUES ($1, $2, true)
    ON CONFLICT (tenant_id) WHERE is_active = true
    DO UPDATE SET config_json = $2, updated_at = now()
  `, [tenantId, JSON.stringify(merged)]);
  return merged;
};

const ratingScore = (item, cfg) => {
  if (item.rating == null) return cfg.rating_fallback;
  const raw = item.rating / 5.0;
  const confidence = Math.min(1, (item.review_count || 0) / cfg.rating_confidence_threshold);
  return raw * confidence + cfg.rating_fallback * (1 - confidence);
};

const popularityScore = (item, cfg) => {
  const bookings = item.booking_count || 0;
  const reviews = item.review_count || 0;
  if (bookings === 0 && reviews === 0) return cfg.popularity_fallback;
  const signal = Math.log(bookings + reviews + 1) / Math.log(10000);
  return Math.min(1, signal);
};

const marginScore = (item, cfg) => {
  if (item.commission_rate == null) return cfg.margin_fallback;
  return Math.min(1, item.commission_rate / 30);
};

const contentQualityScore = (item) => {
  let score = 0;
  if (item.description) score += 0.35;
  if (item.image_urls?.length) score += 0.30;
  if (item.duration_minutes) score += 0.15;
  if (item.price_from) score += 0.10;
  if (item.category) score += 0.10;
  return score;
};

const supplierPriorityScore = (item, supplierPriorities) => {
  if (!supplierPriorities) return 0.5;
  const priority = supplierPriorities[item.supplier_slug];
  if (priority === 'preferred') return 1.0;
  if (priority === 'deprioritized') return 0.0;
  return 0.5;
};

export const rank = (candidates, cfg = DEFAULT_CONFIG, context = {}) => {
  const { supplierPriorities, availabilityMap } = context;
  const w = cfg.weights || DEFAULT_WEIGHTS;

  const scored = candidates.map(item => {
    const semantic = item.relevance || item.score || 0;
    const popularity = popularityScore(item, cfg);
    const rating = ratingScore(item, cfg);
    const margin = marginScore(item, cfg);
    const content = contentQualityScore(item);
    const supplierPri = supplierPriorityScore(item, supplierPriorities);

    let availability = cfg.availability_fallback;
    if (availabilityMap) {
      const avail = availabilityMap.get(item.id);
      if (avail === true) availability = 1.0;
      else if (avail === false) availability = 0.0;
    }

    const finalScore =
      semantic * w.semantic +
      popularity * w.popularity +
      rating * w.rating +
      margin * (w.margin || 0) +
      availability * w.availability +
      supplierPri * w.supplier_priority;

    return {
      ...item,
      final_score: parseFloat(finalScore.toFixed(4)),
      scoring: {
        semantic: parseFloat(semantic.toFixed(4)),
        popularity: parseFloat(popularity.toFixed(4)),
        rating: parseFloat(rating.toFixed(4)),
        margin: parseFloat(margin.toFixed(4)),
        content: parseFloat(content.toFixed(4)),
        availability: parseFloat(availability.toFixed(4)),
        supplier_priority: parseFloat(supplierPri.toFixed(4)),
      },
    };
  });

  scored.sort((a, b) => b.final_score - a.final_score);
  return scored;
};

export { DEFAULT_CONFIG, DEFAULT_WEIGHTS };
