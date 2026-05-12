-- Dedupe hub_tenant_suppliers, then add uniqueness constraint.

DELETE FROM hub_tenant_suppliers
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY tenant_id, supplier_slug
             ORDER BY activated_at DESC, id DESC
           ) AS rn
    FROM hub_tenant_suppliers
  ) t
  WHERE t.rn > 1
);

ALTER TABLE hub_tenant_suppliers
  ADD CONSTRAINT hub_tenant_suppliers_tenant_supplier_uniq
  UNIQUE (tenant_id, supplier_slug);
