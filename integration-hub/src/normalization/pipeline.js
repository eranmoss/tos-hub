import { validate } from './cts-schema.js';
import { mapBridgifySearchResponse } from './mappings/bridgify-experiences.js';
import { mapHotelbedsActivitiesResponse } from './mappings/hotelbeds-experiences.js';
import { mapHotelbedsHotelsResponse } from './mappings/hotelbeds-hotels.js';
import { mapHotelbedsTransfersResponse } from './mappings/hotelbeds-transfers.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

const MAPPERS = {
  'bridgify': (raw) => mapBridgifySearchResponse(raw),
  'hotelbeds-activities': (raw) => mapHotelbedsActivitiesResponse(raw),
  'hotelbeds-hotels': (raw, ctx) => mapHotelbedsHotelsResponse(raw, ctx?.contentCache || {}),
  'hotelbeds-transfers': (raw, ctx) => mapHotelbedsTransfersResponse(raw, ctx?.tripId || null),
};

// Stage 1: PARSE — apply supplier field mappings
const parse = (raw, slug, ctx) => {
  const mapper = MAPPERS[slug];
  if (!mapper) throw new Error(`No mapper for supplier: ${slug}`);
  return mapper(raw, ctx);
};

// Stage 2: ENRICH — resolve codes, infer timezone, preserve supplier_raw_ref
const enrich = (options) => options.map(opt => {
  if (!opt.origin?.timezone || opt.origin.timezone === 'UTC') {
    // TODO: infer timezone from country/city via IANA lookup
  }
  return opt;
});

// Stage 3: NORMALIZE — USD already applied via fx.js; ensure ISO8601 UTC
const normalizeFields = (options) => options.map(opt => {
  if (opt.depart_utc && !opt.depart_utc.endsWith('Z') && !opt.depart_utc.includes('+')) {
    try {
      opt.depart_utc = new Date(opt.depart_utc).toISOString();
    } catch {}
  }
  return opt;
});

// Stage 4: VALIDATE — Zod parse, log failures, do not drop silently
const validateAll = (options, slug) => {
  const valid = [];
  for (const opt of options) {
    const result = validate(opt);
    if (result.success) {
      valid.push(result.data);
    } else {
      log('error', 'cts_validation_failed', {
        supplier: slug,
        option_id: opt.option_id,
        errors: result.error.errors,
      });
    }
  }
  return valid;
};

export const normalize = async (rawResponse, supplierSlug, ctx = {}) => {
  const parsed = parse(rawResponse, supplierSlug, ctx);
  const enriched = enrich(parsed);
  const normalized = normalizeFields(enriched);
  return validateAll(normalized, supplierSlug);
};
