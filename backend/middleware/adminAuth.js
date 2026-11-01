const crypto = require('crypto');
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  // 1. Check if authenticated user has admin role via JWT
  const authHeader = req.headers.authorization;
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token && req.cookies) {
    token = req.cookies['__Host-glo_token'] || req.cookies['glo_token'];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'glo_secret');
      if (decoded.role === 'admin') {
        return next();
      }
    } catch (e) {
      // Proceed to admin key check
    }
  }

  // 2. Fallback: Timing-Safe Admin Key Comparison (prevents timing side-channel attacks)
  const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
  const expected = process.env.ADMIN_PASSWORD || 'admin@glo2026';

  if (adminKey && typeof adminKey === 'string') {
    const adminKeyBuf = Buffer.from(adminKey);
    const expectedBuf = Buffer.from(expected);

    if (adminKeyBuf.length === expectedBuf.length && crypto.timingSafeEqual(adminKeyBuf, expectedBuf)) {
      return next();
    }
  }

  return res.status(403).json({ error: 'Forbidden: Invalid or missing administrator credentials' });
};
