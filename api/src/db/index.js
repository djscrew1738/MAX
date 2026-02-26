const { Pool } = require('pg');
const config = require('../config');
const { logger } = require('../utils/logger');

/**
 * Database connection with retry logic and health checking
 */

let pool;

/**
 * Create database pool
 */
function createPool() {
  pool = new Pool({
    connectionString: config.db.connectionString,
    max: config.db.maxConnections,
    connectionTimeoutMillis: config.db.connectionTimeout,
  });

  pool.on('error', (err) => {
    logger.error({ err }, '[DB] Unexpected error on idle client');
  });

  pool.on('connect', () => {
    logger.debug('[DB] New client connected');
  });

  return pool;
}

/**
 * Connect to database with exponential backoff retry
 */
async function connectWithRetry(retries = config.db.retryAttempts, delay = config.db.retryDelay) {
  const maxRetries = retries;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (!pool) {
        createPool();
      }
      
      // Test connection
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      
      logger.info(`[DB] Connected successfully (attempt ${i + 1}/${maxRetries})`);
      return pool;
    } catch (err) {
      const isLastAttempt = i === maxRetries - 1;
      const nextDelay = delay * Math.pow(2, i);
      
      logger.warn({
        attempt: i + 1,
        maxRetries,
        nextDelay,
        error: err.message,
        isLastAttempt,
      }, '[DB] Connection attempt failed');
      
      if (isLastAttempt) {
        logger.error({ err }, '[DB] Max retries exceeded, giving up');
        throw err;
      }
      
      logger.info(`[DB] Retrying in ${nextDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, nextDelay));
    }
  }
}

/**
 * Simple query helper
 */
function query(text, params) {
  if (!pool) {
    throw new Error('Database not connected');
  }
  return pool.query(text, params);
}

/**
 * Transaction helper
 */
async function transaction(callback) {
  if (!pool) {
    throw new Error('Database not connected');
  }
  
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
}

/**
 * Health check
 */
async function healthCheck() {
  if (!pool) {
    return false;
  }
  
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const latency = Date.now() - start;
    return { healthy: true, latency };
  } catch (err) {
    logger.error({ err }, '[DB] Health check failed');
    return { healthy: false, error: err.message };
  }
}

/**
 * Close pool gracefully
 */
async function close() {
  if (pool) {
    await pool.end();
    logger.info('[DB] Pool closed');
  }
}

module.exports = {
  connectWithRetry,
  query,
  transaction,
  healthCheck,
  close,
  get pool() { return pool; },
};
