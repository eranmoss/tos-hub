INSERT INTO hub_prompts
  (prompt_key, category, trigger_condition, prompt_template, escalate_to_human, is_active) VALUES

-- INVENTORY
('inventory.dedup.uncertain',
 'INVENTORY',
 'context.dedup_score >= 0.60 AND context.dedup_score < 0.80 AND context.uncertain_behavior === "AGENT_DECIDE"',
 'Two experience results have a dedup score of {dedup_score} — uncertain range.
Product A: "{title_a}" from {supplier_a}, operator: {operator_a}
Product B: "{title_b}" from {supplier_b}, operator: {operator_b}
If the operator names match exactly (case-insensitive), treat as DUPLICATE.
Otherwise treat as DISTINCT. Return your decision as JSON:
{"decision": "DUPLICATE" | "DISTINCT", "reasoning": "..."}',
 false, true),

('inventory.experience.no_duration',
 'INVENTORY',
 'IS_NULL(context.duration_minutes) AND context.type === "EXPERIENCE"',
 'The experience "{title}" from {supplier} has no duration field.
Scan the description for duration mentions. Patterns to match:
- "X hours" or "X-hour" → X * 60 minutes
- "half day" → 240 minutes
- "full day" or "whole day" → 480 minutes
- "X minutes" → X minutes
Description: "{description}"
Return JSON: {"duration_minutes": <integer> | null, "source": "extracted" | "not_found"}',
 false, true),

('inventory.experience.zero_results',
 'INVENTORY',
 'context.result_count === 0 AND context.other_supplier_count > 0',
 'Supplier {supplier} returned 0 results for search in {destination}.
The other supplier returned {other_supplier_count} results.
Check if this is an expected coverage gap or an anomaly.
Known low-coverage suppliers for this region: {low_coverage_suppliers}
If this is an expected gap: return {"action": "LOG", "reason": "coverage_gap"}
If unexpected: return {"action": "FLAG", "reason": "SUPPLIER_ANOMALY"}',
 false, true),

('inventory.policy.missing_cancellation',
 'INVENTORY',
 'IS_NULL(context.cancellation_policy) AND context.operation === "normalize"',
 'The result "{title}" from {supplier} has no cancellation policy.
Tenant default policy: {tenant_default_policy}
TOS platform default: NON_REFUNDABLE
Apply in order: tenant default if set, else platform default.
Return JSON: {"policy_source": "TENANT_DEFAULT" | "PLATFORM_DEFAULT",
"policy": {"type": "NON_REFUNDABLE" | "FREE_CANCELLATION", "free_until": null}}',
 false, true),

('inventory.experience.category_mismatch',
 'INVENTORY',
 'context.category_a !== context.category_b AND context.decision === "DUPLICATE"',
 'Two confirmed duplicate experiences have different CTS categories.
Product A category: {category_a} (from {supplier_a})
Product B category: {category_b} (from {supplier_b})
Rules:
1. If one is more specific (e.g. FOOD vs CULTURE for a cooking class) → use more specific
2. If genuinely ambiguous → use Bridgify category as authoritative
3. Bridgify slug is "bridgify"
Return JSON: {"category": "<chosen_category>", "reason": "..."}',
 false, true),

-- INTEGRATION
('integration.supplier.high_latency',
 'INTEGRATION',
 'context.response_time_ms > 3000',
 'Supplier {supplier} response time is {response_time_ms}ms (threshold: 3000ms).
Other supplier has returned results: {other_results_available}
Return JSON: {"action": "PARTIAL_RETURN" | "WAIT" | "TIMEOUT","reason": "..."}',
 false, true),

('integration.supplier.partial_results',
 'INTEGRATION',
 'context.results_truncated === true OR context.result_count < context.expected_min',
 'Supplier {supplier} returned truncated or insufficient results.
Result count: {result_count}, expected minimum: {expected_min}
Return JSON: {"action": "RETURN_PARTIAL" | "RETRY_RELAXED", "relaxed_params": {...} | null}',
 false, true),

('integration.supplier.auth_failure',
 'INTEGRATION',
 'context.http_status === 401 OR context.http_status === 403',
 'Supplier {supplier} returned auth failure (HTTP {http_status}).
Immediately stop all calls to this supplier for this session.
Return JSON: {"action": "STOP_SUPPLIER", "supplier": "{supplier}"}',
 true, true),

('integration.supplier.unexpected_format',
 'INTEGRATION',
 'context.normalization_failed === true',
 'Normalization failed for {failure_count} results from {supplier}.
Failure rate: {failure_rate_pct}%. Failed fields: {failed_fields}
Return JSON: {"action": "EXCLUDE_FAILED" | "ESCALATE_SYSTEMATIC"}',
 false, true),

('integration.hotelbeds.rate_key_expiry_risk',
 'INTEGRATION',
 'context.supplier === "hotelbeds-hotels" AND context.minutes_since_search > 10',
 'HotelBeds rate key may have expired. Time since search: {minutes_since_search} minutes.
Return JSON: {"action": "CHECKRATES_REQUIRED", "price_change_threshold_pct": 5}',
 false, true),

-- PRICING
('pricing.extreme_delta',
 'PRICING',
 'context.decision === "DUPLICATE" AND context.price_delta_pct > 40',
 'Confirmed duplicate products have a {price_delta_pct}% price difference.
Do NOT automatically suppress the higher price.
Return JSON: {"action": "FLAG_ANOMALY", "pricing_anomaly": true}',
 false, true),

('pricing.fx_rate_missing',
 'PRICING',
 'IS_NULL(context.fx_rate) AND context.currency !== "USD"',
 'Cannot normalize price for "{title}" from {supplier}. Currency {currency} has no FX rate.
Return JSON: {"action": "HALT_RESULT", "reason": "UNKNOWN_CURRENCY"}',
 true, true),

('pricing.net_retail_ambiguity',
 'PRICING',
 'context.supplier === "hotelbeds-hotels" AND context.net_flag_missing === true AND context.amount_usd > context.expected_max_usd',
 'HotelBeds hotel result for "{title}" has unexpectedly high amount: {amount_usd} USD.
Return JSON: {"action": "FLAG_UNCERTAIN" | "TREAT_AS_RETAIL"}',
 false, true),

-- POLICY
('policy.conflicting_cancellation',
 'POLICY',
 'context.decision === "DUPLICATE" AND context.policies_conflict === true',
 'Confirmed duplicate products have conflicting cancellation policies.
Apply the MORE RESTRICTIVE policy. Return JSON with chosen_policy.',
 false, true),

('policy.free_cancellation_deadline_past',
 'POLICY',
 'context.free_until_is_past === true',
 'The free cancellation deadline for "{title}" has already passed.
Return JSON: {"action": "UPDATE_STATUS", "availability_status": "CANCELLATION_FEE_APPLIES"}',
 false, true)

ON CONFLICT (prompt_key) DO UPDATE SET
  category=EXCLUDED.category,
  trigger_condition=EXCLUDED.trigger_condition,
  prompt_template=EXCLUDED.prompt_template,
  escalate_to_human=EXCLUDED.escalate_to_human,
  updated_at=now();
