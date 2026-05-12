import { randomUUID } from 'crypto';
import { toUsd } from '../fx.js';

const STATUS_MAP = {
  AVAILABLE: 'CONFIRMED',
  LIMITED: 'LOW_AVAILABILITY',
  UNAVAILABLE: 'SOLD_OUT',
};

export const mapBridgifyExperience = (raw) => {
  const currency = raw.price?.currency || 'USD';
  const amount = Number(raw.price?.amount ?? 0);
  const { amount_usd, fx_rate } = toUsd(amount, currency);
  const origin = {
    type: 'COORDINATES',
    latitude: raw.location?.lat ? Number(raw.location.lat) : undefined,
    longitude: raw.location?.lng ? Number(raw.location.lng) : undefined,
    city: raw.location?.city || '',
    country: raw.location?.country || '',
    timezone: raw.location?.timezone || 'UTC',
  };
  const penalty_schedule = (raw.cancellation?.penalties || []).map(p => ({
    hours_before: Number(p.hours_before ?? p.hoursBefore ?? 0),
    charge_pct: Number(p.charge_pct ?? p.chargePct ?? 0),
  }));
  return {
    option_id: randomUUID(),
    type: 'EXPERIENCE',
    title: raw.title || '',
    origin,
    destination: origin,
    duration_minutes: raw.duration_minutes ? Number(raw.duration_minutes) : undefined,
    experience_category: raw.category || undefined,
    price: {
      amount_usd: amount_usd ?? amount,
      original_amount: amount,
      original_currency: currency,
      fx_rate: fx_rate ?? 1,
    },
    availability: {
      status: STATUS_MAP[raw.status] || 'CONFIRMED',
      seats: raw.seats_available ? Number(raw.seats_available) : undefined,
    },
    policies: {
      cancellation: {
        free_until: raw.cancellation?.free_until,
        penalty_schedule: penalty_schedule.length ? penalty_schedule : undefined,
        policy_source: raw.cancellation ? 'SUPPLIER' : 'DEFAULT_APPLIED',
      },
    },
    supplier_raw_ref: String(raw.id),
    supplier_slug: 'bridgify',
  };
};

export const mapBridgifySearchResponse = (response) => {
  const items = response?.experiences || response?.results || [];
  return items.map(mapBridgifyExperience);
};
