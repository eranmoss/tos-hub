import axios from 'axios';
import { runSync } from './base-sync.js';
import { buildHeaders } from '../suppliers/hotelbeds/auth.js';

const SANDBOX = 'https://api.test.hotelbeds.com/activity-cache-api/1.0';
const PROD = 'https://api.hotelbeds.com/activity-cache-api/1.0';

// HotelBeds activity-cache-api requires a destination code per request.
// More destinations = more activities = better dedup coverage vs Bridgify.
const DESTINATIONS = [
  // Spain
  'BCN', 'PMI', 'MAD', 'IBZ', 'AGP', 'ALC', 'TCI', 'LPA', 'SVQ', 'VLC', 'BIO', 'GRX',
  // UK & Ireland
  'LON', 'MAN', 'EDI', 'DUB', 'LIV', 'BHX',
  // France
  'PAR', 'NCE', 'LYS', 'MRS', 'BOD', 'SXB',
  // Italy
  'ROM', 'MIL', 'VEN', 'FLR', 'NAP', 'BLQ', 'TRN', 'VRN',
  // Central Europe
  'AMS', 'BER', 'MUC', 'HAM', 'FRA', 'CGN', 'PRG', 'VIE', 'BUD', 'WAW', 'KRK', 'BTS', 'ZAG',
  // Iberian + Portugal
  'LIS', 'OPO', 'FAO',
  // Scandinavia & Baltics
  'CPH', 'STO', 'OSL', 'HEL', 'REK', 'TLL', 'RIX',
  // Greece & Turkey
  'ATH', 'JTR', 'JMK', 'HER', 'RHO', 'IST', 'AYT', 'BJV',
  // Americas — North
  'NYC', 'MIA', 'LAX', 'LAS', 'ORL', 'SFO', 'CHI', 'WAS', 'BOS', 'MSY', 'BNA', 'SAN', 'HNL', 'SEA',
  // Americas — Latin & Caribbean
  'CUN', 'MEX', 'PCM', 'GIG', 'SAO', 'BUE', 'LIM', 'CUZ', 'BOG', 'CTG',
  'HAV', 'SJU', 'PUJ', 'MBJ', 'AUA',
  // Canada
  'YTO', 'YVR', 'YUL',
  // Middle East
  'DXB', 'AUH', 'DOH', 'MCT', 'AMM', 'TLV',
  // Africa
  'CPT', 'JNB', 'RAK', 'FEZ', 'CAI', 'LXR', 'NBO', 'ZNZ',
  // Asia
  'BKK', 'HKT', 'CNX', 'SIN', 'DPS', 'KUL', 'TYO', 'KIX', 'ICN', 'HKG', 'PVG', 'PEK', 'TPE',
  'HAN', 'SGN', 'MNL', 'CEB', 'PNH', 'REP',
  // India & Sri Lanka
  'DEL', 'BOM', 'GOI', 'JAI', 'AGR', 'CMB',
  // Oceania
  'SYD', 'MEL', 'BNE', 'OOL', 'AKL', 'ZQN',
];

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));

