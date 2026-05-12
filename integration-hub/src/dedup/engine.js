import Fuse from 'fuse.js';
import { getDistance } from 'geolib';

const STOP_WORDS = ['tour','experience','visit','skip','the','a','an',
  'line','access','priority','guided','private','group','day',
  'half','full','ticket','trip','excursion'];

export const normalizeName = (name) =>
  String(name || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOP_WORDS.includes(w))
    .join(' ')
    .trim();

export const scoreDedup = (a, b, cfg) => {
  const distM = (a.origin?.latitude != null && b.origin?.latitude != null)
    ? getDistance(
        { latitude: a.origin.latitude, longitude: a.origin.longitude },
        { latitude: b.origin.latitude, longitude: b.origin.longitude }
      )
    : Infinity;
  const locationFires = distM <= cfg.thresholds.location_radius_m;

  const nb = normalizeName(b.title);
  const na = normalizeName(a.title);
  const fuse = new Fuse([{ n: nb }], { keys: ['n'], includeScore: true, threshold: 1.0 });
  const nameResult = fuse.search(na);
  const rawSim = nameResult[0] ? 1 - nameResult[0].score : 0;
  const nameContributes = rawSim >= cfg.thresholds.name_similarity_min;

  const aDur = a.duration_minutes || 0;
  const bDur = b.duration_minutes || 0;
  const durationFires = aDur > 0 && bDur > 0 &&
    Math.abs(aDur - bDur) / Math.max(aDur, bDur)
      <= cfg.thresholds.duration_variance_pct / 100;

  const categoryMatch = !!(a.experience_category &&
    a.experience_category === b.experience_category);

  const score =
    (locationFires    ? cfg.weights.location : 0) +
    (nameContributes  ? rawSim * cfg.weights.name : 0) +
    (durationFires    ? cfg.weights.duration : 0) +
    (categoryMatch    ? cfg.weights.category : 0);

  const signals = {
    location: locationFires ? 1 : 0,
    name: rawSim,
    duration: durationFires ? 1 : 0,
    category: categoryMatch ? 1 : 0,
  };

  let decision;
  if (score >= cfg.thresholds.composite_score_duplicate) decision = 'DUPLICATE';
  else if (score >= cfg.thresholds.composite_score_uncertain) decision = 'UNCERTAIN';
  else decision = 'DISTINCT';

  return { decision, score, signals };
};
