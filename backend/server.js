// ============================================
//  EventBook API — Main Server Entry Point
//  Path: event-booking/backend/server.js
// ============================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { connectDB, mongoose } = require('./config/db');
const { loadRuntimeSecrets } = require('./config/secrets');

// ---------- App Init ----------
const app = express();
app.set('trust proxy', 1); // Behind Nginx / ELB

// ---------- Security Middleware ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https:', 'http://localhost:5000', 'http://127.0.0.1:5000'],
      upgradeInsecureRequests: null
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// ---------- CORS ----------
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5500')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (Postman, mobile apps, curl)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return cb(null, true);
    }
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true
}));

// ---------- Body Parser ----------
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ---------- Logger (only in dev) ----------
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ---------- Global Rate Limiter ----------
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'Too many requests. Please try again later.' }
});
app.use('/api', globalLimiter);

// ---------- Stricter limiter for auth routes ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { msg: 'Too many auth attempts. Try again in 15 minutes.' }
});

// ---------- Health Check ----------
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: '🎫 EventBook API',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});

// ---------- Routes ----------
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/admin', require('./routes/admin'));

// ---------- 404 Handler ----------
app.use((req, res) => {
  res.status(404).json({ msg: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ---------- Global Error Handler ----------
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  if (err.message && err.message.startsWith('CORS')) {
    return res.status(403).json({ msg: err.message });
  }
  res.status(err.status || 500).json({
    msg: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 5000;
let server;

async function start() {
  await loadRuntimeSecrets();
  await connectDB();
  server = app.listen(PORT, () => {
    console.log(`EventBook API listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
  return server;
}

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down EventBook API...`);
  if (server) {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
  await mongoose.connection.close();
}

if (require.main === module) {
  start().catch(error => {
    console.error('EventBook startup failed:', error);
    mongoose.disconnect().finally(() => {
      process.exitCode = 1;
    });
  });

  process.on('SIGTERM', () => shutdown('SIGTERM').catch(error => {
    console.error('Shutdown failed:', error);
    process.exitCode = 1;
  }));
  process.on('SIGINT', () => shutdown('SIGINT').catch(error => {
    console.error('Shutdown failed:', error);
    process.exitCode = 1;
  }));
  process.on('unhandledRejection', error => {
    console.error('Unhandled rejection:', error);
    if (server) server.close(() => { process.exitCode = 1; });
    else process.exitCode = 1;
  });
}

module.exports = app;