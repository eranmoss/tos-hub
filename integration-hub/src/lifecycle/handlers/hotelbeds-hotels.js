import { HotelbedsHotels } from '../../suppliers/hotelbeds/hotels.js';
import { getSecret } from '../../infra/secrets.js';

// HotelBeds Hotels lifecycle:
//   detail   → content API (hotel info, images, facilities)
//   availability → booking API search with hotel code filter → returns rooms + rate keys
//   book     → checkrates then POST /bookings (CREATES A REAL BOOKING in sandbox)
//   cancel   → DELETE /bookings/{ref} (returns penalty info)
//
// See SUPPLIER_PLAYBOOK.md hotelbeds-hotels section.

const toYmd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const clientFor = async (tenantId) => {
  // hotelbeds-hotels and hotelbeds-activities share credentials under
  // different slugs. Try the specific slug first, then the generic one.
  const creds =
    (await getSecret(tenantId, 'hotelbeds-hotels')) ||
    (await getSecret(tenantId, 'hotelbeds'));
  if (!creds) throw new Error('hotelbeds credentials not found for tenant');
  if (!creds.api_key) throw new Error('hotelbeds credentials missing api_key');
  const secretKey = creds.secret_key || creds.secret;
  if (!secretKey) throw new Error('hotelbeds credentials missing secret_key');
  return new HotelbedsHotels({
    apiKey: creds.api_key,
    secretKey,
    env: creds.env || 'sandbox',
  });
};

