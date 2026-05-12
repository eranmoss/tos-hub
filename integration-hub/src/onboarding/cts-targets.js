// Canonical CTS target list — mirrors /CTS_SPEC.md v1.0.0-draft.
// Kept in sync with partner-dashboard/src/constants/cts-targets.js.

export const CTS_VERSION = '1.0.0-draft';

export const CTS_TARGETS = [
  { path: 'supplier_raw_ref',         type: 'string',   required: true,  applies_to: '*' },
  { path: 'title',                    type: 'string',   required: true,  applies_to: '*' },
  { path: 'description',              type: 'string',   required: false, applies_to: '*' },
  { path: 'location',                 type: 'string',   required: false, applies_to: '*' },
  { path: 'geo.latitude',             type: 'number',   required: false, applies_to: '*' },
  { path: 'geo.longitude',            type: 'number',   required: false, applies_to: '*' },
  { path: 'images[]',                 type: 'string[]', required: false, applies_to: '*' },
  { path: 'price.amount',             type: 'number',   required: true,  applies_to: '*' },
  { path: 'price.original_currency',  type: 'string',   required: true,  applies_to: '*' },
  { path: 'rating',                   type: 'number',   required: false, applies_to: '*' },
  { path: 'availability.status',      type: 'enum',     required: false, applies_to: '*',
    enum: ['AVAILABLE', 'ON_REQUEST', 'SOLD_OUT', 'HELD', 'UNKNOWN'] },
  { path: 'availability.hold_expiry', type: 'iso8601',  required: false, applies_to: '*' },
  { path: 'policies.cancellation.refundable',       type: 'boolean',  required: false, applies_to: '*' },
  { path: 'policies.cancellation.penalty_schedule', type: 'object[]', required: false, applies_to: '*' },
  { path: 'category',                 type: 'string',   required: false, applies_to: '*' },

  // HOTEL extensions
  { path: 'star_rating',              type: 'integer',  required: false, applies_to: ['HOTEL'] },
  { path: 'meal_plan',                type: 'enum',     required: false, applies_to: ['HOTEL'],
    enum: ['ROOM_ONLY', 'BREAKFAST', 'HALF_BOARD', 'FULL_BOARD', 'ALL_INCLUSIVE'] },
  { path: 'room_type',                type: 'string',   required: false, applies_to: ['HOTEL'] },
  { path: 'occupancy.adults',         type: 'integer',  required: false, applies_to: ['HOTEL'] },
  { path: 'occupancy.children',       type: 'integer',  required: false, applies_to: ['HOTEL'] },
  { path: 'occupancy.rooms',          type: 'integer',  required: false, applies_to: ['HOTEL'] },
  { path: 'amenities[]',              type: 'string[]', required: false, applies_to: ['HOTEL'] },
  { path: 'check_in_date',            type: 'iso8601',  required: false, applies_to: ['HOTEL'] },
  { path: 'check_out_date',           type: 'iso8601',  required: false, applies_to: ['HOTEL'] },

  // EXPERIENCE extensions
  { path: 'duration_minutes',         type: 'integer',  required: false, applies_to: ['EXPERIENCE'] },
  { path: 'experience_category',      type: 'enum',     required: false, applies_to: ['EXPERIENCE'],
    enum: ['TOUR', 'ACTIVITY', 'ATTRACTION', 'EVENT', 'CLASS', 'TRANSFER_INCLUSIVE', 'OTHER'] },
  { path: 'languages[]',              type: 'string[]', required: false, applies_to: ['EXPERIENCE'] },
  { path: 'meeting_point',            type: 'string',   required: false, applies_to: ['EXPERIENCE'] },
  { path: 'start_times[]',            type: 'string[]', required: false, applies_to: ['EXPERIENCE'] },
  { path: 'min_participants',         type: 'integer',  required: false, applies_to: ['EXPERIENCE'] },
  { path: 'max_participants',         type: 'integer',  required: false, applies_to: ['EXPERIENCE'] },

  // TRANSFER extensions
  { path: 'vehicle_class',            type: 'enum',     required: false, applies_to: ['TRANSFER'],
    enum: ['SHARED', 'PRIVATE_STANDARD', 'PRIVATE_PREMIUM', 'LUXURY', 'VAN', 'COACH'] },
  { path: 'passenger_capacity',       type: 'integer',  required: false, applies_to: ['TRANSFER'] },
  { path: 'luggage_capacity',         type: 'integer',  required: false, applies_to: ['TRANSFER'] },
  { path: 'route_origin',             type: 'string',   required: false, applies_to: ['TRANSFER'] },
  { path: 'route_destination',        type: 'string',   required: false, applies_to: ['TRANSFER'] },
  { path: 'transfer_meta.pickup_type',    type: 'enum',   required: false, applies_to: ['TRANSFER'],
    enum: ['AIRPORT', 'HOTEL', 'PORT', 'ADDRESS', 'STATION'] },
  { path: 'transfer_meta.inbound_flight', type: 'string', required: false, applies_to: ['TRANSFER'] },
  { path: 'transfer_meta.trip_id',        type: 'string', required: false, applies_to: ['TRANSFER'] },
];

export const targetsForType = (type) =>
  CTS_TARGETS.filter((t) => t.applies_to === '*' || (Array.isArray(t.applies_to) && t.applies_to.includes(type)));
