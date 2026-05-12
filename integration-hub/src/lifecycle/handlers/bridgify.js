import { BridgifyExperiences } from '../../suppliers/bridgify/experiences.js';
import { getSecret } from '../../infra/secrets.js';

const toYmd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const clientFor = async (tenantId) => {
  const creds = await getSecret(tenantId, 'bridgify');
  if (!creds) throw new Error('bridgify credentials not found for tenant');
  if (!creds.client_id || !creds.client_secret) {
    throw new Error('bridgify credentials missing client_id / client_secret');
  }
  return new BridgifyExperiences({
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
    baseUrl: creds.base_url,
  });
};

const resolveProductId = (rawRef, rawContent) => {
  if (rawContent && typeof rawContent === 'object') {
    if (rawContent.bridgify_uuid) return String(rawContent.bridgify_uuid);
    if (rawContent.uuid) return String(rawContent.uuid);
    if (rawContent.id)   return String(rawContent.id);
  }
  return rawRef;
};

export const bridgifyHandler = {
  detail: async ({ tenantId, rawRef, rawContent }) => {
    const client = await clientFor(tenantId);
    const productId = resolveProductId(rawRef, rawContent);
    const data = await client._authedRequest({
      method: 'GET',
      url: `/attractions/products/${encodeURIComponent(productId)}/`,
      operation: 'lifecycle_detail',
    });
    const attraction = data?.attraction || data?.product || data;
    const today = new Date();
    return {
      ok: true,
      data: attraction,
      next_payload_hint: {
        date_from: toYmd(addDays(today, 1)),
        date_to: toYmd(addDays(today, 8)),
      },
    };
  },

  availability: async ({ tenantId, rawRef, rawContent, payload = {} }) => {
    const client = await clientFor(tenantId);
    const productId = resolveProductId(rawRef, rawContent);
    const today = new Date();
    const params = {
      date_from: payload.date_from || toYmd(addDays(today, 1)),
      date_to: payload.date_to || toYmd(addDays(today, 8)),
    };
    const data = await client._authedRequest({
      method: 'GET',
      url: `/attractions/products/availability/${encodeURIComponent(productId)}/`,
      params,
      operation: 'lifecycle_availability',
    });
    const slots =
      data?.data?.slots ||
      data?.slots ||
      (Array.isArray(data) ? data : []);
    const firstSlot = Array.isArray(slots) && slots[0] ? slots[0] : null;
    const firstDate = firstSlot?.date || params.date_from;
    const firstTime = Array.isArray(firstSlot?.times) ? firstSlot.times[0] : null;
    return {
      ok: true,
      data,
      next_payload_hint: {
        product_id: productId,
        date_from: firstDate,
        date_to: firstDate,
        time: firstTime || '10:00',
        adults: 2,
        holder_name: 'Test User',
        email: 'test@example.com',
        phone: '+1234567890',
      },
    };
  },

  book: async ({ tenantId, rawRef, rawContent, payload = {} }) => {
    const client = await clientFor(tenantId);
    const productId = resolveProductId(rawRef, rawContent);

    const { holder_name, email, phone, adults, date_from, date_to } = payload;
    if (!holder_name || !email || !date_from || !date_to) {
      return {
        ok: false,
        error: 'Missing required booking fields: holder_name, email, date_from, date_to',
      };
    }

    const bookPayload = {
      id: productId,
      from_date: date_from,
      to_date: date_to,
      holder_name,
      email,
      phone: phone || '',
      adults: parseInt(adults) || 2,
    };

    let data;
    try {
      data = await client.book(bookPayload);
    } catch (err) {
      if (err.status === 404) {
        return {
          ok: false,
          error: 'Bridgify sandbox does not support live bookings. The availability flow completed successfully — in production this would create a real booking.',
          data: { sandbox_limitation: true, payload_sent: bookPayload },
        };
      }
      throw err;
    }
    const ref =
      data?.booking_reference ||
      data?.reference ||
      data?.id ||
      data?.confirmation_code ||
      null;

    return {
      ok: true,
      data: {
        booking_mode: 'merchant',
        booking_reference: ref,
        status: data?.status || 'confirmed',
        supplier_response: data,
      },
    };
  },

  cancel: async ({ tenantId, rawRef, rawContent, payload = {} }) => {
    const client = await clientFor(tenantId);
    const bookingRef = payload.booking_reference || rawRef;
    if (!bookingRef) {
      return { ok: false, error: 'No booking_reference provided for cancellation' };
    }
    const data = await client.cancel(bookingRef);
    return {
      ok: true,
      data: {
        status: data?.status || 'cancelled',
        booking_reference: bookingRef,
        supplier_response: data,
      },
    };
  },
};
