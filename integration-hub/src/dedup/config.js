import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '../../config/dedup.default.json');

let DEFAULT_CONFIG = null;
const getDefault = () => {
  if (!DEFAULT_CONFIG) {
    DEFAULT_CONFIG = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf-8'));
  }
  return DEFAULT_CONFIG;
};

const deepMerge = (base, override) => {
  if (override === null || override === undefined) return base;
  if (typeof base !== 'object' || typeof override !== 'object' ||
      Array.isArray(base) || Array.isArray(override)) return override;
  const out = { ...base };
  for (const k of Object.keys(override)) {
    out[k] = deepMerge(base[k], override[k]);
  }
  return out;
};

export const loadDedupConfig = async (tenantId) => {
  const base = getDefault();
  if (!tenantId) return base;
  try {
    const res = await query(
      `SELECT config_json, test_mode FROM hub_dedup_config
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId]
    );
    if (res.rows[0]) {
      const merged = deepMerge(base, res.rows[0].config_json || {});
      merged.test_mode = res.rows[0].test_mode ?? merged.test_mode;
      return merged;
    }
  } catch {}
  return base;
};
