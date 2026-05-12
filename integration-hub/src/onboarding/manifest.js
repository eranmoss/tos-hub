import { z } from 'zod';

const FieldMapping = z.object({
  source: z.string(),
  target: z.string(),
  transform: z.string().nullable().optional(),
});

const Operation = z.object({
  method: z.string(),
  endpoint: z.string(),
  request_schema: z.object({}).passthrough().optional(),
  response_schema: z.object({}).passthrough().optional(),
}).passthrough();

export const ManifestSchema = z.object({
  manifest_version: z.string().optional(),
  supplier: z.object({
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    categories: z.array(z.string()).min(1),
    base_url_sandbox: z.string().url(),
    base_url_production: z.string().url().optional(),
    documentation_url: z.string().url().optional(),
    support_contact: z.string().optional(),
  }),
  auth: z.object({
    type: z.enum(['API_KEY', 'HMAC_SHA256', 'OAUTH2', 'OAUTH2_CLIENT_CREDENTIALS', 'OAUTH2_PASSWORD', 'BEARER', 'BASIC']),
    credential_fields: z.array(z.string()).min(1),
    signature_algorithm: z.string().optional(),
    signature_inputs: z.array(z.string()).optional(),
    token_endpoint: z.string().nullable().optional(),
  }),
  operations: z.object({
    search: Operation,
    book: Operation,
  }).passthrough(),
  rate_limit_rpm: z.number().optional(),
  response_format: z.string().optional(),
  supports_webhooks: z.boolean().optional(),
  webhook_events: z.array(z.string()).optional(),
  cts_mapping: z.object({
    type_value: z.string(),
    field_mappings: z.array(FieldMapping).min(1),
    status_mappings: z.record(z.string(), z.string()).optional(),
    default_currency: z.string().optional(),
    category_mappings: z.record(z.string(), z.string()).optional(),
  }),
  execution_profile: z.object({
    sync_operations: z.array(z.string()).optional(),
    async_operations: z.array(z.string()).optional(),
    avg_response_time_ms: z.number().optional(),
  }).optional(),
  test_suite: z.object({
    sandbox_search_params: z.record(z.any()).refine(v => Object.keys(v).length > 0, 'non-empty'),
    expected_result_count_min: z.number().optional(),
    test_booking_ref: z.string().nullable().optional(),
  }),
  tenant_config: z.object({
    tenant_id: z.string(),
    sla_tier: z.enum(['ENTERPRISE', 'GROWTH', 'STARTER']),
    preferred_for_categories: z.array(z.string()).optional(),
  }).passthrough(),
});

export const validateManifest = (manifest, { partial = false } = {}) => {
  const schema = partial ? ManifestSchema.deepPartial() : ManifestSchema;
  const r = schema.safeParse(manifest);
  return { ok: r.success, errors: r.success ? null : r.error.errors };
};
