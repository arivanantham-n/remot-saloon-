const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  let token = null;

  // 1. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Check hardened HttpOnly Cookies (Defense-in-depth against XSS token theft)
  if (!token && req.cookies) {
    token = req.cookies['__Host-glo_token'] || req.cookies['glo_token'] || req.cookies['glo_access'];
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'glo_secret');
    const user = await User.findById(decoded.id).select('-otp -otpExpiry -mfaSecretEncrypted');
    
    if (!user) {
      return res.status(401).json({ error: 'User session invalid or user not found.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }
};