// Map HotelBeds destination codes to city names + approximate coordinates.
// Used to populate city/lat/lng since the portfolio cache API doesn't include geo.
const DEST_GEO = {
  BCN: { city: 'Barcelona', country: 'ES', lat: 41.3874, lng: 2.1686 },
  PMI: { city: 'Palma de Mallorca', country: 'ES', lat: 39.5696, lng: 2.6502 },
  MAD: { city: 'Madrid', country: 'ES', lat: 40.4168, lng: -3.7038 },
  IBZ: { city: 'Ibiza', country: 'ES', lat: 38.9067, lng: 1.4206 },
  AGP: { city: 'Malaga', country: 'ES', lat: 36.7213, lng: -4.4213 },
  ALC: { city: 'Alicante', country: 'ES', lat: 38.3452, lng: -0.4810 },
  TCI: { city: 'Tenerife', country: 'ES', lat: 28.2916, lng: -16.6291 },
  LPA: { city: 'Gran Canaria', country: 'ES', lat: 27.9202, lng: -15.3876 },
  SVQ: { city: 'Seville', country: 'ES', lat: 37.3891, lng: -5.9845 },
  VLC: { city: 'Valencia', country: 'ES', lat: 39.4699, lng: -0.3763 },
  BIO: { city: 'Bilbao', country: 'ES', lat: 43.2630, lng: -2.9350 },
  GRX: { city: 'Granada', country: 'ES', lat: 37.1773, lng: -3.5986 },
  LON: { city: 'London', country: 'GB', lat: 51.5074, lng: -0.1278 },
  MAN: { city: 'Manchester', country: 'GB', lat: 53.4808, lng: -2.2426 },
  EDI: { city: 'Edinburgh', country: 'GB', lat: 55.9533, lng: -3.1883 },
  DUB: { city: 'Dublin', country: 'IE', lat: 53.3498, lng: -6.2603 },
  LIV: { city: 'Liverpool', country: 'GB', lat: 53.4084, lng: -2.9916 },
  BHX: { city: 'Birmingham', country: 'GB', lat: 52.4862, lng: -1.8904 },
  PAR: { city: 'Paris', country: 'FR', lat: 48.8566, lng: 2.3522 },
  NCE: { city: 'Nice', country: 'FR', lat: 43.7102, lng: 7.2620 },
  LYS: { city: 'Lyon', country: 'FR', lat: 45.7640, lng: 4.8357 },
  MRS: { city: 'Marseille', country: 'FR', lat: 43.2965, lng: 5.3698 },
  BOD: { city: 'Bordeaux', country: 'FR', lat: 44.8378, lng: -0.5792 },
  SXB: { city: 'Strasbourg', country: 'FR', lat: 48.5734, lng: 7.7521 },
  ROM: { city: 'Rome', country: 'IT', lat: 41.9028, lng: 12.4964 },
  MIL: { city: 'Milan', country: 'IT', lat: 45.4642, lng: 9.1900 },
  VEN: { city: 'Venice', country: 'IT', lat: 45.4408, lng: 12.3155 },
  FLR: { city: 'Florence', country: 'IT', lat: 43.7696, lng: 11.2558 },
  NAP: { city: 'Naples', country: 'IT', lat: 40.8518, lng: 14.2681 },
  BLQ: { city: 'Bologna', country: 'IT', lat: 44.4949, lng: 11.3426 },
  TRN: { city: 'Turin', country: 'IT', lat: 45.0703, lng: 7.6869 },
  VRN: { city: 'Verona', country: 'IT', lat: 45.4384, lng: 10.9917 },
  AMS: { city: 'Amsterdam', country: 'NL', lat: 52.3676, lng: 4.9041 },
  BER: { city: 'Berlin', country: 'DE', lat: 52.5200, lng: 13.4050 },
  MUC: { city: 'Munich', country: 'DE', lat: 48.1351, lng: 11.5820 },
  HAM: { city: 'Hamburg', country: 'DE', lat: 53.5511, lng: 9.9937 },
  FRA: { city: 'Frankfurt', country: 'DE', lat: 50.1109, lng: 8.6821 },
  CGN: { city: 'Cologne', country: 'DE', lat: 50.9375, lng: 6.9603 },
  PRG: { city: 'Prague', country: 'CZ', lat: 50.0755, lng: 14.4378 },
  VIE: { city: 'Vienna', country: 'AT', lat: 48.2082, lng: 16.3738 },
  BUD: { city: 'Budapest', country: 'HU', lat: 47.4979, lng: 19.0402 },
  WAW: { city: 'Warsaw', country: 'PL', lat: 52.2297, lng: 21.0122 },
  KRK: { city: 'Krakow', country: 'PL', lat: 50.0647, lng: 19.9450 },
  BTS: { city: 'Bratislava', country: 'SK', lat: 48.1486, lng: 17.1077 },
  ZAG: { city: 'Zagreb', country: 'HR', lat: 45.8150, lng: 15.9819 },
  LIS: { city: 'Lisbon', country: 'PT', lat: 38.7223, lng: -9.1393 },
  OPO: { city: 'Porto', country: 'PT', lat: 41.1579, lng: -8.6291 },
  FAO: { city: 'Faro', country: 'PT', lat: 37.0194, lng: -7.9322 },
  CPH: { city: 'Copenhagen', country: 'DK', lat: 55.6761, lng: 12.5683 },
  STO: { city: 'Stockholm', country: 'SE', lat: 59.3293, lng: 18.0686 },
  OSL: { city: 'Oslo', country: 'NO', lat: 59.9139, lng: 10.7522 },
  HEL: { city: 'Helsinki', country: 'FI', lat: 60.1699, lng: 24.9384 },
  REK: { city: 'Reykjavik', country: 'IS', lat: 64.1466, lng: -21.9426 },
  TLL: { city: 'Tallinn', country: 'EE', lat: 59.4370, lng: 24.7536 },
  RIX: { city: 'Riga', country: 'LV', lat: 56.9496, lng: 24.1052 },
  ATH: { city: 'Athens', country: 'GR', lat: 37.9838, lng: 23.7275 },
  JTR: { city: 'Santorini', country: 'GR', lat: 36.3932, lng: 25.4615 },
  JMK: { city: 'Mykonos', country: 'GR', lat: 37.4467, lng: 25.3289 },
  HER: { city: 'Heraklion', country: 'GR', lat: 35.3387, lng: 25.1442 },
  RHO: { city: 'Rhodes', country: 'GR', lat: 36.4341, lng: 28.2176 },
  IST: { city: 'Istanbul', country: 'TR', lat: 41.0082, lng: 28.9784 },
  AYT: { city: 'Antalya', country: 'TR', lat: 36.8969, lng: 30.7133 },
  BJV: { city: 'Bodrum', country: 'TR', lat: 37.0344, lng: 27.4305 },
  NYC: { city: 'New York', country: 'US', lat: 40.7128, lng: -74.0060 },
  MIA: { city: 'Miami', country: 'US', lat: 25.7617, lng: -80.1918 },
  LAX: { city: 'Los Angeles', country: 'US', lat: 34.0522, lng: -118.2437 },
  LAS: { city: 'Las Vegas', country: 'US', lat: 36.1699, lng: -115.1398 },
  ORL: { city: 'Orlando', country: 'US', lat: 28.5383, lng: -81.3792 },
  SFO: { city: 'San Francisco', country: 'US', lat: 37.7749, lng: -122.4194 },
  CHI: { city: 'Chicago', country: 'US', lat: 41.8781, lng: -87.6298 },
  WAS: { city: 'Washington', country: 'US', lat: 38.9072, lng: -77.0369 },
  BOS: { city: 'Boston', country: 'US', lat: 42.3601, lng: -71.0589 },
  MSY: { city: 'New Orleans', country: 'US', lat: 29.9511, lng: -90.0715 },
  BNA: { city: 'Nashville', country: 'US', lat: 36.1627, lng: -86.7816 },
  SAN: { city: 'San Diego', country: 'US', lat: 32.7157, lng: -117.1611 },
  HNL: { city: 'Honolulu', country: 'US', lat: 21.3069, lng: -157.8583 },
  SEA: { city: 'Seattle', country: 'US', lat: 47.6062, lng: -122.3321 },
  CUN: { city: 'Cancun', country: 'MX', lat: 21.1619, lng: -86.8515 },
  MEX: { city: 'Mexico City', country: 'MX', lat: 19.4326, lng: -99.1332 },
  PCM: { city: 'Playa del Carmen', country: 'MX', lat: 20.6296, lng: -87.0739 },
  GIG: { city: 'Rio de Janeiro', country: 'BR', lat: -22.9068, lng: -43.1729 },
  SAO: { city: 'Sao Paulo', country: 'BR', lat: -23.5505, lng: -46.6333 },
  BUE: { city: 'Buenos Aires', country: 'AR', lat: -34.6037, lng: -58.3816 },
  LIM: { city: 'Lima', country: 'PE', lat: -12.0464, lng: -77.0428 },
  CUZ: { city: 'Cusco', country: 'PE', lat: -13.5320, lng: -71.9675 },
  BOG: { city: 'Bogota', country: 'CO', lat: 4.7110, lng: -74.0721 },
  CTG: { city: 'Cartagena', country: 'CO', lat: 10.3910, lng: -75.5144 },
  HAV: { city: 'Havana', country: 'CU', lat: 23.1136, lng: -82.3666 },
  SJU: { city: 'San Juan', country: 'PR', lat: 18.4655, lng: -66.1057 },
  PUJ: { city: 'Punta Cana', country: 'DO', lat: 18.5601, lng: -68.3725 },
  MBJ: { city: 'Montego Bay', country: 'JM', lat: 18.4762, lng: -77.8939 },
  AUA: { city: 'Aruba', country: 'AW', lat: 12.5211, lng: -69.9683 },
  YTO: { city: 'Toronto', country: 'CA', lat: 43.6532, lng: -79.3832 },
  YVR: { city: 'Vancouver', country: 'CA', lat: 49.2827, lng: -123.1207 },
  YUL: { city: 'Montreal', country: 'CA', lat: 45.5017, lng: -73.5673 },
  DXB: { city: 'Dubai', country: 'AE', lat: 25.2048, lng: 55.2708 },
  AUH: { city: 'Abu Dhabi', country: 'AE', lat: 24.4539, lng: 54.3773 },
  DOH: { city: 'Doha', country: 'QA', lat: 25.2854, lng: 51.5310 },
  MCT: { city: 'Muscat', country: 'OM', lat: 23.5880, lng: 58.3829 },
  AMM: { city: 'Amman', country: 'JO', lat: 31.9454, lng: 35.9284 },
  TLV: { city: 'Tel Aviv', country: 'IL', lat: 32.0853, lng: 34.7818 },
  CPT: { city: 'Cape Town', country: 'ZA', lat: -33.9249, lng: 18.4241 },
  JNB: { city: 'Johannesburg', country: 'ZA', lat: -26.2041, lng: 28.0473 },
  RAK: { city: 'Marrakech', country: 'MA', lat: 31.6295, lng: -7.9811 },
  FEZ: { city: 'Fez', country: 'MA', lat: 34.0181, lng: -5.0078 },
  CAI: { city: 'Cairo', country: 'EG', lat: 30.0444, lng: 31.2357 },
  LXR: { city: 'Luxor', country: 'EG', lat: 25.6872, lng: 32.6396 },
  NBO: { city: 'Nairobi', country: 'KE', lat: -1.2921, lng: 36.8219 },
  ZNZ: { city: 'Zanzibar', country: 'TZ', lat: -6.1659, lng: 39.2026 },
  BKK: { city: 'Bangkok', country: 'TH', lat: 13.7563, lng: 100.5018 },
  HKT: { city: 'Phuket', country: 'TH', lat: 7.8804, lng: 98.3923 },
  CNX: { city: 'Chiang Mai', country: 'TH', lat: 18.7883, lng: 98.9853 },
  SIN: { city: 'Singapore', country: 'SG', lat: 1.3521, lng: 103.8198 },
  DPS: { city: 'Bali', country: 'ID', lat: -8.3405, lng: 115.0920 },
  KUL: { city: 'Kuala Lumpur', country: 'MY', lat: 3.1390, lng: 101.6869 },
  TYO: { city: 'Tokyo', country: 'JP', lat: 35.6762, lng: 139.6503 },
  KIX: { city: 'Osaka', country: 'JP', lat: 34.6937, lng: 135.5023 },
  ICN: { city: 'Seoul', country: 'KR', lat: 37.5665, lng: 126.9780 },
  HKG: { city: 'Hong Kong', country: 'HK', lat: 22.3193, lng: 114.1694 },
  PVG: { city: 'Shanghai', country: 'CN', lat: 31.2304, lng: 121.4737 },
  PEK: { city: 'Beijing', country: 'CN', lat: 39.9042, lng: 116.4074 },
  TPE: { city: 'Taipei', country: 'TW', lat: 25.0330, lng: 121.5654 },
  HAN: { city: 'Hanoi', country: 'VN', lat: 21.0278, lng: 105.8342 },
  SGN: { city: 'Ho Chi Minh City', country: 'VN', lat: 10.8231, lng: 106.6297 },
  MNL: { city: 'Manila', country: 'PH', lat: 14.5995, lng: 120.9842 },
  CEB: { city: 'Cebu', country: 'PH', lat: 10.3157, lng: 123.8854 },
  PNH: { city: 'Phnom Penh', country: 'KH', lat: 11.5564, lng: 104.9282 },
  REP: { city: 'Siem Reap', country: 'KH', lat: 13.3671, lng: 103.8448 },
  DEL: { city: 'Delhi', country: 'IN', lat: 28.7041, lng: 77.1025 },
  BOM: { city: 'Mumbai', country: 'IN', lat: 19.0760, lng: 72.8777 },
  GOI: { city: 'Goa', country: 'IN', lat: 15.2993, lng: 74.1240 },
  JAI: { city: 'Jaipur', country: 'IN', lat: 26.9124, lng: 75.7873 },
  AGR: { city: 'Agra', country: 'IN', lat: 27.1767, lng: 78.0081 },
  CMB: { city: 'Colombo', country: 'LK', lat: 6.9271, lng: 79.8612 },
  SYD: { city: 'Sydney', country: 'AU', lat: -33.8688, lng: 151.2093 },
  MEL: { city: 'Melbourne', country: 'AU', lat: -37.8136, lng: 144.9631 },
  BNE: { city: 'Brisbane', country: 'AU', lat: -27.4698, lng: 153.0251 },
  OOL: { city: 'Gold Coast', country: 'AU', lat: -28.0167, lng: 153.4000 },
  AKL: { city: 'Auckland', country: 'NZ', lat: -36.8485, lng: 174.7633 },
  ZQN: { city: 'Queenstown', country: 'NZ', lat: -45.0312, lng: 168.6626 },
};

