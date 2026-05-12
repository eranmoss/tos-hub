import { evalCondition, evaluateTriggers, getActivePrompts } from '../../src/prompts/library.js';
import { query, closePool } from '../../src/db/client.js';

afterAll(async () => { await closePool(); });

describe('Layer 9: condition evaluator', () => {
  test('numeric comparison', () => {
    expect(evalCondition('context.x >= 0.6', { x: 0.7 })).toBe(true);
    expect(evalCondition('context.x < 0.5', { x: 0.7 })).toBe(false);
  });

  test('string equality', () => {
    expect(evalCondition('context.t === "EXPERIENCE"', { t: 'EXPERIENCE' })).toBe(true);
    expect(evalCondition('context.t !== "HOTEL"', { t: 'EXPERIENCE' })).toBe(true);
  });

  test('AND/OR compound', () => {
    expect(evalCondition('context.a >= 1 AND context.b === "x"', { a: 2, b: 'x' })).toBe(true);
    expect(evalCondition('context.a >= 1 AND context.b === "y"', { a: 2, b: 'x' })).toBe(false);
    expect(evalCondition('context.a >= 1 OR context.b === "y"', { a: 0, b: 'x' })).toBe(false);
    expect(evalCondition('context.a >= 1 OR context.b === "x"', { a: 0, b: 'x' })).toBe(true);
  });

  test('IS_NULL', () => {
    expect(evalCondition('IS_NULL(context.x)', { x: null })).toBe(true);
    expect(evalCondition('IS_NULL(context.x)', { x: 5 })).toBe(false);
  });

  test('http_status OR branch', () => {
    expect(evalCondition('context.http_status === 401 OR context.http_status === 403', { http_status: 403 })).toBe(true);
    expect(evalCondition('context.http_status === 401 OR context.http_status === 403', { http_status: 500 })).toBe(false);
  });
});

describe('Layer 9: prompt library seeded', () => {
  test('all 15 prompts present and active', async () => {
    const prompts = await getActivePrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(15);
    const keys = prompts.map(p => p.prompt_key);
    expect(keys).toContain('inventory.dedup.uncertain');
    expect(keys).toContain('pricing.extreme_delta');
    expect(keys).toContain('policy.free_cancellation_deadline_past');
    expect(keys).toContain('integration.supplier.auth_failure');
  });

  test('auth_failure prompt is escalate_to_human', async () => {
    const r = await query(`SELECT escalate_to_human FROM hub_prompts WHERE prompt_key='integration.supplier.auth_failure'`);
    expect(r.rows[0].escalate_to_human).toBe(true);
  });
});

describe('Layer 9: evaluateTriggers', () => {
  test('matches inventory.experience.no_duration', async () => {
    const matched = await evaluateTriggers({ duration_minutes: null, type: 'EXPERIENCE', tenant_id: 'test_tenant_prompt' });
    const keys = matched.map(m => m.prompt_key);
    expect(keys).toContain('inventory.experience.no_duration');
  });

  test('escalate_to_human writes hub_escalations', async () => {
    const TENANT = 'test_tenant_escalate';
    await query(`DELETE FROM hub_escalations WHERE tenant_id = $1`, [TENANT]);
    await evaluateTriggers({ http_status: 401, supplier: 'bridgify', tenant_id: TENANT });
    const r = await query(`SELECT * FROM hub_escalations WHERE tenant_id = $1`, [TENANT]);
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    expect(r.rows[0].prompt_key).toBe('integration.supplier.auth_failure');
    await query(`DELETE FROM hub_escalations WHERE tenant_id = $1`, [TENANT]);
  });

  test('inactive prompts excluded', async () => {
    await query(`UPDATE hub_prompts SET is_active = false WHERE prompt_key = 'pricing.extreme_delta'`);
    const prompts = await getActivePrompts();
    expect(prompts.map(p => p.prompt_key)).not.toContain('pricing.extreme_delta');
    await query(`UPDATE hub_prompts SET is_active = true WHERE prompt_key = 'pricing.extreme_delta'`);
  });
});
