import { bridgifyHandler } from './handlers/bridgify.js';
import { viatorHandler } from './handlers/viator.js';
import { hotelbedsHotelsHandler } from './handlers/hotelbeds-hotels.js';
import { hotelbedsActivitiesHandler } from './handlers/hotelbeds-activities.js';
import { hotelbedsTransfersHandler } from './handlers/hotelbeds-transfers.js';

// Maps supplier_slug → handler module exposing detail/availability/book/cancel.
// New suppliers: add an entry here and create a handler file alongside bridgify.js.
// Suppliers sourced through Bridgify's aggregator share the bridgify handler.
// Viator has its own direct handler since we integrate with their Partner API.
const BRIDGIFY_AGGREGATED = [
  'getyourguide', 'tiqets', 'stubhub', 'hotelbeds',
  'attractionworld', 'bookitfun', 'livetickets', 'manawa',
  'sportsevents365', 'ticketero', 'tillo',
];

const HANDLERS = {
  bridgify: bridgifyHandler,
  viator: viatorHandler,
  ...Object.fromEntries(BRIDGIFY_AGGREGATED.map(s => [s, bridgifyHandler])),
  'hotelbeds-hotels': hotelbedsHotelsHandler,
  'hotelbeds-activities': hotelbedsActivitiesHandler,
  'hotelbeds-transfers': hotelbedsTransfersHandler,
};

const STEPS = ['detail', 'availability', 'book', 'cancel'];

const log = (event, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...extra }));

export const runLifecycleStep = async ({ tenantId, slug, step, rawRef, rawContent, payload }) => {
  if (!tenantId) throw new Error('tenantId required');
  if (!slug) throw new Error('slug required');
  if (!STEPS.includes(step)) throw new Error(`unknown step: ${step}`);
  if (!rawRef && step !== 'availability') throw new Error('rawRef required');

  const handler = HANDLERS[slug];
  if (!handler) {
    return {
      ok: false,
      error: `no lifecycle handler registered for supplier "${slug}"`,
      supplier: slug,
      step,
    };
  }
  if (typeof handler[step] !== 'function') {
    return {
      ok: false,
      error: `supplier "${slug}" does not implement step "${step}"`,
      supplier: slug,
      step,
    };
  }

  const t0 = Date.now();
  try {
    const result = await handler[step]({ tenantId, rawRef, rawContent, payload });
    const latency_ms = Date.now() - t0;
    // Only metadata is logged — NEVER the request payload or response body.
    log('lifecycle_step', {
      supplier: slug,
      step,
      status: result?.ok ? 'ok' : 'error',
      latency_ms,
    });
    return { ...result, supplier: slug, step, latency_ms };
  } catch (e) {
    const latency_ms = Date.now() - t0;
    log('lifecycle_step', {
      supplier: slug,
      step,
      status: 'exception',
      latency_ms,
      error: e.message,
    });
    return { ok: false, error: e.message, supplier: slug, step, latency_ms };
  }
};

export const supportedSuppliers = () => Object.keys(HANDLERS);
