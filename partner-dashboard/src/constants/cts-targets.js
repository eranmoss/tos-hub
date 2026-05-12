// Canonical CTS target list — derived from /CTS_SPEC.md v1.0.0-draft.
// The mapping step renders one row per target that applies to the selected type.
// `applies_to: '*'` means base field (shown for every type).
// Otherwise, `applies_to: ['HOTEL']` means only for HOTEL objects, etc.

export const CTS_VERSION = '1.0.0-draft';

export const CTS_TYPES = ['HOTEL', 'EXPERIENCE', 'TRANSFER', 'FLIGHT', 'RAIL', 'PACKAGE'];

export const CTS_TARGETS = [
  // ── Base fields (§4.1) ────────────────────────────────────────────
  { path: 'supplier_raw_ref',         type: 'string',     required: true,  applies_to: '*',
    hint: 'Opaque supplier token. Used for re-price/book/cancel.' },
  { path: 'title',                    type: 'string',     required: true,  applies_to: '*',
    hint: 'Human-readable product name. Same field across all verticals.' },
  { path: 'description',              type: 'string',     required: false, applies_to: '*' },
  { path: 'location',                 type: 'string',     required: false, applies_to: '*' },
  { path: 'geo.latitude',             type: 'number',     required: false, applies_to: '*' },
  { path: 'geo.longitude',            type: 'number',     required: false, applies_to: '*' },
  { path: 'images[]',                 type: 'string[]',   required: false, applies_to: '*' },
  { path: 'price.amount',             type: 'number',     required: true,  applies_to: '*' },
  { path: 'price.original_currency',  type: 'string',     required: true,  applies_to: '*',
    hint: 'ISO 4217 three-letter code.' },
  { path: 'rating',                   type: 'number',     required: false, applies_to: '*',
    hint: '0–5 scale.' },
  { path: 'availability.status',      type: 'enum',       required: false, applies_to: '*',
    enum: ['AVAILABLE', 'ON_REQUEST', 'SOLD_OUT', 'HELD', 'UNKNOWN'] },
  { path: 'availability.hold_expiry', type: 'iso8601',    required: false, applies_to: '*' },
  { path: 'policies.cancellation.refundable',       type: 'boolean', required: false, applies_to: '*' },
  { path: 'policies.cancellation.penalty_schedule', type: 'object[]', required: false, applies_to: '*' },
  { path: 'category',                 type: 'string',     required: false, applies_to: '*',
    hint: 'Free-form supplier-side classification. Structured categories live in extensions.' },

  // ── HOTEL extensions (§4.5) ───────────────────────────────────────
  { path: 'star_rating',              type: 'integer',    required: false, applies_to: ['HOTEL'],
    hint: 'Official star classification, 1–5.' },
  { path: 'meal_plan',                type: 'enum',       required: false, applies_to: ['HOTEL'],
    enum: ['ROOM_ONLY', 'BREAKFAST', 'HALF_BOARD', 'FULL_BOARD', 'ALL_INCLUSIVE'] },
  { path: 'room_type',                type: 'string',     required: false, applies_to: ['HOTEL'] },
  { path: 'occupancy.adults',         type: 'integer',    required: false, applies_to: ['HOTEL'] },
  { path: 'occupancy.children',       type: 'integer',    required: false, applies_to: ['HOTEL'] },
  { path: 'occupancy.rooms',          type: 'integer',    required: false, applies_to: ['HOTEL'] },
  { path: 'amenities[]',              type: 'string[]',   required: false, applies_to: ['HOTEL'] },
  { path: 'check_in_date',            type: 'iso8601',    required: false, applies_to: ['HOTEL'] },
  { path: 'check_out_date',           type: 'iso8601',    required: false, applies_to: ['HOTEL'] },

  // ── EXPERIENCE extensions (§4.5) ──────────────────────────────────
  { path: 'duration_minutes',         type: 'integer',    required: false, applies_to: ['EXPERIENCE'] },
  { path: 'experience_category',      type: 'enum',       required: false, applies_to: ['EXPERIENCE'],
    enum: ['TOUR', 'ACTIVITY', 'ATTRACTION', 'EVENT', 'CLASS', 'TRANSFER_INCLUSIVE', 'OTHER'] },
  { path: 'languages[]',              type: 'string[]',   required: false, applies_to: ['EXPERIENCE'],
    hint: 'ISO 639-1 codes.' },
  { path: 'meeting_point',            type: 'string',     required: false, applies_to: ['EXPERIENCE'] },
  { path: 'start_times[]',            type: 'string[]',   required: false, applies_to: ['EXPERIENCE'] },
  { path: 'min_participants',         type: 'integer',    required: false, applies_to: ['EXPERIENCE'] },
  { path: 'max_participants',         type: 'integer',    required: false, applies_to: ['EXPERIENCE'] },

  // ── TRANSFER extensions (§4.5) ────────────────────────────────────
  { path: 'vehicle_class',            type: 'enum',       required: false, applies_to: ['TRANSFER'],
    enum: ['SHARED', 'PRIVATE_STANDARD', 'PRIVATE_PREMIUM', 'LUXURY', 'VAN', 'COACH'] },
  { path: 'passenger_capacity',       type: 'integer',    required: false, applies_to: ['TRANSFER'] },
  { path: 'luggage_capacity',         type: 'integer',    required: false, applies_to: ['TRANSFER'] },
  { path: 'route_origin',             type: 'string',     required: false, applies_to: ['TRANSFER'] },
  { path: 'route_destination',        type: 'string',     required: false, applies_to: ['TRANSFER'] },
  { path: 'transfer_meta.pickup_type',    type: 'enum',   required: false, applies_to: ['TRANSFER'],
    enum: ['AIRPORT', 'HOTEL', 'PORT', 'ADDRESS', 'STATION'] },
  { path: 'transfer_meta.inbound_flight', type: 'string', required: false, applies_to: ['TRANSFER'] },
  { path: 'transfer_meta.trip_id',        type: 'string', required: false, applies_to: ['TRANSFER'] },
];

// Filter targets applicable to a given CTS type.
export const targetsForType = (type) =>
  CTS_TARGETS.filter((t) => t.applies_to === '*' || (Array.isArray(t.applies_to) && t.applies_to.includes(type)));

// Required-only subset for a given type.
export const requiredTargetsForType = (type) =>
  targetsForType(type).filter((t) => t.required);