const firstString = (...vals) => {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'object' && typeof v.content === 'string') return v.content;
  }
  return null;
};

const mapper = (raw) => {
  const ref = String(raw?.code || raw?.activityCode || raw?.id || '');
  if (!ref) return null;
  const name = firstString(raw.name, raw.title) || `Activity ${ref}`;
  const dest = raw.destination || raw.destinations?.[0]?.code || null;
  const geo = dest ? DEST_GEO[dest] : null;
  const desc = firstString(
    raw.description,
    raw.summary,
    raw.contents?.descriptions?.[0]?.description,
  );
  const images = [];
  const mediaSources = [
    raw.media,
    raw.images,
    raw.contents?.media?.images,
    raw.content?.media?.images,
  ].filter(Boolean);
  for (const src of mediaSources) {
    if (!Array.isArray(src)) continue;
    for (const m of src) {
      const url = m?.url || m?.path || m?.urlPath || (m?.uri && m?.prefix ? `${m.prefix}${m.uri}` : null);
      if (url) images.push(url);
    }
  }
  return {
    supplier_raw_ref: ref,
    type: 'EXPERIENCE',
    title: name,
    description: desc,
    latitude: geo?.lat ?? null,
    longitude: geo?.lng ?? null,
    city: geo?.city || dest || null,
    country: geo?.country || raw.country || null,
    category: raw.type || raw.segmentation?.[0]?.code || raw.category?.code || null,
    duration_minutes: null,
    image_urls: images.length ? images : null,
    raw_content: raw,
  };
};

