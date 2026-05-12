import { randomBytes, createHash } from 'crypto';
import { query } from '../db/client.js';

const TOKEN_TTL_MINUTES = 15;

export const hashToken = (token) =>
  createHash('sha256').update(token).digest('hex');

export const createMagicLinkToken = async (tenant_id, user_id) => {
  const token = randomBytes(32).toString('hex');
  const token_hash = hashToken(token);
  const expires_at = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);
  await query(
    `INSERT INTO hub_auth_tokens(token_hash, tenant_id, user_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token_hash, tenant_id, user_id, expires_at]
  );
  return { token, expires_at };
};

export const consumeMagicLinkToken = async (token) => {
  const token_hash = hashToken(token);
  const r = await query(
    `SELECT at.id, at.tenant_id, at.used, at.expires_at, at.user_id,
            t.name AS tenant_name, t.tier,
            u.email, u.name AS user_name, u.role
       FROM hub_auth_tokens at
       JOIN hub_tenants t ON t.tenant_id = at.tenant_id
       LEFT JOIN hub_users u ON u.id = at.user_id
      WHERE at.token_hash = $1`,
    [token_hash]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used) return { ok: false, reason: 'already_used' };
  if (new Date(row.expires_at).getTime() < Date.now())
    return { ok: false, reason: 'expired' };
  await query(`UPDATE hub_auth_tokens SET used = true WHERE id = $1`, [row.id]);
  return {
    ok: true,
    tenant: {
      user_id: row.user_id,
      user_name: row.user_name,
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      tier: row.tier,
      email: row.email,
      role: row.role || 'admin',
    },
  };
};

export const sendMagicLinkEmail = async ({ email, token, appBaseUrl }) => {
  const link = `${appBaseUrl.replace(/\/$/, '')}/verify/${token}`;
  if (process.env.NODE_ENV === 'test' || !process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.startsWith('test_')) {
    // Log-only mode: avoid any external calls during tests/local.
    console.log(JSON.stringify({ level: 'info', event: 'magic_link_email', email, link }));
    return { delivered: 'logged', link };
  }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.RESEND_FROM || 'TOS <no-reply@tos.local>',
    to: email,
    subject: 'Your TOS Partner Portal sign-in link',
    html: `<p>Click to sign in:</p><p><a href="${link}">${link}</a></p><p>Expires in 15 minutes.</p>`,
  });
  return { delivered: 'sent', link };
};
