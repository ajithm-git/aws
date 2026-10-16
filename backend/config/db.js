// ============================================
//  MongoDB Connection — Mongoose Config
//  Path: event-booking/backend/config/db.js
// ============================================

const mongoose = require('mongoose');
const { readSecret } = require('./secrets');

// ---------- Mongoose Global Options ----------
mongoose.set('strictQuery', true);

// ---------- Connection Options ----------
const options = {
  serverSelectionTimeoutMS: 10000,   // Fail fast if the database is unreachable
  socketTimeoutMS: 45000,            // Close idle sockets after 45s
  family: 4,                         // Force IPv4 (fixes some Windows DNS issues)
  maxPoolSize: 10,                   // Max concurrent connections
  minPoolSize: 2,                    // Keep 2 warm connections
  retryWrites: true,
  retryReads: true
};

async function getDatabaseUri() {
  if (process.env.DB_SECRET_ARN) {
    const { username, password } = await readSecret(process.env.DB_SECRET_ARN);
    const host = process.env.DOCDB_ENDPOINT;
    const database = process.env.MONGO_DATABASE || 'eventbook';
    if (!username || !password || !host) {
      throw new Error('DocumentDB credentials or endpoint are missing.');
    }
    return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:27017/${database}?authSource=admin&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&tls=true&tlsCAFile=${encodeURIComponent(process.env.DOCDB_TLS_CA_FILE || '')}`;
  }

  return process.env.MONGO_URI;
}

// ---------- Connection Function with Retry ----------
async function connectDB(retries = 5, delayMs = 3000) {
  const uri = await getDatabaseUri();
  if (!uri || uri.includes('<') || uri.includes('cluster0.abc12')) {
    throw new Error('MONGO_URI is missing or still has placeholder values.');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(uri, options);
      console.log(`✅ MongoDB Connected → ${conn.connection.host}`);
      console.log(`   Database: ${conn.connection.name}`);
      return conn;
    } catch (err) {
      console.error(`❌ DB connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) {
        throw err;
      }
      console.log(`   ⏳ Retrying in ${delayMs / 1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// ---------- Connection Event Listeners ----------
mongoose.connection.on('connected', () => {
  console.log('📡 Mongoose: connected');
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  Mongoose: disconnected. Will auto-reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('🔁 Mongoose: reconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose error:', err.message);
});

module.exports = { connectDB, mongoose };