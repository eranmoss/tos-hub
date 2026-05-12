import axios from 'axios';
import { runSync } from './base-sync.js';

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));

const BASE_URL = 'https://api.duffel.com';
const DELAY_MS = 600; // ~100 req/min, under 120/60s limit

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Major hub airports for the same 12 countries as Ticketmaster sync
const HUBS = [
  { country: 'US', airports: ['JFK', 'LAX', 'ORD', 'MIA'] },
  { country: 'GB', airports: ['LHR', 'MAN'] },
  { country: 'CA', airports: ['YYZ', 'YVR'] },
  { country: 'AU', airports: ['SYD', 'MEL'] },
  { country: 'DE', airports: ['FRA', 'MUC'] },
  { country: 'FR', airports: ['CDG'] },
  { country: 'ES', airports: ['MAD', 'BCN'] },
  { country: 'IT', airports: ['FCO', 'MXP'] },
  { country: 'NL', airports: ['AMS'] },
  { country: 'IE', airports: ['DUB'] },
  { country: 'MX', airports: ['MEX', 'CUN'] },
  { country: 'NZ', airports: ['AKL'] },
];

// Build cross-country routes from every hub to every other country's primary hub
const buildRoutes = () => {
  const routes = [];
  const allAirports = HUBS.flatMap(h => h.airports);
  for (let i = 0; i < allAirports.length; i++) {
    for (let j = i + 1; j < allAirports.length; j++) {
      routes.push([allAirports[i], allAirports[j]]);
    }
  }
  return routes;
};

const POPULAR_ROUTES = buildRoutes();

const DATE_OFFSETS = [7, 14, 30]; // days from now

const buildDates = () => {
  const now = new Date();
  return DATE_OFFSETS.map(offset => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  });
};

const mapper = (raw) => {
  if (!raw?.id) return null;
  const slice = raw.slices?.[0];
  const seg = slice?.segments?.[0];
  if (!seg) return null;

  const origin = seg.origin || {};
  const dest = seg.destination || {};
  const carrier = seg.operating_carrier || {};

  return {
    supplier_raw_ref: raw.id,
    type: 'FLIGHT',
    title: `${carrier.name || 'Flight'} ${origin.iata_code || ''}→${dest.iata_code || ''} ${seg.departing_at?.slice(0, 10) || ''}`,
    description: [
      `${carrier.name} ${seg.operating_carrier_flight_number || ''}`,
      slice?.fare_brand_name ? `Fare: ${slice.fare_brand_name}` : null,
      raw.conditions?.refund_before_departure?.allowed ? 'Refundable' : 'Non-refundable',
    ].filter(Boolean).join(' · '),
    latitude: null,
    longitude: null,
    city: origin.city_name || null,
    country: origin.iata_country_code || null,
    timezone: null,
    category: slice?.fare_brand_name || 'Economy',
    duration_minutes: parseDuration(seg.duration),
    image_urls: carrier.logo_symbol_url ? [carrier.logo_symbol_url] : null,
    price_from: raw.total_amount != null ? Number(raw.total_amount) : null,
    price_currency: raw.total_currency || 'USD',
    rating: null,
    review_count: null,
    raw_content: {
      offer_id: raw.id,
      origin: origin.iata_code,
      origin_city: origin.city_name,
      destination: dest.iata_code,
      destination_city: dest.city_name,
      departing_at: seg.departing_at,
      arriving_at: seg.arriving_at,
      duration: seg.duration,
      carrier_name: carrier.name,
      carrier_iata: carrier.iata_code,
      flight_number: seg.operating_carrier_flight_number,
      fare_brand: slice?.fare_brand_name,
      cabin_class: slice?.segments?.[0]?.passengers?.[0]?.cabin_class || null,
      total_amount: raw.total_amount,
      total_currency: raw.total_currency,
      base_amount: raw.base_amount,
      tax_amount: raw.tax_amount,
      stops: seg.stops?.length || 0,
      conditions: raw.conditions || {},
      expires_at: raw.expires_at,
    },
  };
};

const parseDuration = (iso) => {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  return (parseInt(m[1] || 0) * 60) + parseInt(m[2] || 0);
};

const fetchFlights = async function* (client) {
  let totalFetched = 0;
  let totalRequests = 0;
  const seen = new Set();
  const dates = buildDates();

  log('duffel_plan', { routes: POPULAR_ROUTES.length, dates: dates.length, totalSearches: POPULAR_ROUTES.length * dates.length });

  for (const [origin, destination] of POPULAR_ROUTES) {
    for (const date of dates) {
      let offers;
      try {
        const resp = await client.post('/air/offer_requests', {
          data: {
            passengers: [{ type: 'adult' }],
            slices: [{ origin, destination, departure_date: date }],
            cabin_class: 'economy',
            max_connections: 1,
          },
        });
        offers = resp.data?.data?.offers || [];
        totalRequests++;
      } catch (e) {
        if (e.response?.status === 429) {
          log('duffel_rate_limited', { origin, destination, date, waiting_ms: 65000 });
          await sleep(65000);
          continue;
        }
        log('duffel_search_error', { origin, destination, date, error: e.message, status: e.response?.status });
        await sleep(DELAY_MS);
        continue;
      }

      // Take cheapest 5 offers per route+date to keep volume manageable
      const sorted = offers.sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
      const top = sorted.slice(0, 5);

      const fresh = top.filter(o => {
        if (!o.id || seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
      });

      if (fresh.length > 0) {
        totalFetched += fresh.length;
        yield { records: fresh };
      }

      await sleep(DELAY_MS);
    }

    if (totalRequests % 10 === 0) {
      log('duffel_progress', { route: `${origin}-${destination}`, totalFetched, totalRequests, unique: seen.size });
    }
  }

  log('duffel_fetch_done', { totalFetched, totalRequests, uniqueOffers: seen.size });
};

export const syncDuffelFlights = async ({ accessToken, supplierSlug = 'duffel' }) => {
  if (!accessToken) throw new Error('Duffel access token is required');

  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Duffel-Version': 'v2',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 30000,
  });

  // Auth check
  try {
    await client.post('/air/offer_requests', {
      data: {
        passengers: [{ type: 'adult' }],
        slices: [{ origin: 'LHR', destination: 'JFK', departure_date: '2026-07-15' }],
        cabin_class: 'economy',
      },
    });
  } catch (e) {
    if (e.response?.status === 401) throw new Error('Duffel access token is invalid');
    if (e.response?.status === 403) throw new Error('Duffel API access not enabled for this account');
    throw e;
  }

  log('duffel_sync_start', { supplierSlug });

  return runSync({
    supplierSlug,
    fetcher: () => fetchFlights(client),
    mapper,
  });
};
