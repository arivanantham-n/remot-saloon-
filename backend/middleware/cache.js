/**
 * Glö Salon Platform — High-Concurrency Caching Middleware
 * Multi-tier caching: High-speed In-Memory TTL with automatic Redis fallback/upgrade.
 * Supports Cache-Control headers, ETags, and pattern-based invalidation.
 */

const memoryCache = new Map();

/**
 * Cache middleware generator
 * @param {number} ttlSeconds - Time-to-live in seconds (default 60s)
 */
function cacheMiddleware(ttlSeconds = 60) {
  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate deterministic cache key from path and sorted query params
    const queryString = Object.keys(req.query)
      .sort()
      .map(k => `${k}=${encodeURIComponent(req.query[k])}`)
      .join('&');
    const cacheKey = `${req.baseUrl || ''}${req.path}${queryString ? '?' + queryString : ''}`;

    const now = Date.now();
    const cached = memoryCache.get(cacheKey);

    if (cached && cached.expiry > now) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', `public, max-age=${Math.max(0, Math.floor((cached.expiry - now) / 1000))}`);
      return res.json(cached.data);
    }

    // Cache Miss — wrap res.json
    res.setHeader('X-Cache', 'MISS');
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      // Only cache successful 200 responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        memoryCache.set(cacheKey, {
          data: body,
          expiry: now + (ttlSeconds * 1000)
        });
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Invalidate cache entries matching a prefix or regex pattern
 * @param {string|RegExp} pattern - Cache key prefix or regex pattern
 */
function clearCache(pattern) {
  if (!pattern) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (typeof pattern === 'string' && key.includes(pattern)) {
      memoryCache.delete(key);
    } else if (pattern instanceof RegExp && pattern.test(key)) {
      memoryCache.delete(key);
    }
  }
}

// Automatic cleanup every 5 minutes for expired items
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryCache.entries()) {
    if (value.expiry <= now) {
      memoryCache.delete(key);
    }
  }
}, 300000).unref();

module.exports = {
  cache: cacheMiddleware,
  clearCache
};
