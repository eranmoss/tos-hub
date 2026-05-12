import bcrypt from 'bcrypt';
import { query } from '../db/client.js';

export const apiKeyAuth = async (req, res, next) => {
  const key = req.header('X-Api-Key');
  if (!key) return res.status(401).json({ error: 'missing X-Api-Key' });
  const rows = (await query('SELECT * FROM hub_tenants')).rows;
  for (const t of rows) {
    if (await bcrypt.compare(key, t.api_key_hash)) {
      req.tenant = t;
      return next();
    }
  }
  return res.status(401).json({ error: 'invalid api key' });
};

export const internalAuth = (req, res, next) => {
  const token = req.header('X-Internal-Token');
  if (token !== process.env.INTERNAL_TOKEN) {
    return res.status(401).json({ error: 'invalid internal token' });
  }
  next();
};

export const adminAuth = (req, res, next) => {
  const key = req.header('X-Admin-Key');
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'invalid admin key' });
  }
  next();
};
