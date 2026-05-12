import { HotelbedsTransfers } from '../../suppliers/hotelbeds/transfers.js';
import { getSecret } from '../../infra/secrets.js';

// HotelBeds Transfers lifecycle:
//   detail       → returns cached destination info from raw_content
//                   (transfers have no per-item detail endpoint; only search-time routes)
//   availability → GET /transfers/availability with origin/destination/dates
//   book         → POST /bookings (creates a real booking in sandbox)
//   cancel       → DELETE /bookings/{ref}
//
// NOTE: hub_static_inventory stores destination points, not routes.
// The availability step requires the user to provide origin + destination
// in the payload — there is no meaningful "detail" call for a destination code.
//
// See SUPPLIER_PLAYBOOK.md hotelbeds-transfers section.

const toYmd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const clientFor = async (tenantId) => {
  const creds =
    (await getSecret(tenantId, 'hotelbeds-transfers')) ||
    (await getSecret(tenantId, 'hotelbeds'));
  if (!creds) throw new Error('hotelbeds credentials not found for tenant');
  if (!creds.api_key) throw new Error('hotelbeds credentials missing api_key');
  const secretKey = creds.secret_key || creds.secret;
  if (!secretKey) throw new Error('hotelbeds credentials missing secret_key');
  return new HotelbedsTransfers({
    apiKey: creds.api_key,
    secretKey,
    env: creds.env || 'sandbox',
  });
};

