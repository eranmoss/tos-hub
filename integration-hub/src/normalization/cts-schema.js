import { z } from 'zod';

export const CTSLocationSchema = z.object({
  type: z.enum(['AIRPORT', 'HOTEL', 'COORDINATES', 'CITY']),
  iata_code: z.string().optional(),
  city: z.string(),
  country: z.string(),
  timezone: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const CTSPriceSchema = z.object({
  amount_usd: z.number(),
  original_amount: z.number(),
  original_currency: z.string(),
  fx_rate: z.number(),
  net_amount_usd: z.number().optional(),
  markup_applied: z.boolean().optional(),
});

export const CTSAvailabilitySchema = z.object({
  status: z.enum([
    'CONFIRMED', 'LOW_AVAILABILITY', 'SOLD_OUT',
    'CANCELLATION_FEE_APPLIES', 'PRICING_TYPE_UNCERTAIN', 'DURATION_UNKNOWN',
  ]),
  seats: z.number().optional(),
  rooms: z.number().optional(),
  max_passengers: z.number().optional(),
  hold_expiry: z.string().optional(),
});

export const CTSPenaltySchema = z.object({
  hours_before: z.number(),
  charge_pct: z.number(),
});

export const CTSPoliciesSchema = z.object({
  cancellation: z.object({
    free_until: z.string().optional(),
    penalty_schedule: z.array(CTSPenaltySchema).optional(),
    policy_source: z.enum(['SUPPLIER', 'DEFAULT_APPLIED', 'CONFLICT_RESOLVED_RESTRICTIVE']),
  }),
  change: z.object({}).passthrough().optional(),
  baggage: z.object({}).passthrough().optional(),
});

export const CTSTransferMetaSchema = z.object({
  trip_id: z.string(),
  inbound_flight: z.string().optional(),
  pickup_type: z.enum(['MEET_AND_GREET', 'CURBSIDE']).optional(),
  passenger_manifest_required: z.boolean().optional(),
  return_trip_id: z.string().optional(),
});

export const CTSTravelOptionSchema = z.object({
  option_id: z.string().uuid(),
  type: z.enum(['FLIGHT', 'HOTEL', 'RAIL', 'TRANSFER', 'EXPERIENCE', 'PACKAGE']),
  title: z.string(),
  origin: CTSLocationSchema,
  destination: CTSLocationSchema,
  depart_utc: z.string().optional(),
  arrive_utc: z.string().optional(),
  checkin_date: z.string().optional(),
  checkout_date: z.string().optional(),
  duration_minutes: z.number().optional(),
  experience_category: z.string().optional(),
  vehicle_class: z.string().optional(),
  transfer_meta: CTSTransferMetaSchema.optional(),
  meal_plan: z.string().optional(),
  price: CTSPriceSchema,
  availability: CTSAvailabilitySchema,
  policies: CTSPoliciesSchema,
  supplier_raw_ref: z.string(),
  supplier_slug: z.string(),
  is_duplicate_of: z.string().optional(),
  dedup_score: z.number().optional(),
  candidate_pair_id: z.string().optional(),
  pricing_anomaly: z.boolean().optional(),
  media_quality: z.enum(['LOW', 'STANDARD', 'HIGH']).optional(),
});

export const validate = (option) => CTSTravelOptionSchema.safeParse(option);
