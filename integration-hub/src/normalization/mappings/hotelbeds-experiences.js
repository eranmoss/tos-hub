import { randomUUID } from 'crypto';
import { toUsd } from '../fx.js';

const toMinutes = (duration) => {
  if (!duration) return undefined;
  const v = Number(duration.value ?? 0);
  const unit = (duration.unit || duration.metric || 'minutes').toLowerCase();
  if (unit.startsWith('hour')) return v * 60;
  if (unit.startsWith('day')) return v * 1440;
  return v;
};

const cityFromDescription = (desc) => {
  if (!desc) return '';
  const parts = String(desc).split(',').map(s => s.trim());
  return parts[0] || '';
};

const mapPenalties = (cancellationPolicies) =>
  (cancellationPolicies || []).map(p => ({
    hours_before: Number(p.hoursBeforeDateTime ?? 0),
    charge_pct: Number(p.percent ?? p.penalty ?? 0),
  }));

export const mapHotelbedsActivityToOptions = (activity) => {
  const activityCode = activity.activityCode || activity.code;
  const modalities = activity.modalities || [activity];
  return modalities.map(modality => {
    const amount = Number(modality.amounts?.[0]?.amount ?? modality.amounts?.[0]?.boxOffice ?? 0);
    const { amount_usd, fx_rate } = toUsd(amount, 'EUR');
    const origin = {
      type: 'COORDINATES',
      latitude: activity.location?.latitude ? Number(activity.location.latitude) : undefined,
      longitude: activity.location?.longitude ? Number(activity.location.longitude) : undefined,
      city: cityFromDescription(activity.location?.description) || activity.location?.city || '',
      country: activity.location?.country || '',
      timezone: activity.location?.timezone || 'UTC',
    };
    const penalty_schedule = mapPenalties(modality.cancellationPolicies || activity.cancellationPolicies);
    return {
      option_id: randomUUID(),
      type: 'EXPERIENCE',
      title: modality.name || activity.name || '',
      origin,
      destination: origin,
      duration_minutes: toMinutes(modality.duration || activity.duration),
      experience_category: activity.category?.code || activity.category?.groupCode || undefined,
      price: {
        amount_usd: amount_usd ?? amount,
        original_amount: amount,
        original_currency: 'EUR',
        fx_rate: fx_rate ?? 1.08,
      },
      availability: {
        status: (modality.availabilityQuota ?? 999) > 0 ? 'CONFIRMED' : 'SOLD_OUT',
        seats: modality.availabilityQuota ? Number(modality.availabilityQuota) : undefined,
      },
      policies: {
        cancellation: {
          penalty_schedule: penalty_schedule.length ? penalty_schedule : undefined,
          policy_source: penalty_schedule.length ? 'SUPPLIER' : 'DEFAULT_APPLIED',
        },
      },
      supplier_raw_ref: String(activityCode),
      supplier_slug: 'hotelbeds-activities',
    };
  });
};

export const mapHotelbedsActivitiesResponse = (response) => {
  const activities = response?.activities || [];
  return activities.flatMap(mapHotelbedsActivityToOptions);
};