export const hotelbedsTransfersHandler = {
  // Step 1: return cached destination data. No live API call needed.
  // The user must fill in origin + destination for the availability step.
  detail: async ({ rawRef, rawContent }) => {
    const today = new Date();
    // Our inventory stores destination codes (DMP, YNU…) from the transfer
    // cache API. These are NOT ATLAS codes. The availability endpoint
    // expects IATA (airport) or ATLAS (hotel code from hotelbeds-hotels).
    // We pre-fill a PMI airport → generic Mallorca hotel example so the
    // user gets a working starting point they can edit.
    return {
      ok: true,
      data: {
        destination_code: rawRef,
        raw_content: rawContent || { code: rawRef },
        note: 'Transfers availability needs IATA (airport) or ATLAS (hotel code) — ' +
              'NOT the destination codes stored in this inventory. ' +
              'Use a hotel code from hotelbeds-hotels inventory as the ATLAS toCode.',
      },
      next_payload_hint: {
        language: 'en',
        fromType: 'IATA',
        fromCode: 'PMI',
        toType: 'ATLAS',
        toCode: '1234',
        _toCode_note: 'Replace 1234 with a real hotel code from hotelbeds-hotels inventory',
        outbound: toYmd(addDays(today, 7)) + 'T12:00:00',
        adults: 2,
        children: 0,
        infants: 0,
      },
    };
  },

  // Step 2: search transfer availability between two points.
  // HotelBeds Transfer API uses PATH parameters, not query params:
  //   GET /availability/{lang}/from/{fromType}/{fromCode}/to/{toType}/{toCode}/{outbound}/{adults}/{children}/{infants}
  // For round-trip add /{inbound} before /{adults}.
  availability: async ({ tenantId, payload = {} }) => {
    if (!payload.fromCode || !payload.toCode) {
      return {
        ok: false,
        error: 'fromCode and toCode are required — e.g. fromCode:"PMI" (IATA airport), toCode: destination ATLAS code.',
        data: null,
      };
    }
    const client = await clientFor(tenantId);
    const lang = payload.language || 'en';
    const fromType = payload.fromType || 'IATA';
    const fromCode = payload.fromCode;
    const toType = payload.toType || 'ATLAS';
    const toCode = payload.toCode;
    const outbound = payload.outbound || (toYmd(addDays(new Date(), 7)) + 'T12:00:00');
    const adults = payload.adults ?? 2;
    const children = payload.children ?? 0;
    const infants = payload.infants ?? 0;

    // Build path-based URL.
    let pathUrl = `/availability/${lang}/from/${fromType}/${encodeURIComponent(fromCode)}/to/${toType}/${encodeURIComponent(toCode)}/${encodeURIComponent(outbound)}`;
    if (payload.inbound) {
      pathUrl += `/${encodeURIComponent(payload.inbound)}`;
    }
    pathUrl += `/${adults}/${children}/${infants}`;

    const requestInfo = { url: pathUrl, fromType, fromCode, toType, toCode, outbound, adults, children, infants };

    let data;
    try {
      data = await client.request({
        method: 'GET',
        url: pathUrl,
        headers: client._headers(),
        operation: 'lifecycle_availability',
      });
    } catch (err) {
      return {
        ok: false,
        data: {
          request_sent: requestInfo,
          http_status: err.status || null,
          error_response: err.response || err.message,
        },
        error: err.message,
      };
    }

    const services = data?.services || data?.results || [];
    const first = services[0];

    return {
      ok: true,
      data: {
        services_count: services.length,
        first_service: first ? {
          id: first.id,
          direction: first.direction,
          transferType: first.transferType,
          vehicle: first.vehicle,
          price: first.price,
        } : null,
        raw: data,
      },
      next_payload_hint: first ? {
        language: lang,
        holder: { name: 'Test', surname: 'User', email: 'test@example.com', phone: '+1234567890' },
        transfers: [{
          rateKey: first.rateKey,
          transferDetails: [{
            direction: first.direction || 'ARRIVAL',
            type: 'FLIGHT',
            code: 'IB3915',
            _code_note: 'Replace with actual flight number',
          }],
        }],
      } : { note: 'No transfer services returned — try different origin/destination or dates.' },
    };
  },

  // Step 3: book. ⚠ CREATES A REAL BOOKING in sandbox.
  //
  // HotelBeds Transfer booking requires:
  //   language, holder (name, surname, email, phone), clientReference,
  //   transfers[].rateKey + transfers[].transferDetails[] (direction, type=FLIGHT|CRUISE|TRAIN, code)
  book: async ({ tenantId, payload = {} }) => {
    if (!payload.transfers?.length) {
      return {
        ok: false,
        error: 'transfers array required — run availability first.',
        data: null,
      };
    }
    const client = await clientFor(tenantId);
    const transfers = payload.transfers.map(t => ({
      rateKey: t.rateKey,
      transferDetails: t.transferDetails || [{
        direction: t.direction || 'ARRIVAL',
        type: 'FLIGHT',
        code: t.flightNumber || 'IB0000',
      }],
    }));
    const bookPayload = {
      language: payload.language || 'en',
      holder: payload.holder || { name: 'Test', surname: 'User', email: 'test@example.com', phone: '+1234567890' },
      clientReference: payload.clientReference || `TOS-T-${Date.now()}`,
      transfers,
    };

    let data;
    try {
      data = await client.book(bookPayload);
    } catch (err) {
      return {
        ok: false,
        data: {
          http_status: err.status || null,
          error_response: err.response || err.message,
          note: 'HotelBeds transfer booking failed. Check error_response for details.',
          request_sent: { ...bookPayload, transfers: bookPayload.transfers.map(t => ({ ...t, rateKey: t.rateKey?.substring(0, 40) + '...' })) },
        },
        error: err.message,
      };
    }
    const booking = data?.bookings?.[0] || data?.booking || data;
    const ref = booking?.reference || booking?.bookingId || null;

    return {
      ok: Boolean(ref),
      data: {
        booking_reference: ref,
        status: booking?.status || 'CONFIRMED',
        raw: data,
      },
      next_payload_hint: ref ? { booking_reference: ref } : null,
      error: ref ? null : 'Booking completed but no reference returned.',
    };
  },

  // Step 4: cancel.
  cancel: async ({ tenantId, payload = {} }) => {
    const ref = payload.booking_reference;
    if (!ref) {
      return { ok: false, error: 'booking_reference required — run book first.', data: null };
    }
    const client = await clientFor(tenantId);
    let data;
    try {
      data = await client.cancel(ref);
    } catch (err) {
      return {
        ok: false,
        data: { http_status: err.status || null, error_response: err.response || err.message },
        error: err.message,
      };
    }
    const booking = data?.booking || data;
    return {
      ok: true,
      data: {
        booking_reference: ref,
        status: booking?.status || 'CANCELLED',
        raw: data,
      },
    };
  },
};
