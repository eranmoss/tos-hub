import { verifyDashboardJwt } from '../auth/jwt.js';

export const jwtAuth = (req, res, next) => {
  const header = req.header('Authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'missing Bearer token' });
  try {
    const payload = verifyDashboardJwt(m[1]);
    req.dashboardTenant = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
};
