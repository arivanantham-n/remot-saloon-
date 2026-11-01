require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const hpp = require('hpp');
const sanitizeMiddleware = require('./middleware/sanitize');

const app = express();

// ─── Reverse Proxy & IP Trust ──────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── HTTP Security Headers (Helmet Suite + CSP Level 3) ────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://checkout.razorpay.com"
      ],
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://checkout.razorpay.com"
      ],
      scriptSrcAttr: [
        "'unsafe-inline'" // Crucial for button onclick, oninput, onchange event handlers
      ],
      frameSrc: [
        "'self'",
        "https://api.razorpay.com",
        "https://checkout.razorpay.com"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com"
      ],
      styleSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com"
      ],
      styleSrcAttr: [
        "'unsafe-inline'"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "data:"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https://images.unsplash.com",
        "https://res.cloudinary.com",
        "https://cdn-icons-png.flaticon.com"
      ],
      connectSrc: [
        "'self'",
        "https://api.razorpay.com",
        "http://localhost:*",
        "http://127.0.0.1:*"
      ],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true
  } : false,
  frameguard: { action: 'sameorigin' },
  noSniff: true
}));

// ─── High-Performance Compression (Gzip / Deflate) ─────────────────────────────
app.use(compression({
  threshold: 1024,
  level: 6,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// ─── Rate Limiting (DDoS & Abuse Mitigation) ───────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', globalLimiter);

// Sensitive endpoints limiter (OTP / Login)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' }
});
app.use('/api/auth/send-otp', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);

// ─── Hardened CORS & Parsers ───────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5000,http://127.0.0.1:5000').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS Security Policy'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'X-Requested-With']
}));

app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(hpp());
app.use(sanitizeMiddleware);

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/profile',  require('./routes/profile'));
app.use('/api/services', require('./routes/services'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/salons',   require('./routes/salons'));
app.use('/api/reviews',  require('./routes/reviews'));
app.use('/api/payments', require('./routes/payments'));

// Admin stats endpoint
app.get('/api/admin/stats', require('./middleware/adminAuth'), async (req, res) => {
  try {
    const Booking = require('./models/Booking');
    const Salon   = require('./models/Salon');
    const User    = require('./models/User');
    const Review  = require('./models/Review');

    const [totalBookings, pendingSalons, totalUsers, avgRating] = await Promise.all([
      Booking.countDocuments(),
      Salon.countDocuments({ status: 'pending' }),
      User.countDocuments(),
      Review.aggregate([{ $group: { _id: null, avg: { $avg: '$rating' } } }])
    ]);

    const revenueAgg = await Booking.aggregate([
      { $match: { status: { $in: ['confirmed', 'completed'] } } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ]);

    res.json({
      totalBookings,
      pendingSalons,
      totalUsers,
      avgRating: avgRating[0]?.avg?.toFixed(1) || '0.0',
      totalRevenue: revenueAgg[0]?.total || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.status(dbState === 'connected' ? 200 : 503).json({
    status: 'ok',
    database: dbState,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    service: 'Glö Salon Enterprise API v1.0',
    security: {
      fieldEncryption: 'AES-256-GCM',
      csp: 'Enforced',
      hsts: process.env.NODE_ENV === 'production' ? 'Enabled' : 'Dev-Mode',
      mfaSupport: 'Active'
    }
  });
});

// ─── Static Frontend Serving with Browser Caching ─────────────────────────────
const staticOptions = {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(jpg|jpeg|png|webp|svg|gif|ico|woff2|woff|ttf)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    } else if (/\.(css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
};

app.use(express.static(path.join(__dirname, '../frontend'), staticOptions));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const file = req.path.endsWith('.html') ? req.path : 'index.html';
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, '../frontend', file));
});

// ─── MongoDB Connection with Connection Pooling ────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/glo-salon';

const mongooseOptions = {
  maxPoolSize: 100,
  minPoolSize: 10,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 5000,
  family: 4
};

async function autoSeedIfEmpty() {
  const Service = require('./models/Service');
  const count = await Service.countDocuments();
  if (count === 0) {
    console.log('🌱 Database empty, auto-seeding initial service & salon data...');
    const { seedData } = require('./seed');
    await seedData();
  }
}

let activeServer = null;

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI, mongooseOptions);
    console.log('✅ Connected to MongoDB with Connection Pool (maxPool: 100):', MONGODB_URI);
  } catch (err) {
    console.warn('⚠️  Local MongoDB connection failed (', err.message, '). Falling back to MongoDB In-Memory Server...');
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongoServer = await MongoMemoryServer.create();
      const mongoUri = mongoServer.getUri();
      await mongoose.connect(mongoUri, { maxPoolSize: 100, minPoolSize: 10 });
      console.log('✅ Connected to MongoMemoryServer at:', mongoUri);
    } catch (memErr) {
      console.error('❌ Failed to start MongoMemoryServer:', memErr.message);
      process.exit(1);
    }
  }

  await autoSeedIfEmpty();

  const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 5000;

  function listenWithFallback(portAttempt) {
    const server = app.listen(portAttempt, () => {
      console.log(`\n🚀 Glö Salon App & API running at: http://localhost:${portAttempt}`);
      console.log(`📋 Admin Dashboard: http://localhost:${portAttempt}/admin.html`);
      console.log(`🔒 Enterprise Security: AES-256-GCM, Helmet CSP, HttpOnly Cookies, MFA\n`);
    });

    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    activeServer = server;

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`⚠️  Port ${portAttempt} is already in use. Retrying on port ${portAttempt + 1}...`);
        listenWithFallback(portAttempt + 1);
      } else {
        console.error('❌ Server startup error:', err);
      }
    });
  }

  listenWithFallback(DEFAULT_PORT);
}

function handleGracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  if (activeServer) {
    activeServer.close(async () => {
      console.log('🔒 HTTP server closed to new connections.');
      try {
        await mongoose.connection.close(false);
        console.log('💾 MongoDB connection pool drained cleanly.');
      } catch (e) {
        console.error('Error closing MongoDB pool:', e);
      }
      process.exit(0);
    });

    setTimeout(() => {
      console.error('⚠️  Forceful shutdown initiated after timeout.');
      process.exit(1);
    }, 10000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

startServer();

module.exports = app;