export const hotelbedsHotelsHandler = {
  // Step 1: fetch hotel content (name, facilities, images, coordinates).
  detail: async ({ tenantId, rawRef, rawContent }) => {
    const client = await clientFor(tenantId);
    const hotelCode = rawContent?.code || rawRef;
    const data = await client.getContent(hotelCode);
    const today = new Date();
    return {
      ok: true,
      data,
      next_payload_hint: {
        stay: {
          checkIn: toYmd(addDays(today, 7)),
          checkOut: toYmd(addDays(today, 9)),
        },
        occupancies: [{ rooms: 1, adults: 2, children: 0 }],
      },
    };
  },

  // Step 2: search rooms/rates for this specific hotel.
  // The next_payload_hint from detail pre-fills dates + occupancies.
  //
  // NOTE: HotelBeds sandbox has very limited availability — most hotels in the
  // content catalog have NO bookable rates in sandbox. If you get 0 results,
  // it's not a bug. Try hotels in popular sandbox destinations (Mallorca,
  // Tenerife, Barcelona, London, New York).
  availability: async ({ tenantId, rawRef, rawContent, payload = {} }) => {
    const client = await clientFor(tenantId);
    const hotelCode = rawContent?.code || rawRef;
    const today = new Date();
    const stay = payload.stay || {
      checkIn: toYmd(addDays(today, 7)),
      checkOut: toYmd(addDays(today, 9)),
    };
    const occupancies = payload.occupancies || [{ rooms: 1, adults: 2, children: 0 }];

    const searchBody = {
      stay,
      occupancies,
      hotels: { hotel: [Number(hotelCode) || hotelCode] },
    };

    // HotelBeds availability can be slow — override the 8s default.
    const savedTimeout = client.timeoutMs;
    client.timeoutMs = 30000;
    let data;
    try {
      data = await client.request({
        method: 'POST',
        url: '/hotels',
        headers: client._headers(),
        data: searchBody,
        operation: 'lifecycle_availability',
      });
    } catch (err) {
      client.timeoutMs = savedTimeout;
      // Surface the actual HTTP status + response body for diagnosis.
      return {
        ok: false,
        data: {
          request_sent: searchBody,
          http_status: err.status || null,
          error_response: err.response || err.message,
          note: 'HotelBeds availability search failed. Check the error_response for details.',
        },
        error: err.message,
      };
    }
    client.timeoutMs = savedTimeout;

    // Extract first rate key for the book step.
    const hotels = data?.hotels?.hotels || data?.hotels || [];
    const firstHotel = hotels[0];
    const firstRoom = firstHotel?.rooms?.[0];
    const firstRate = firstRoom?.rates?.[0];
    const rateKey = firstRate?.rateKey || null;

    if (hotels.length === 0) {
      return {
        ok: true,
        data: {
          hotels_count: 0,
          rooms: 0,
          first_rate_key: null,
          note: `No availability for hotel ${hotelCode} on ${stay.checkIn}–${stay.checkOut}. ` +
                'HotelBeds sandbox has limited rates — try a different hotel or dates. ' +
                'Hotels in Mallorca (PMI), Tenerife, Barcelona, London typically have sandbox rates.',
          request_sent: searchBody,
          response_keys: data ? Object.keys(data) : [],
          audit: data?.auditData || null,
        },
        next_payload_hint: {
          note: 'No rates returned. Try a different hotel.',
        },
      };
    }

    return {
      ok: true,
      data: {
        hotels_count: hotels.length,
        rooms: firstHotel?.rooms?.length || 0,
        first_rate_key: rateKey,
        raw: data,
      },
      next_payload_hint: rateKey ? {
        rateKey,
        holder: { name: 'Test', surname: 'User' },
        rooms: [{ rateKey }],
      } : { note: 'Hotel found but no rate keys — try different dates or occupancy.' },
    };
  },

  // Step 3: checkrates + book. ⚠ CREATES A REAL BOOKING in sandbox.
  //
  // HotelBeds booking API requires paxes (guest names) inside each room.
  // The handler auto-fills paxes from the holder if not provided, matching
  // the occupancy from the rate key search.
  book: async ({ tenantId, payload = {} }) => {
    if (!payload.rateKey) {
      return {
        ok: false,
        error: 'rateKey is required — run the availability step first to obtain one.',
        data: null,
      };
    }
    const client = await clientFor(tenantId);
    const holder = payload.holder || { name: 'Test', surname: 'User' };

    const paxes = payload.paxes || [
      { roomId: 1, type: 'AD', name: holder.name, surname: holder.surname },
      { roomId: 1, type: 'AD', name: holder.name, surname: holder.surname },
    ];
    const rooms = payload.rooms || [{
      rateKey: payload.rateKey,
      paxes,
    }];
    if (rooms[0] && !rooms[0].paxes) {
      rooms[0].paxes = paxes;
    }

    let data;
    try {
      data = await client.book({ rateKey: payload.rateKey, holder, rooms });
    } catch (err) {
      return {
        ok: false,
        data: {
          http_status: err.status || null,
          error_response: err.response || err.message,
          note: 'HotelBeds booking failed. Check error_response for details.',
          request_sent: { holder, rooms_count: rooms.length },
        },
        error: err.message,
      };
    }
    const booking = data?.booking || data;
    const ref = booking?.reference || booking?.bookingId || null;

    return {
      ok: Boolean(ref),
      data: {
        booking_reference: ref,
        status: booking?.status || 'CONFIRMED',
        holder: booking?.holder,
        hotel: booking?.hotel,
        raw: data,
      },
      next_payload_hint: ref ? { booking_reference: ref } : null,
      error: ref ? null : 'Booking completed but no reference returned.',
    };
  },

  // Step 4: cancel the booking.
  cancel: async ({ tenantId, payload = {} }) => {
    const ref = payload.booking_reference;
    if (!ref) {
      return {
        ok: false,
        error: 'booking_reference is required — run the book step first.',
        data: null,
      };
    }
    const client = await clientFor(tenantId);
    const data = await client.cancel(ref);
    const booking = data?.booking || data;
    return {
      ok: true,
      data: {
        booking_reference: ref,
        status: booking?.status || 'CANCELLED',
        cancellation_cost: booking?.cancellationAmount || null,
        raw: data,
      },
    };
  },
};
