/**
 * Consumer-facing API endpoints — used by the TOS Frontend bundle.
 *
 * Auth: `Authorization: Bearer <api-key>` — same API key as X-Api-Key
 * (partners embed TOS_CONFIG.auth.token = their API key).
 *
 * These endpoints are intentionally limited to consumer-safe operations:
 * no B2B analytics, no admin actions, no cross-tenant data.
 */
import express from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db/client.js';
import { callClaude } from '../agents/chat.js';

const MAX_HISTORY = 8;

// ── Auth middleware ────────────────────────────────────────────────────────────
const consumerAuth = async (req, res, next) => {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'missing Authorization: Bearer <api-key>' });

  const { rows } = await query('SELECT * FROM hub_tenants');
  for (const t of rows) {
    if (await bcrypt.compare(token, t.api_key_hash)) {
      req.tenant = t;
      return next();
    }
  }
  return res.status(401).json({ error: 'invalid api key' });
};

// ── Consumer system prompt (travel assistant, not B2B analytics) ──────────────
const buildConsumerSystemPrompt = (tenant, context) => {
  const destination = context?.destination || '';
  const productTitle = context?.productTitle || '';
  const currentPage = context?.currentPage || 'browse';

  return `You are a friendly travel assistant for ${tenant?.name || 'this travel platform'}.
You help travelers discover destinations, plan trips, and choose experiences, hotels, and transfers.

${destination ? `The traveler is currently exploring: **${destination}**` : ''}
${productTitle ? `They are viewing: **${productTitle}**` : ''}
${currentPage ? `Current page: ${currentPage}` : ''}

Your role:
- Help travelers find the right experience, hotel, or transfer for their trip
- Answer questions about destinations, activities, and travel logistics
- Give concise, practical recommendations with genuine enthusiasm
- When relevant, suggest they search for specific types of products on this platform
- Do NOT discuss pricing beyond what's visible on the page
- Do NOT promise availability — always suggest they check the booking form
- Stay focused on travel. Politely deflect off-topic requests.
- Keep answers to 2–4 sentences unless a list is genuinely needed

Tone: warm, knowledgeable, like a well-traveled friend, not a corporate bot.`;
};

// ── Routes ────────────────────────────────────────────────────────────────────
export function buildConsumerRouter() {
  const router = express.Router();

  router.post('/v1/consumer/chat', consumerAuth, async (req, res) => {
    try {
      const { message, conversation_id, context } = req.body || {};
      if (!message?.trim()) return res.status(400).json({ error: 'message required' });

      const tenantId = req.tenant.tenant_id;

      // Load or create conversation
      let convo;
      if (conversation_id) {
        const r = await query(
          `SELECT id, messages FROM hub_agent_conversations WHERE id = $1 AND tenant_id = $2`,
          [conversation_id, tenantId],
        );
        convo = r.rows[0];
      }
      if (!convo) {
        const r = await query(
          `INSERT INTO hub_agent_conversations (tenant_id, messages)
           VALUES ($1, '[]'::jsonb) RETURNING id, messages`,
          [tenantId],
        );
        convo = r.rows[0];
      }

      const history = Array.isArray(convo.messages) ? convo.messages : [];
      const userMsg = { role: 'user', content: message, ts: new Date().toISOString() };
      const systemPrompt = buildConsumerSystemPrompt(req.tenant, context);

      const windowed = [...history.slice(-MAX_HISTORY), userMsg].map(m => ({
        role: m.role, content: m.content,
      }));

      const assistantText = await callClaude({ systemPrompt, messages: windowed });

      const assistantMsg = {
        role: 'assistant',
        content: assistantText,
        ts: new Date().toISOString(),
        id: crypto.randomUUID(),
      };

      const newMessages = [...history, userMsg, assistantMsg];
      await query(
        `UPDATE hub_agent_conversations SET messages = $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify(newMessages), convo.id],
      );

      res.json({
        conversation_id: convo.id,
        message_id: assistantMsg.id,
        response: assistantText,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
