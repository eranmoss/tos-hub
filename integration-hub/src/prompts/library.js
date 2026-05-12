import { query } from '../db/client.js';
import { sendEmail } from '../infra/notify.js';

const OPS = [
  ['>=', (a, b) => a >= b],
  ['<=', (a, b) => a <= b],
  ['===', (a, b) => a === b],
  ['!==', (a, b) => a !== b],
  ['>', (a, b) => a > b],
  ['<', (a, b) => a < b],
];

const coerce = (s) => {
  const t = String(s).trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = t.match(/^"(.*)"$/) || t.match(/^'(.*)'$/);
  if (m) return m[1];
  return undefined;
};

const resolvePath = (ctx, path) => {
  const parts = path.split('.');
  let cur = ctx;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
};

const resolveValue = (token, ctx) => {
  const v = coerce(token);
  if (v !== undefined) return v;
  if (token.startsWith('context.')) {
    return resolvePath(ctx, token.slice('context.'.length));
  }
  return undefined;
};

const evalIsNull = (expr, ctx) => {
  const m = expr.match(/^IS_NULL\((.+)\)$/);
  if (!m) return null;
  const v = resolveValue(m[1].trim(), ctx);
  return v === null || v === undefined;
};

const evalAtomic = (expr, ctx) => {
  const e = expr.trim();
  if (e.startsWith('IS_NULL(')) return evalIsNull(e, ctx);
  if (e.startsWith('NOT ')) return !evalAtomic(e.slice(4), ctx);
  for (const [op, fn] of OPS) {
    const idx = e.indexOf(` ${op} `);
    if (idx > -1) {
      const lhs = resolveValue(e.slice(0, idx).trim(), ctx);
      const rhs = resolveValue(e.slice(idx + op.length + 2).trim(), ctx);
      return fn(lhs, rhs);
    }
  }
  const v = resolveValue(e, ctx);
  return !!v;
};

export const evalCondition = (expr, ctx) => {
  if (!expr) return false;
  // Split on OR first (lowest precedence)
  const orParts = expr.split(/\s+OR\s+/);
  return orParts.some(orPart => {
    const andParts = orPart.split(/\s+AND\s+/);
    return andParts.every(p => evalAtomic(p, ctx));
  });
};

export const getActivePrompts = async () => {
  const r = await query(
    `SELECT prompt_key, category, trigger_condition, prompt_template, escalate_to_human
     FROM hub_prompts WHERE is_active = true`
  );
  return r.rows;
};

export const evaluateTriggers = async (ctx) => {
  const prompts = await getActivePrompts();
  const matched = [];
  for (const p of prompts) {
    try {
      if (evalCondition(p.trigger_condition, ctx)) {
        matched.push(p);
        if (p.escalate_to_human) {
          await query(
            `INSERT INTO hub_escalations(tenant_id, prompt_key, trigger_data, session_id)
             VALUES ($1,$2,$3,$4)`,
            [ctx.tenant_id || 'unknown', p.prompt_key, ctx, ctx.session_id || null]
          );
          await sendEmail({
            to: 'ops@tos.dev', subject: `Escalation: ${p.prompt_key}`,
            text: JSON.stringify({ prompt: p.prompt_key, context: ctx }),
          });
        }
      }
    } catch (err) {
      console.log(JSON.stringify({ level: 'error', event: 'trigger_eval_failed', prompt: p.prompt_key, error: err.message }));
    }
  }
  return matched;
};
