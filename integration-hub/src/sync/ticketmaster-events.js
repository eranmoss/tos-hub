import axios from 'axios';
import { runSync } from './base-sync.js';

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));

const BASE_URL = 'https://app.ticketmaster.com/discovery/v2';
const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const DELAY_MS = 250;
const PER_COUNTRY_LIMIT = 10000;

const COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'IE', 'MX', 'NZ'];
const CLASSIFICATIONS = ['Music', 'Sports', 'Arts & Theatre', 'Film', 'Miscellaneous', null];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const extractImages = (images) => {
  if (!Array.isArray(images) || images.length === 0) return null;
  const seen = new Set();
  const urls = [];
  for (const img of images) {
    if (!img.url || seen.has(img.url)) continue;
    seen.add(img.url);
    urls.push(img.url);
    if (urls.length >= 5) break;
  }
  return urls.length > 0 ? urls : null;
};

const extractVenue = (event) => {
  const venues = event._embedded?.venues;
  if (!Array.isArray(venues) || venues.length === 0) return {};
  const v = venues[0];
  return {
    city: v.city?.name || null,
    country: v.country?.countryCode || null,
    timezone: v.timezone || null,
    latitude: v.location?.latitude != null ? Number(v.location.latitude) : null,
    longitude: v.location?.longitude != null ? Number(v.location.longitude) : null,
  };
};

const extractCategory = (event) => {
  const cls = event.classifications;
  if (!Array.isArray(cls) || cls.length === 0) return null;
  const primary = cls.find(c => c.primary) || cls[0];
  return primary?.segment?.name || primary?.genre?.name || null;
};

const extractPrice = (event) => {
  const ranges = event.priceRanges;
  if (!Array.isArray(ranges) || ranges.length === 0) return { price: null, currency: null };
  return {
    price: ranges[0].min != null ? Number(ranges[0].min) : null,
    currency: ranges[0].currency || 'USD',
  };
};

const mapper = (raw) => {
  if (!raw?.id) return null;
  const venue = extractVenue(raw);
  const { price, currency } = extractPrice(raw);

  return {
    supplier_raw_ref: raw.id,
    type: 'EXPERIENCE',
    title: raw.name || `Ticketmaster ${raw.id}`,
    description: raw.info || raw.pleaseNote || null,
    latitude: venue.latitude,
    longitude: venue.longitude,
    city: venue.city,
    country: venue.country,
    timezone: venue.timezone,
    category: extractCategory(raw),
    duration_minutes: null,
    image_urls: extractImages(raw.images),
    price_from: price,
    price_currency: currency,
    rating: null,
    review_count: null,
    raw_content: raw,
  };
};

const fetchEvents = async function* (client) {
  let totalFetched = 0;
  let totalRequests = 0;
  const seen = new Set();

  for (const country of COUNTRIES) {
    let countryCount = 0;

    for (const cls of CLASSIFICATIONS) {
      if (countryCount >= PER_COUNTRY_LIMIT) break;
      let page = 0;

      while (page < MAX_PAGES && countryCount < PER_COUNTRY_LIMIT) {
        let data;
        try {
          const params = {
            countryCode: country,
            size: PAGE_SIZE,
            page,
            sort: 'relevance,desc',
          };
          if (cls) params.classificationName = cls;
          const resp = await client.get('/events.json', { params });
          data = resp.data;
          totalRequests++;
        } catch (e) {
          if (e.response?.status === 429) {
            log('ticketmaster_rate_limited', { country, cls, waiting_ms: 60000 });
            await sleep(60000);
            continue;
          }
          if (e.response?.status === 400) break;
          log('ticketmaster_fetch_error', { country, cls, page, error: e.message });
          break;
        }

        const events = data?._embedded?.events || [];
        if (events.length === 0) break;

        const fresh = events.filter(e => {
          if (!e.id || seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });

        if (fresh.length > 0) {
          totalFetched += fresh.length;
          countryCount += fresh.length;
          yield { records: fresh };
        }

        page += 1;
        if (page >= (data?.page?.totalPages || 0)) break;
        await sleep(DELAY_MS);
      }
    }

    log('ticketmaster_country_done', { country, countryCount, totalFetched, requests: totalRequests, unique: seen.size });
  }

  log('ticketmaster_fetch_done', { totalFetched, totalRequests, uniqueEvents: seen.size });
};

export const syncTicketmasterEvents = async ({ apiKey, supplierSlug = 'ticketmaster' }) => {
  if (!apiKey) throw new Error('Ticketmaster API key is required');

  const client = axios.create({
    baseURL: BASE_URL,
    params: { apikey: apiKey },
    timeout: 15000,
  });

  try {
    await client.get('/events.json', { params: { size: 1 } });
  } catch (e) {
    if (e.response?.status === 401) throw new Error('Ticketmaster API key is invalid');
    throw e;
  }

  log('ticketmaster_sync_start', { supplierSlug, perCountryLimit: PER_COUNTRY_LIMIT, countries: COUNTRIES.length });

  return runSync({
    supplierSlug,
    fetcher: () => fetchEvents(client),
    mapper,
  });
};
