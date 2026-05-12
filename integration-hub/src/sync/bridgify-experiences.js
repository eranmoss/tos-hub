import { runSync } from './base-sync.js';
import { BridgifyExperiences } from '../suppliers/bridgify/experiences.js';

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));

// Bridgify's /attractions/products endpoint requires a search context;
// without it the API returns a limited default set. Iterate major cities
// to accumulate the full catalog. Duplicates are resolved at upsert time
// (supplier_raw_ref is the primary key).
const CITIES = [
  // Western Europe
  'Barcelona', 'Madrid', 'Seville', 'Valencia', 'Palma de Mallorca', 'Malaga', 'Granada', 'Bilbao', 'Ibiza',
  'London', 'Manchester', 'Liverpool', 'Oxford', 'Cambridge', 'Bath', 'Brighton',
  'Paris', 'Nice', 'Lyon', 'Marseille', 'Bordeaux', 'Strasbourg',
  'Rome', 'Milan', 'Florence', 'Venice', 'Naples', 'Amalfi', 'Cinque Terre', 'Turin', 'Bologna', 'Verona',
  'Amsterdam', 'Rotterdam', 'Brussels', 'Bruges', 'Antwerp',
  'Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne', 'Dresden', 'Salzburg',
  'Prague', 'Vienna', 'Budapest', 'Krakow', 'Warsaw', 'Bratislava', 'Zagreb',
  'Lisbon', 'Porto', 'Faro', 'Dublin', 'Edinburgh', 'Glasgow',
  'Athens', 'Santorini', 'Mykonos', 'Crete', 'Rhodes', 'Corfu',
  'Istanbul', 'Antalya', 'Cappadocia', 'Bodrum',
  // Scandinavia & Baltics
  'Copenhagen', 'Stockholm', 'Oslo', 'Helsinki', 'Reykjavik', 'Tallinn', 'Riga',
  // Americas
  'New York', 'Los Angeles', 'Las Vegas', 'Miami', 'Orlando', 'Chicago', 'San Francisco',
  'Washington', 'Boston', 'New Orleans', 'Nashville', 'San Diego', 'Honolulu', 'Seattle',
  'Cancun', 'Mexico City', 'Playa del Carmen', 'Tulum',
  'Rio de Janeiro', 'Sao Paulo', 'Buenos Aires', 'Lima', 'Cusco', 'Bogota', 'Cartagena',
  'Havana', 'San Juan', 'Punta Cana', 'Montego Bay', 'Aruba',
  'Toronto', 'Vancouver', 'Montreal',
  // Middle East & Africa
  'Dubai', 'Abu Dhabi', 'Doha', 'Muscat', 'Amman', 'Petra', 'Tel Aviv', 'Jerusalem',
  'Cape Town', 'Johannesburg', 'Marrakech', 'Fez', 'Cairo', 'Luxor', 'Nairobi', 'Zanzibar',
  // Asia Pacific
  'Bangkok', 'Phuket', 'Chiang Mai', 'Pattaya', 'Krabi',
  'Singapore', 'Bali', 'Jakarta', 'Kuala Lumpur', 'Langkawi',
  'Tokyo', 'Kyoto', 'Osaka', 'Seoul', 'Busan',
  'Hong Kong', 'Shanghai', 'Beijing', 'Taipei', 'Hanoi', 'Ho Chi Minh City',
  'Manila', 'Cebu', 'Phnom Penh', 'Siem Reap',
  'Sydney', 'Melbourne', 'Brisbane', 'Gold Coast', 'Auckland', 'Queenstown', 'Fiji',
  // India & Sri Lanka
  'Delhi', 'Mumbai', 'Goa', 'Jaipur', 'Agra', 'Colombo',
];

const TEXT_TERMS = ['tour', 'experience', 'tickets', 'activity', 'museum', 'food', 'adventure', 'cruise'];

const mapper = (raw) => {
  const id = raw?.uuid || raw?.id || raw?.external_id;
  if (!id) return null;
  const geo = raw.geolocation || raw.location || {};
  const firstCat = Array.isArray(raw.categories) ? raw.categories[0] : null;
  const catName = typeof firstCat === 'object' ? firstCat?.name : firstCat;
  return {
    supplier_raw_ref: String(id),
    type: 'EXPERIENCE',
    title: raw.title || raw.english_title || raw.name || 'Untitled',
    description: raw.description || raw.short_description || null,
    latitude: geo.lat != null ? Number(geo.lat) : (raw.latitude != null ? Number(raw.latitude) : null),
    longitude: geo.lng != null ? Number(geo.lng) : (raw.longitude != null ? Number(raw.longitude) : null),
    city: raw.external_city_name || raw.city_name || raw.city || geo.city || null,
    country: raw.external_country_name || raw.country_name || raw.country || geo.country || null,
    timezone: geo.timezone || raw.timezone || null,
    category: raw.category || catName || null,
    duration_minutes: raw.duration_minutes != null ? Number(raw.duration_minutes)
      : (raw.duration != null ? Number(raw.duration) : null),
    image_urls: raw.main_photo_url ? [raw.main_photo_url] : (Array.isArray(raw.images) ? raw.images : null),
    price_from: raw.price != null ? Number(raw.price) : null,
    price_currency: raw.currency || null,
    rating: raw.rating != null ? Number(raw.rating) : null,
    review_count: raw.number_of_reviews != null ? Number(raw.number_of_reviews) : null,
    raw_content: raw,
  };
};

const fetchAll = async function* (client, pageSize = 100) {
  const seen = new Set();
  let totalYielded = 0;
  for (const city of CITIES) {
    for (const text of TEXT_TERMS) {
      let page = 1;
      while (true) {
        let data;
        try {
          data = await client._authedRequest({
            method: 'GET',
            url: '/attractions/products/',
            params: { city_name: city, text_search: text, page, page_size: pageSize },
            operation: 'sync',
          });
        } catch (e) {
          log('bridgify_page_error', { city, text, page, error: e.message });
          break;
        }
        const records = data?.attractions || data?.results || data?.items || [];
        if (records.length === 0) break;
        // Deduplicate across cities/terms before yielding.
        const fresh = records.filter((r) => {
          const id = r?.uuid || r?.id || r?.external_id;
          if (!id) return false;
          const k = String(id);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        if (fresh.length) {
          totalYielded += fresh.length;
          yield { records: fresh };
        }
        if (records.length < pageSize) break;
        page += 1;
        if (totalYielded >= 50000) { log('bridgify_cap_reached', { totalYielded }); return; }
      }
    }
    log('bridgify_city_done', { city, unique_so_far: seen.size });
  }
};

export const syncBridgifyExperiences = async ({ clientId, clientSecret, baseUrl }) => {
  const client = new BridgifyExperiences({ clientId, clientSecret, baseUrl });
  log('bridgify_sync_start', { cities: CITIES.length, terms: TEXT_TERMS.length });
  return runSync({
    supplierSlug: 'bridgify',
    fetcher: () => fetchAll(client),
    mapper,
  });
};
