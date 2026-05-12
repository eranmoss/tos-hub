import { HotelbedsExperiences } from '../../suppliers/hotelbeds/experiences.js';
import { getSecret } from '../../infra/secrets.js';

// HotelBeds Activities lifecycle:
//   detail       → GET /activities/{code} (activity info + modalities)
//   availability → GET /activities?code=&dateFrom=&dateTo= (live search with date filter)
//   book         → POST /bookings (creates a real booking in sandbox)
//   cancel       → DELETE /bookings/{ref}
//
// See SUPPLIER_PLAYBOOK.md hotelbeds-activities section.

const toYmd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const clientFor = async (tenantId) => {
  const creds =
    (await getSecret(tenantId, 'hotelbeds-activities')) ||
    (await getSecret(tenantId, 'hotelbeds'));
  if (!creds) throw new Error('hotelbeds credentials not found for tenant');
  if (!creds.api_key) throw new Error('hotelbeds credentials missing api_key');
  const secretKey = creds.secret_key || creds.secret;
  if (!secretKey) throw new Error('hotelbeds credentials missing secret_key');
  return new HotelbedsExperiences({
    apiKey: creds.api_key,
    secretKey,
    env: creds.env || 'sandbox',
  });
};

export const hotelbedsActivitiesHandler = {
  // Step 1: fetch activity detail (descriptions, modalities, images).
  detail: async ({ tenantId, rawRef, rawContent }) => {
    const client = await clientFor(tenantId);
    const code = rawContent?.code || rawRef;
    let data;
    try {
      data = await client.request({
        method: 'GET',
        url: `/activities/${encodeURIComponent(code)}`,
        headers: client._headers(),
        operation: 'lifecycle_detail',
      });
    } catch (err) {
      return {
        ok: false,
        data: {
          http_status: err.status || null,
          error_response: err.response || err.message,
          note: err.status === 403
            ? 'HotelBeds Activities API access denied — check API key permissions.'
            : 'Detail fetch failed.',
        },
        error: err.message,
      };
    }
    const activity = data?.activity || data;
    const today = new Date();
    return {
      ok: true,
      data: activity,
      next_payload_hint: {
        code,
        dateFrom: toYmd(addDays(today, 3)),
        dateTo: toYmd(addDays(today, 10)),
      },
    };
  },

  // Step 2: search availability for this activity by code + dates.
  availability: async ({ tenantId, rawRef, rawContent, payload = {} }) => {
    const client = await clientFor(tenantId);
    const code = payload.code || rawContent?.code || rawRef;
    const today = new Date();
    const params = {
      code,
      dateFrom: payload.dateFrom || toYmd(addDays(today, 3)),
      dateTo: payload.dateTo || toYmd(addDays(today, 10)),
    };

    const data = await client.request({
      method: 'GET',
      url: '/activities',
      headers: client._headers(),
      params,
      operation: 'lifecycle_availability',
    });

    const activities = data?.activities || data?.items || [];
    const first = activities[0];
    const firstModality = first?.modalities?.[0];
    const firstRate = firstModality?.rates?.[0];

    return {
      ok: true,
      data: {
        activities_count: activities.length,
        modalities: first?.modalities?.length || 0,
        raw: data,
      },
      next_payload_hint: firstRate ? {
        activityCode: first.code || code,
        modalityCode: firstModality.code,
        rateKey: firstRate.rateKey,
        from: params.dateFrom,
        to: params.dateTo,
        paxes: [{ age: 30 }, { age: 30 }],
        holder: { name: 'Test', surname: 'User' },
      } : { note: 'No rates returned — try broader dates.' },
    };
  },

  // Step 3: book. ⚠ CREATES A REAL BOOKING in sandbox.
  // The frontend sends generic fields (holder_name, email, date_from, date_to, adults).
  // If activityCode is missing, we resolve it from rawRef/rawContent and run a
  // live availability search to get a valid rateKey before booking.
  book: async ({ tenantId, rawRef, rawContent, payload = {} }) => {
    const client = await clientFor(tenantId);
    let activityCode = payload.activityCode;
    let modalityCode = payload.modalityCode;
    let rateKey = payload.rateKey;

    if (!activityCode && !rateKey) {
      activityCode = rawContent?.code || rawRef;
      if (!activityCode) {
        return { ok: false, error: 'Cannot resolve activity code from inventory.', data: null };
      }
      const today = new Date();
      const dateFrom = payload.date_from || payload.from || toYmd(addDays(today, 3));
      const dateTo = payload.date_to || payload.to || toYmd(addDays(today, 10));
      const availData = await client.request({
        method: 'GET',
        url: '/activities',
        headers: client._headers(),
        params: { code: activityCode, dateFrom, dateTo },
        operation: 'book_preflight_availability',
      });
      const activities = availData?.activities || [];
      const first = activities[0];
      const firstModality = first?.modalities?.[0];
      const firstRate = firstModality?.rates?.[0];
      if (!firstRate?.rateKey) {
        return {
          ok: false,
          error: 'No bookable rates found for this activity and date range. Try different dates.',
          data: { activityCode, dateFrom, dateTo },
        };
      }
      rateKey = firstRate.rateKey;
      modalityCode = modalityCode || firstModality.code;
    }

    const holderName = payload.holder_name || '';
    const nameParts = holderName.split(/\s+/);
    const holder = payload.holder || {
      name: nameParts[0] || 'Guest',
      surname: nameParts.slice(1).join(' ') || 'Traveler',
    };

    const paxCount = parseInt(payload.adults) || 2;
    const paxes = payload.paxes || Array.from({ length: paxCount }, () => ({ age: 30 }));

    const bookPayload = {
      language: 'en',
      holder,
      activities: [{
        code: activityCode,
        modality: modalityCode,
        from: payload.date_from || payload.from,
        to: payload.date_to || payload.to,
        paxes,
        ...(rateKey ? { rateKey } : {}),
      }],
    };

    const data = await client.book(bookPayload);
    const booking = data?.booking || data;
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

  // Step 4: cancel the booking.
  cancel: async ({ tenantId, payload = {} }) => {
    const ref = payload.booking_reference;
    if (!ref) {
      return { ok: false, error: 'booking_reference required — run book first.', data: null };
    }
    const client = await clientFor(tenantId);
    const data = await client.cancel(ref);
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
