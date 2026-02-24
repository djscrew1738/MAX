const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.db.connectionString,
  max: config.db.maxConnections,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  // Silently connect
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err);
});

// Connection health check
async function healthCheck() {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    return { ok: true, responseTime: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Simple query helper
const query = (text, params) => pool.query(text, params);

// Transaction helper
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Run migrations on startup
async function runMigrations() {
  try {
    const { migrate } = require('./migrate');
    const result = await migrate();
    return result;
  } catch (err) {
    console.error('[DB] Migration error:', err.message);
    return { applied: 0, failed: 0, error: err.message };
  }
}

// Get pool stats
function getStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

module.exports = { 
  pool, 
  query, 
  transaction,
  healthCheck,
  runMigrations,
  getStats,
};
