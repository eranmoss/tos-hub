-- 018: Add template_html and has_data_fetch to hub_component_registry for the UI component editor
ALTER TABLE hub_component_registry ADD COLUMN IF NOT EXISTS template_html TEXT;
ALTER TABLE hub_component_registry ADD COLUMN IF NOT EXISTS has_data_fetch BOOLEAN DEFAULT false;
