import rateLimit from 'express-rate-limit';

export const tenantRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => req.tenant?.rate_limit_rpm || 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.tenant?.tenant_id || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'rate limit exceeded' }),
});
