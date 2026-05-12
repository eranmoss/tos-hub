import jwt from 'jsonwebtoken';

const JWT_ALGO = 'HS256';
const JWT_EXPIRES_IN = '7d';

const getSecret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  return s;
};

export const signDashboardJwt = ({ user_id, user_name, tenant_id, tenant_name, tier, email, role }) =>
  jwt.sign(
    { user_id, user_name, tenant_id, tenant_name, tier, email, role: role || 'admin' },
    getSecret(),
    { algorithm: JWT_ALGO, expiresIn: JWT_EXPIRES_IN }
  );

export const verifyDashboardJwt = (token) =>
  jwt.verify(token, getSecret(), { algorithms: [JWT_ALGO] });
