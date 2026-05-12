import 'dotenv/config';
import { query, closePool } from '../src/db/client.js';
import { createMagicLinkToken } from '../src/auth/magic-link.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/get_login_link.js <email>');
  process.exit(1);
}

const run = async () => {
  const r = await query(`SELECT tenant_id FROM hub_tenants WHERE email = $1`, [email]);
  if (!r.rows[0]) {
    console.error(`No tenant with email "${email}". Existing:`);
    const all = await query(`SELECT tenant_id, email FROM hub_tenants WHERE email IS NOT NULL`);
    all.rows.forEach(t => console.error(`  ${t.tenant_id} — ${t.email}`));
    process.exit(1);
  }
  const { token, expires_at } = await createMagicLinkToken(r.rows[0].tenant_id);
  const appUrl = process.env.DASHBOARD_APP_URL || 'http://localhost:5173';
  console.log('');
  console.log('  Tenant:    ', r.rows[0].tenant_id);
  console.log('  Expires:   ', expires_at.toISOString());
  console.log('');
  console.log('  Login URL: ', `${appUrl}/verify/${token}`);
  console.log('');
};

run().then(() => closePool()).then(() => process.exit(0))
  .catch(e => { console.error(e.message); process.exit(1); });
