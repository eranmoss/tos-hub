import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/client.js';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_HISTORY = 10;

let client = null;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
};

const loadTenantContext = async (tenant_id) => {
  const tenant = (await query(
    `SELECT tenant_id, name, tier, dedup_strategy FROM hub_tenants WHERE tenant_id = $1`,
    [tenant_id]
  )).rows[0];
  const integrations = (await query(
    `SELECT s.supplier_slug, s.name, s.categories, ts.sla_tier
       FROM hub_tenant_suppliers ts
       JOIN hub_suppliers s ON s.supplier_slug = ts.supplier_slug
      WHERE ts.tenant_id = $1 AND ts.is_active = true`,
    [tenant_id]
  )).rows;
  const txnSummary = (await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS success,
            COALESCE(AVG(latency_ms),0)::int AS avg_latency
       FROM hub_transactions
      WHERE tenant_id = $1 AND created_at >= now() - INTERVAL '24 hours'`,
    [tenant_id]
  )).rows[0];
  const escalations = (await query(
    `SELECT COUNT(*)::int AS pending
       FROM hub_escalations
      WHERE tenant_id = $1 AND status = 'PENDING'`,
    [tenant_id]
  )).rows[0];
  const dedup = (await query(
    `SELECT config_json FROM hub_dedup_config
      WHERE tenant_id = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`,
    [tenant_id]
  )).rows[0];
  return { tenant, integrations, txnSummary, escalations, dedup };
};

const buildSystemPrompt = (ctx, pageContext) => {
  const { tenant, integrations, txnSummary, escalations, dedup } = ctx;
  const successRate = txnSummary.total > 0
    ? ((txnSummary.success / txnSummary.total) * 100).toFixed(1)
    : '0.0';
  const integrationList = integrations.map(i => i.name).join(', ') || 'none';
  const dedupStrategy = dedup?.config_json?.strategy || tenant?.dedup_strategy || 'LOWEST_PRICE';
  return `You are the TOS Integration Hub agent for ${tenant?.name || 'this partner'}.
You help partners understand and manage their travel supplier integrations.

TENANT CONTEXT:
- Plan: ${tenant?.tier || 'STARTER'}
- Active integrations: ${integrationList}
- Last 24 hours: ${txnSummary.total} transactions, ${successRate}% success rate
- Average latency: ${txnSummary.avg_latency}ms
- Pending escalations: ${escalations.pending}
- Dedup strategy: ${dedupStrategy}

CURRENT PAGE: ${pageContext?.current_page || 'unknown'}
PAGE DATA: ${JSON.stringify(pageContext?.page_data || {})}

Guidelines:
- Answer with specific numbers and timestamps from the data
- Be concise — partners are technical, skip explanations of basics
- Suggest actionable next steps when relevant
- If you don't have enough data to answer, say so clearly
- Format responses with markdown where it improves readability`;
};

const loadOrCreateConversation = async (tenant_id, conversation_id) => {
  if (conversation_id) {
    const r = await query(
      `SELECT id, messages FROM hub_agent_conversations WHERE id = $1 AND tenant_id = $2`,
      [conversation_id, tenant_id]
    );
    if (r.rows[0]) return r.rows[0];
  }
  const r = await query(
    `INSERT INTO hub_agent_conversations(tenant_id, messages)
     VALUES ($1, '[]'::jsonb) RETURNING id, messages`,
    [tenant_id]
  );
  return r.rows[0];
};

export const callClaude = async ({ systemPrompt, messages }) => {
  if (process.env.NODE_ENV === 'test' || process.env.AGENT_MOCK === '1') {
    const last = messages[messages.length - 1]?.content || '';
    return `**Mock response** for: ${last.slice(0, 120)}`;
  }
  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });
  const text = resp.content.find(c => c.type === 'text')?.text || '';
  return text;
};

export const handleChat = async ({ tenant_id, message, conversation_id, context }) => {
  if (!message || typeof message !== 'string') throw new Error('message required');
  const convo = await loadOrCreateConversation(tenant_id, conversation_id);
  const history = Array.isArray(convo.messages) ? convo.messages : [];
  const now = new Date().toISOString();
  const userMsg = { role: 'user', content: message, ts: now };
  const ctx = await loadTenantContext(tenant_id);
  const systemPrompt = buildSystemPrompt(ctx, context);
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
    [JSON.stringify(newMessages), convo.id]
  );
  return {
    conversation_id: convo.id,
    message_id: assistantMsg.id,
    response: assistantText,
  };
};
