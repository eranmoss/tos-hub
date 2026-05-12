import { query } from '../db/client.js';
import { sendEmail } from '../infra/notify.js';
import { setSecret } from '../infra/secrets.js';

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

export const runProvisioning = async ({ manifest, tenantId }) => {
  const slug = manifest.supplier.slug;
  const steps = [];

  // 1. hub_suppliers
  await query(
    `INSERT INTO hub_suppliers(supplier_slug, name, categories, base_url_sandbox, base_url_prod,
      documentation_url, support_contact, auth_type, rate_limit_rpm, response_format, supports_webhooks)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (supplier_slug) DO UPDATE SET
       name=EXCLUDED.name, categories=EXCLUDED.categories,
       base_url_sandbox=EXCLUDED.base_url_sandbox, base_url_prod=EXCLUDED.base_url_prod,
       documentation_url=EXCLUDED.documentation_url, support_contact=EXCLUDED.support_contact,
       auth_type=EXCLUDED.auth_type, rate_limit_rpm=EXCLUDED.rate_limit_rpm,
       response_format=EXCLUDED.response_format, supports_webhooks=EXCLUDED.supports_webhooks`,
    [slug, manifest.supplier.name, manifest.supplier.categories,
     manifest.supplier.base_url_sandbox, manifest.supplier.base_url_production,
     manifest.supplier.documentation_url, manifest.supplier.support_contact,
     manifest.auth.type, manifest.rate_limit_rpm || 60,
     manifest.response_format || 'JSON', !!manifest.supports_webhooks]
  );
  steps.push({ step: 1, target: 'hub_suppliers', ok: true });

  // 2. hub_schema_mappings — re-onboarding: wipe + re-insert so removed mappings disappear
  await query(`DELETE FROM hub_schema_mappings WHERE supplier_slug = $1`, [slug]);
  for (const m of manifest.cts_mapping.field_mappings) {
    await query(
      `INSERT INTO hub_schema_mappings(supplier_slug, field_source, field_target, transform_fn) VALUES ($1,$2,$3,$4)`,
      [slug, m.source, m.target, m.transform]
    );
  }
  steps.push({ step: 2, target: 'hub_schema_mappings', ok: true, count: manifest.cts_mapping.field_mappings.length });

  // 3. Store supplier credentials encrypted into hub_credentials_map.
  // Credentials were captured in the wizard's Auth step and travel with the manifest.
  const creds = manifest.auth?.credentials || {};
  const hasAnyCred = Object.values(creds).some((v) => v !== null && v !== undefined && v !== '');
  if (hasAnyCred) {
    try {
      await setSecret(tenantId, slug, creds);
      steps.push({ step: 3, target: 'hub_credentials_map', ok: true, encrypted: true });
    } catch (e) {
      log('warn', 'credentials_store_failed', { slug, error: e.message });
      steps.push({ step: 3, target: 'hub_credentials_map', ok: false, error: e.message });
    }
  } else {
    log('warn', 'no_credentials_in_manifest', { slug });
    steps.push({ step: 3, target: 'hub_credentials_map', ok: false, reason: 'no credentials provided' });
  }

  // 4. hub_tool_contracts
  for (const [op, def] of Object.entries(manifest.operations)) {
    await query(
      `INSERT INTO hub_tool_contracts(tool_name, version, input_schema, output_schema, auth_scope, executor, sla_ms)
       VALUES ($1,'1.0.0',$2,$3,$4,'sync_lambda',$5)
       ON CONFLICT (tool_name) DO NOTHING`,
      [`tos.${op}.${slug}`, def.request_schema || {}, def.response_schema || {}, [tenantId],
       manifest.execution_profile?.avg_response_time_ms || 800]
    );
  }
  steps.push({ step: 4, target: 'hub_tool_contracts', ok: true });

  // 5. hub_dedup_config (SHOW_ALL safe default) — only seed once per tenant+supplier label
  {
    const exists = await query(
      `SELECT 1 FROM hub_dedup_config WHERE tenant_id = $1 AND label = $2 LIMIT 1`,
      [tenantId, `onboarding_${slug}`]
    );
    if (!exists.rows[0]) {
      await query(
        `INSERT INTO hub_dedup_config(tenant_id, config_json, label) VALUES ($1,$2,$3)`,
        [tenantId, { strategy: 'SHOW_ALL' }, `onboarding_${slug}`]
      );
    }
  }
  steps.push({ step: 5, target: 'hub_dedup_config', ok: true });

  // 6. hub_integration_tests — only seed once per supplier+tenant
  {
    const exists = await query(
      `SELECT 1 FROM hub_integration_tests WHERE supplier_slug = $1 AND tenant_id = $2 LIMIT 1`,
      [slug, tenantId]
    );
    if (!exists.rows[0]) {
      await query(
        `INSERT INTO hub_integration_tests(supplier_slug, tenant_id, search_params, expected_min_count, test_booking_ref)
         VALUES ($1,$2,$3,$4,$5)`,
        [slug, tenantId, manifest.test_suite.sandbox_search_params,
         manifest.test_suite.expected_result_count_min || 1, manifest.test_suite.test_booking_ref]
      );
    }
  }
  steps.push({ step: 6, target: 'hub_integration_tests', ok: true });

  // 7. hub_tenant_suppliers — upsert by (tenant_id, supplier_slug)
  await query(
    `INSERT INTO hub_tenant_suppliers(tenant_id, supplier_slug, sla_tier, preferred_for_cats, is_active)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (tenant_id, supplier_slug) DO UPDATE SET
       sla_tier = EXCLUDED.sla_tier,
       preferred_for_cats = EXCLUDED.preferred_for_cats,
       is_active = true`,
    [tenantId, slug, manifest.tenant_config.sla_tier,
     manifest.tenant_config.preferred_for_categories || []]
  );
  steps.push({ step: 7, target: 'hub_tenant_suppliers', ok: true });

  // 8. Send completion email
  await sendEmail({
    to: manifest.supplier.support_contact || 'ops@tos.dev',
    subject: `Integration provisioned: ${slug}`,
    text: `Supplier ${slug} is now live for tenant ${tenantId}.`,
  });
  steps.push({ step: 8, target: 'notify', ok: true });

  // 9. Structured log
  log('info', 'NEW_INTEGRATION_PROVISIONED', { tenant_id: tenantId, supplier_slug: slug });
  steps.push({ step: 9, target: 'stdout_log', ok: true });

  // 10. Knowledge generation (async — don't block promotion if it fails).
  (async () => {
    try {
      const { generateVendorKnowledge } = await import('../knowledge/knowledge-generator.js');
      const { recordEvent, distilCategoryPatterns } = await import('../knowledge/knowledge-learner.js');
      const sample = manifest.test_suite?.last_probe_sample || null;
      const validationReport = manifest.test_suite?.last_validation_report || null;
      const result = await generateVendorKnowledge({ manifest, sample, validationReport });
      log('info', 'vendor_knowledge_generated', { slug, ok: result?.ok });
      await recordEvent({
        supplierSlug: slug, tenantId,
        eventType: 'integration_complete',
        payload: { manifest_summary: { auth: manifest.auth?.type, category: manifest.cts_mapping?.type_value } },
      });
      const cat = manifest.cts_mapping?.type_value;
      if (cat) await distilCategoryPatterns(cat).catch(() => null);
    } catch (e) {
      log('warn', 'vendor_knowledge_generation_failed', { slug, error: e.message });
    }
  })();

  // 11. Auto-trigger initial inventory sync (background — don't block promotion).
  (async () => {
    try {
      const creds = manifest.auth?.credentials || {};
      const syncRunners = {
        'hotelbeds-hotels': () => import('../sync/hotelbeds-hotels.js').then(m => m.syncHotelbedsHotels({ apiKey: creds.api_key, secretKey: creds.secret_key, env: 'sandbox' })),
        'hotelbeds-activities': () => import('../sync/hotelbeds-experiences.js').then(m => m.syncHotelbedsExperiences({ apiKey: creds.api_key, secretKey: creds.secret_key, env: 'sandbox' })),
        'hotelbeds-transfers': () => import('../sync/hotelbeds-transfers.js').then(m => m.syncHotelbedsTransfers({ apiKey: creds.api_key, secretKey: creds.secret_key, env: 'sandbox' })),
        viator: () => import('../sync/viator-experiences.js').then(m => m.syncViatorExperiences({ apiKey: creds.api_key, env: 'sandbox', supplierSlug: 'viator' })),
        'viator-direct': () => import('../sync/viator-experiences.js').then(m => m.syncViatorExperiences({ apiKey: creds.api_key, env: 'sandbox', supplierSlug: 'viator-direct' })),
        ticketmaster: () => import('../sync/ticketmaster-events.js').then(m => m.syncTicketmasterEvents({ apiKey: creds[Object.keys(creds).find(k => creds[k]) || 'api_key'], supplierSlug: 'ticketmaster' })),
        duffel: () => import('../sync/duffel-flights.js').then(m => m.syncDuffelFlights({ accessToken: creds[Object.keys(creds).find(k => creds[k]) || 'access_token'], supplierSlug: 'duffel' })),
      };
      const runner = syncRunners[slug];
      if (runner) {
        log('info', 'auto_sync_starting', { slug, tenant_id: tenantId });
        const result = await runner();
        log('info', 'auto_sync_complete', { slug, tenant_id: tenantId, result });
      } else {
        log('info', 'auto_sync_skipped', { slug, reason: 'no sync runner registered for this supplier' });
      }
    } catch (e) {
      log('warn', 'auto_sync_failed', { slug, error: e.message });
    }
  })();

  return { ok: true, steps };
};
