import { randomUUID } from 'crypto';
import { query } from '../db/client.js';
import { scoreDedup } from './engine.js';

const logTest = async (tenantId, sessionId, a, b, scoreResult, strategyApplied, reasoning = null) => {
  try {
    await query(
      `INSERT INTO hub_dedup_test_log(tenant_id, session_id, option_id_a, option_id_b,
        signal_location, signal_name, signal_duration, signal_category,
        composite_score, decision, strategy_applied, agent_reasoning)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tenantId, sessionId, a.option_id, b.option_id,
       scoreResult.signals.location, scoreResult.signals.name,
       scoreResult.signals.duration, scoreResult.signals.category,
       scoreResult.score, scoreResult.decision, strategyApplied, reasoning]
    );
  } catch {}
};

export const applyStrategy = async (a, b, cfg, { tenantId, sessionId } = {}) => {
  const scoreResult = scoreDedup(a, b, cfg);
  let outcome;

  if (scoreResult.decision === 'DISTINCT') {
    outcome = { type: 'DISTINCT', options: [a, b] };
  } else if (scoreResult.decision === 'DUPLICATE') {
    if (cfg.strategy === 'LOWEST_PRICE') {
      const lower = a.price.amount_usd <= b.price.amount_usd ? a : b;
      const higher = lower === a ? b : a;
      outcome = { type: 'DUPLICATE', strategy: 'LOWEST_PRICE',
        options: [lower], suppressed: [higher] };
    } else if (cfg.strategy === 'PREFERRED_SUPPLIER') {
      const preferred = a.supplier_slug === cfg.preferred_supplier ? a :
                        b.supplier_slug === cfg.preferred_supplier ? b : null;
      if (preferred) {
        const other = preferred === a ? b : a;
        outcome = { type: 'DUPLICATE', strategy: 'PREFERRED_SUPPLIER',
          options: [preferred], suppressed: [other] };
      } else {
        const lower = a.price.amount_usd <= b.price.amount_usd ? a : b;
        const higher = lower === a ? b : a;
        outcome = { type: 'DUPLICATE', strategy: 'LOWEST_PRICE',
          options: [lower], suppressed: [higher] };
      }
    } else if (cfg.strategy === 'SHOW_ALL') {
      const lower = a.price.amount_usd <= b.price.amount_usd ? a : b;
      const higher = lower === a ? b : a;
      higher.is_duplicate_of = lower.option_id;
      outcome = { type: 'DUPLICATE', strategy: 'SHOW_ALL', options: [a, b] };
    } else {
      outcome = { type: 'DUPLICATE', options: [a, b] };
    }
  } else {
    const pairId = randomUUID();
    a.dedup_score = scoreResult.score;
    b.dedup_score = scoreResult.score;
    a.candidate_pair_id = pairId;
    b.candidate_pair_id = pairId;
    const behavior = cfg.uncertain_behavior || 'SHOW_BOTH';
    if (behavior === 'SHOW_BOTH') {
      outcome = { type: 'UNCERTAIN', behavior, options: [a, b] };
    } else if (behavior === 'ESCALATE') {
      try {
        await query(
          `INSERT INTO hub_escalations(tenant_id, prompt_key, trigger_data, session_id)
           VALUES ($1,$2,$3,$4)`,
          [tenantId, 'inventory.dedup.uncertain',
           JSON.stringify({ a: a.option_id, b: b.option_id, score: scoreResult.score }),
           sessionId]
        );
      } catch {}
      outcome = { type: 'UNCERTAIN', behavior, options: [a, b], escalation_pending: true };
    } else if (behavior === 'AGENT_DECIDE') {
      outcome = { type: 'UNCERTAIN', behavior, options: [a, b], agent_decides: true };
    } else {
      outcome = { type: 'UNCERTAIN', behavior, options: [a, b] };
    }
  }

  if (cfg.test_mode) {
    await logTest(tenantId, sessionId, a, b, scoreResult, outcome.strategy || outcome.behavior || 'DISTINCT');
  }
  outcome.score = scoreResult.score;
  outcome.signals = scoreResult.signals;
  return outcome;
};

export const dedupList = async (options, cfg, ctx = {}) => {
  const processed = [];
  const suppressed = new Set();
  for (let i = 0; i < options.length; i++) {
    if (suppressed.has(i)) continue;
    for (let j = i + 1; j < options.length; j++) {
      if (suppressed.has(j)) continue;
      const a = options[i];
      const b = options[j];
      const result = await applyStrategy(a, b, cfg, ctx);
      if (result.type === 'DUPLICATE' && result.strategy !== 'SHOW_ALL' && result.suppressed) {
        const idx = result.suppressed[0] === a ? i : j;
        suppressed.add(idx);
        if (idx === i) break;
      }
    }
  }
  return options.filter((_, idx) => !suppressed.has(idx));
};
