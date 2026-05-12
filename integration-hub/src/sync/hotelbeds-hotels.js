import axios from 'axios';
import { runSync } from './base-sync.js';
import { buildHeaders } from '../suppliers/hotelbeds/auth.js';

const SANDBOX = 'https://api.test.hotelbeds.com/hotel-content-api/1.0';
const PROD = 'https://api.hotelbeds.com/hotel-content-api/1.0';

const mapper = (raw) => {
  if (!raw?.code) return null;
  const name = raw.name?.content || raw.name || `Hotel ${raw.code}`;
  const desc = raw.description?.content || null;
  const images = Array.isArray(raw.images)
    ? raw.images.map(i => i.path || i.url).filter(Boolean)
    : null;
  const boardCodes = Array.isArray(raw.boardCodes)
    ? raw.boardCodes.map(b => b.boardCode || b.code || b).filter(Boolean)
    : null;
  return {
    supplier_raw_ref: String(raw.code),
    type: 'HOTEL',
    title: name,
    description: desc,
    latitude: raw.coordinates?.latitude != null ? Number(raw.coordinates.latitude) : null,
    longitude: raw.coordinates?.longitude != null ? Number(raw.coordinates.longitude) : null,
    city: raw.city?.content || raw.city || null,
    country: raw.countryCode || null,
    timezone: raw.zone?.name || null,
    star_rating: raw.categoryCode ? Number((raw.categoryCode.match(/\d+/) || [0])[0]) || null : null,
    image_urls: images,
    amenities: Array.isArray(raw.facilities) ? raw.facilities.map(f => f.code || f).filter(Boolean) : null,
    meal_plans: boardCodes,
    raw_content: raw,
  };
};

const fetchAll = async function* ({ apiKey, secretKey, baseUrl, pageSize = 1000 }) {
  let from = 1;
  while (true) {
    const res = await axios.get(`${baseUrl}/hotels`, {
      headers: buildHeaders(apiKey, secretKey),
      params: { fields: 'all', language: 'ENG', from, to: from + pageSize - 1, useSecondaryLanguage: false },
      timeout: 60000,
    });
    const records = res.data?.hotels || [];
    if (records.length === 0) return;
    yield { records };
    if (records.length < pageSize) return;
    from += pageSize;
  }
};

export const syncHotelbedsHotels = async ({ apiKey, secretKey, env = 'sandbox' }) => {
  const baseUrl = env === 'production' ? PROD : SANDBOX;
  return runSync({
    supplierSlug: 'hotelbeds-hotels',
    fetcher: () => fetchAll({ apiKey, secretKey, baseUrl }),
    mapper,
  });
};
