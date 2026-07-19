const { Pool } = require('pg');
require('dotenv').config();

let pool;

if (process.env.DATABASE_URL) {
  // Use Neon connection string - strip query params since we set SSL via pool options
  const cleanUrl = process.env.DATABASE_URL.split('?')[0];
  pool = new Pool({
    connectionString: cleanUrl,
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  console.log('[DB] Using Neon PostgreSQL (cloud)');
} else {
  // Fallback to local PostgreSQL
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'synerion_admin',
    password: process.env.DB_PASSWORD || 'Synerion@Bank2026!',
    database: process.env.DB_NAME || 'synerion_bank',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  console.log('[DB] Using local PostgreSQL');
}

pool.on('connect', () => {
  console.log('[DB] Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err);
  process.exit(-1);
});

const query = (text, params) => {
  return pool.query(text, params);
};

const getClient = () => {
  return pool.connect();
};

const testConnection = async () => {
  try {
    const result = await query('SELECT NOW()');
    console.log(`[DB] Database time: ${result.rows[0].now}`);
    return true;
  } catch (error) {
    console.error('[DB] Connection test failed:', error.message);
    return false;
  }
};

module.exports = {
  pool,
  query,
  getClient,
  testConnection,
};