const fetchAll = async function* ({ apiKey, secretKey, baseUrl, destinations, pageSize = 100 }) {
  let shapeLogged = false;
  for (const destination of destinations) {
    let offset = 0;
    while (true) {
      let res;
      try {
        res = await axios.get(`${baseUrl}/portfolio`, {
          headers: buildHeaders(apiKey, secretKey),
          params: { destination, offset, limit: pageSize },
          timeout: 60000,
          validateStatus: (s) => s < 500,
        });
      } catch (e) {
        log('hb_activities_destination_error', { destination, error: e.message });
        break;
      }
      if (res.status === 204) { log('hb_activities_destination_empty', { destination }); break; }
      if (res.status >= 400) { log('hb_activities_destination_http_error', { destination, status: res.status }); break; }
      const body = res.data;
      const records = Array.isArray(body) ? body
        : Array.isArray(body?.activities) ? body.activities
        : Array.isArray(body?.portfolio) ? body.portfolio
        : Array.isArray(body?.items) ? body.items
        : [];
      if (!shapeLogged && records[0]) {
        log('hb_activities_record_shape', { destination, top_keys: Object.keys(records[0]).slice(0, 20), sample: JSON.stringify(records[0]).slice(0, 600) });
        shapeLogged = true;
      }
      if (records.length === 0) break;
      yield { records };
      if (records.length < pageSize) break;
      offset += records.length;
    }
  }
};

export const syncHotelbedsExperiences = async ({ apiKey, secretKey, env = 'sandbox', destinations = DESTINATIONS }) => {
  const baseUrl = env === 'production' ? PROD : SANDBOX;
  log('hb_activities_sync_start', { baseUrl, destination_count: destinations.length });
  return runSync({
    supplierSlug: 'hotelbeds-activities',
    fetcher: () => fetchAll({ apiKey, secretKey, baseUrl, destinations }),
    mapper,
  });
};
