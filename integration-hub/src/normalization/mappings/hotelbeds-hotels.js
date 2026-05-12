import { randomUUID } from 'crypto';
import { toUsd } from '../fx.js';

const mapPenalties = (cancellationPolicies) =>
  (cancellationPolicies || []).map(p => ({
    hours_before: p.from ? Math.max(0, Math.floor((new Date(p.from).getTime() - Date.now()) / 3600000)) : 0,
    charge_pct: Number(p.amount ?? p.percent ?? 0),
  }));

export const mapHotelbedsHotelToOptions = (hotel, contentCache = {}) => {
  const content = contentCache[hotel.code] || {};
  const rooms = hotel.rooms || [];
  const options = [];
  for (const room of rooms) {
    for (const rate of room.rates || []) {
      const currency = rate.currency || hotel.currency || 'EUR';
      const amount = Number(rate.net ?? rate.sellingRate ?? 0);
      const { amount_usd, fx_rate } = toUsd(amount, currency);
      const origin = {
        type: 'HOTEL',
        latitude: content.latitude ?? hotel.latitude ?? undefined,
        longitude: content.longitude ?? hotel.longitude ?? undefined,
        city: content.city || hotel.city?.content || hotel.destinationName || '',
        country: content.country_code || hotel.countryCode || '',
        timezone: content.timezone || 'UTC',
      };
      options.push({
        option_id: randomUUID(),
        type: 'HOTEL',
        title: content.name || hotel.name || `Hotel ${hotel.code}`,
        origin,
        destination: origin,
        checkin_date: hotel.checkIn || hotel.checkin,
        checkout_date: hotel.checkOut || hotel.checkout,
        meal_plan: rate.boardCode || undefined,
        price: {
          amount_usd: amount_usd ?? amount,
          original_amount: amount,
          original_currency: currency,
          fx_rate: fx_rate ?? 1,
          net_amount_usd: amount_usd ?? amount,
          markup_applied: false,
        },
        availability: {
          status: Number(rate.allotment ?? rate.rooms ?? 1) > 0 ? 'CONFIRMED' : 'SOLD_OUT',
          rooms: rate.allotment ? Number(rate.allotment) : (rate.rooms ? Number(rate.rooms) : undefined),
        },
        policies: {
          cancellation: {
            penalty_schedule: mapPenalties(rate.cancellationPolicies),
            policy_source: rate.cancellationPolicies?.length ? 'SUPPLIER' : 'DEFAULT_APPLIED',
          },
        },
        supplier_raw_ref: String(rate.rateKey),
        supplier_slug: 'hotelbeds-hotels',
      });
    }
  }
  return options;
};

export const mapHotelbedsHotelsResponse = (response, contentCache = {}) => {
  const hotels = response?.hotels?.hotels || response?.hotels || [];
  return hotels.flatMap(h => mapHotelbedsHotelToOptions(h, contentCache));
};
