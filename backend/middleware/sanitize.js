/**
 * Security Sanitization Middleware
 * 1. Strips dangerous NoSQL query operators ($gt, $ne, $where, etc.)
 * 2. Neutralizes script tags and malformed input from body, query, and params
 */

function sanitizePayload(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizePayload(item));
  }

  const cleanObj = {};
  for (const [key, value] of Object.entries(obj)) {
    // Strip keys starting with $ or containing . (MongoDB operator/path injection)
    if (key.startsWith('$') || key.includes('.')) {
      continue;
    }

    if (typeof value === 'string') {
      // Clean high-risk XSS tags
      cleanObj[key] = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim();
    } else if (typeof value === 'object' && value !== null) {
      cleanObj[key] = sanitizePayload(value);
    } else {
      cleanObj[key] = value;
    }
  }

  return cleanObj;
}

module.exports = (req, res, next) => {
  if (req.body)  req.body = sanitizePayload(req.body);
  if (req.query) req.query = sanitizePayload(req.query);
  if (req.params) req.params = sanitizePayload(req.params);
  next();
};
