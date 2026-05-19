-- 019: Add is_active to hub_component_registry for soft-delete in the Component Editor
ALTER TABLE hub_component_registry ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
