import axios from 'axios';
import { runSync } from './base-sync.js';

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));

const SANDBOX_URL = 'https://api.sandbox.viator.com/partner';
const PROD_URL = 'https://api.viator.com/partner';
const PAGE_SIZE = 500;
const DELAY_MS = 70; // ~14 req/s, well under 150/10s limit

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const buildClient = (apiKey, env) => {
  const baseURL = env === 'production' ? PROD_URL : SANDBOX_URL;
  return axios.create({
    baseURL,
    headers: {
      'exp-api-key': apiKey,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en',
    },
    timeout: 30000,
  });
};

const extractDuration = (itinerary) => {
  const dur = itinerary?.duration;
  if (!dur) return null;
  if (dur.fixedDurationInMinutes) return dur.fixedDurationInMinutes;
  if (dur.variableDurationFromMinutes && dur.variableDurationToMinutes)
    return Math.round((dur.variableDurationFromMinutes + dur.variableDurationToMinutes) / 2);
  if (dur.variableDurationFromMinutes) return dur.variableDurationFromMinutes;
  return null;
};

const extractImages = (images) => {
  if (!Array.isArray(images)) return null;
  const urls = [];
  for (const img of images) {
    if (!Array.isArray(img.variants) || img.variants.length === 0) continue;
    // Pick largest variant
    const best = img.variants.reduce((a, b) =>
      (b.width || 0) > (a.width || 0) ? b : a, img.variants[0]);
    if (best?.url) urls.push(best.url);
  }
  return urls.length > 0 ? urls : null;
};

const extractLocation = (product) => {
  // Try logistics.start first
  const starts = product.logistics?.start;
  if (Array.isArray(starts)) {
    for (const s of starts) {
      const loc = s.location;
      if (loc?.ref?.latitude != null) return { lat: loc.ref.latitude, lng: loc.ref.longitude };
      if (loc?.latitude != null) return { lat: loc.latitude, lng: loc.longitude };
    }
  }
  // Try itinerary pointsOfInterest
  const pois = product.itinerary?.pointsOfInterest;
  if (Array.isArray(pois)) {
    for (const poi of pois) {
      const loc = poi.location;
      if (loc?.latitude != null) return { lat: loc.latitude, lng: loc.longitude };
      if (loc?.ref?.latitude != null) return { lat: loc.ref.latitude, lng: loc.ref.longitude };
    }
  }
  return null;
};

const extractCity = (product) => {
  // Destinations array — primary destination
  const dests = product.destinations;
  if (Array.isArray(dests)) {
    const primary = dests.find(d => d.primary) || dests[0];
    if (primary?.name) return primary.name;
    if (primary?.ref?.name) return primary.ref.name;
  }
  // Fallback: logistics start description
  const starts = product.logistics?.start;
  if (Array.isArray(starts) && starts[0]?.description) {
    return starts[0].description.split(',')[0].trim();
  }
  return null;
};

const extractCategory = (tags) => {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  // Tags are numeric IDs; store the first one as category
  // Full taxonomy mapping done via hub_schema_mappings after tag fetch
  const first = tags[0];
  return typeof first === 'object' ? (first.name || first.tagId?.toString()) : String(first);
};

const mapper = (raw) => {
  if (!raw?.productCode) return null;
  if (raw.status === 'INACTIVE') return null;

  const geo = extractLocation(raw);
  const reviews = raw.reviews || {};

  return {
    supplier_raw_ref: raw.productCode,
    type: 'EXPERIENCE',
    title: raw.title || `Viator ${raw.productCode}`,
    description: raw.description || null,
    latitude: geo?.lat != null ? Number(geo.lat) : null,
    longitude: geo?.lng != null ? Number(geo.lng) : null,
    city: extractCity(raw),
    country: null, // resolved from destinations endpoint later
    timezone: raw.timeZone || null,
    category: extractCategory(raw.tags),
    duration_minutes: extractDuration(raw.itinerary),
    image_urls: extractImages(raw.images),
    price_from: raw.pricingInfo?.summary?.fromPrice != null
      ? Number(raw.pricingInfo.summary.fromPrice) : null,
    price_currency: raw.pricingInfo?.currency || 'USD',
    rating: reviews.combinedAverageRating != null
      ? Number(reviews.combinedAverageRating) : null,
    review_count: reviews.totalReviews != null
      ? Number(reviews.totalReviews) : null,
    raw_content: raw,
  };
};

const fetchDestinations = async (client) => {
  const resp = await client.get('/destinations');
  const all = resp.data?.destinations || resp.data || [];
  return all.filter(d => d.type === 'CITY' || d.type === 'REGION');
};

const fetchByDestination = async function* (client, destinations) {
  let totalFetched = 0;
  const seen = new Set();

  for (let di = 0; di < destinations.length; di++) {
    const dest = destinations[di];
    const destId = String(dest.destinationId || dest.ref);
    let start = 1;
    let destTotal = 0;

    while (true) {
      const body = {
        filtering: { destination: destId },
        currency: 'USD',
        pagination: { start, count: PAGE_SIZE },
      };

      let data;
      try {
        const resp = await client.post('/products/search', body);
        data = resp.data;
      } catch (e) {
        if (e.response?.status === 429) {
          log('viator_rate_limited', { dest: destId, waiting_ms: 5000 });
          await sleep(5000);
          continue;
        }
        log('viator_dest_error', { dest: destId, start, error: e.message, status: e.response?.status });
        break;
      }

      const products = data?.products || [];
      if (products.length === 0) break;

      const fresh = products.filter(p => {
        if (!p.productCode || seen.has(p.productCode)) return false;
        seen.add(p.productCode);
        return p.status !== 'INACTIVE';
      });

      if (fresh.length > 0) {
        totalFetched += fresh.length;
        destTotal += fresh.length;
        yield { records: fresh };
      }

      if (products.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
      await sleep(DELAY_MS);
    }

    if (di % 50 === 0 || destTotal > 0) {
      log('viator_dest_progress', { destIndex: di, destId, destName: dest.name, destTotal, totalFetched });
    }
  }

  log('viator_fetch_done', { totalFetched, destinations: destinations.length, uniqueProducts: seen.size });
};

export const syncViatorExperiences = async ({ apiKey, env = 'sandbox', supplierSlug = 'viator-direct' }) => {
  if (!apiKey) throw new Error('VIATOR_API_KEY is required');
  const client = buildClient(apiKey, env);

  // Quick auth check
  try {
    await client.post('/products/search', {
      filtering: { destination: '732' },
      currency: 'USD',
      pagination: { start: 1, count: 1 },
    });
  } catch (e) {
    if (e.response?.status === 401) throw new Error('Viator API key is invalid or not yet activated');
    throw e;
  }

  log('viator_sync_start', { env, supplierSlug });

  const destinations = await fetchDestinations(client);
  log('viator_destinations_loaded', { count: destinations.length });

  return runSync({
    supplierSlug,
    fetcher: () => fetchByDestination(client, destinations),
    mapper,
  });
};
