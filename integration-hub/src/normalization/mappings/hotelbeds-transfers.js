import { randomUUID } from 'crypto';
import { toUsd } from '../fx.js';

const CATEGORY_MAP = {
  SHUTTLE: 'SHARED_TRANSFER',
  PRIVATE: 'PRIVATE_TRANSFER',
  LUXURY: 'LUXURY_TRANSFER',
};

const mapPenalties = (cancellationPolicies) =>
  (cancellationPolicies || []).map(p => ({
    hours_before: Number(p.hoursBeforeDeparture ?? p.hoursBefore ?? 0),
    charge_pct: Number(p.percent ?? p.amount ?? 0),
  }));

export const mapHotelbedsTransferToOption = (transfer, tripId = null) => {
  const currency = transfer.price?.currency || 'EUR';
  const amount = Number(transfer.price?.totalAmount ?? transfer.price?.amount ?? 0);
  const { amount_usd, fx_rate } = toUsd(amount, currency);
  const origin = {
    type: transfer.origin?.type === 'ATLAS' ? 'AIRPORT' : (transfer.origin?.type || 'COORDINATES'),
    iata_code: transfer.origin?.code,
    city: transfer.origin?.city || transfer.origin?.description || '',
    country: transfer.origin?.country || '',
    timezone: transfer.origin?.timezone || 'UTC',
  };
  const destination = {
    type: transfer.destination?.type === 'ATLAS' ? 'AIRPORT' : (transfer.destination?.type || 'COORDINATES'),
    iata_code: transfer.destination?.code,
    city: transfer.destination?.city || transfer.destination?.description || '',
    country: transfer.destination?.country || '',
    timezone: transfer.destination?.timezone || 'UTC',
  };
  return {
    option_id: randomUUID(),
    type: 'TRANSFER',
    title: `${CATEGORY_MAP[transfer.category] || 'TRANSFER'} ${origin.city} → ${destination.city}`,
    origin,
    destination,
    depart_utc: transfer.pickupDateTime || transfer.departure,
    vehicle_class: transfer.vehicle?.code || undefined,
    transfer_meta: {
      trip_id: tripId || randomUUID(),
      inbound_flight: transfer.flightNumber || undefined,
      pickup_type: transfer.pickupInformation?.type === 'MEET_AND_GREET' ? 'MEET_AND_GREET' : 'CURBSIDE',
    },
    price: {
      amount_usd: amount_usd ?? amount,
      original_amount: amount,
      original_currency: currency,
      fx_rate: fx_rate ?? 1,
    },
    availability: {
      status: 'CONFIRMED',
      max_passengers: transfer.vehicle?.maxPax ? Number(transfer.vehicle.maxPax) : undefined,
    },
    policies: {
      cancellation: {
        penalty_schedule: mapPenalties(transfer.cancellationPolicies),
        policy_source: transfer.cancellationPolicies?.length ? 'SUPPLIER' : 'DEFAULT_APPLIED',
      },
    },
    supplier_raw_ref: String(transfer.id),
    supplier_slug: 'hotelbeds-transfers',
  };
};

export const mapHotelbedsTransfersResponse = (response, tripId = null) => {
  const transfers = response?.transfers || [];
  return transfers.map(t => mapHotelbedsTransferToOption(t, tripId));
};
