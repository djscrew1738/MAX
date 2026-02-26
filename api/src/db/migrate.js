const fs = require('fs');
const path = require('path');
const db = require('./index');
const { logger } = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATION_LOCK_ID = 12345; // Advisory lock ID for migrations

/**
 * Get list of applied migrations from database
 */
async function getAppliedMigrations(client) {
  try {
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    const { rows } = await client.query('SELECT filename FROM schema_migrations ORDER BY id');
    return new Set(rows.map(r => r.filename));
  } catch (err) {
    logger.error({ err }, '[Migrate] Error getting applied migrations');
    return new Set();
  }
}

/**
 * Get list of migration files
 */
function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

/**
 * Apply a single migration
 */
async function applyMigration(client, filename) {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf8');
  
  logger.info(`[Migrate] Applying: ${filename}`);
  
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename]
    );
    logger.info(`[Migrate] ✅ Applied: ${filename}`);
    return true;
  } catch (err) {
    logger.error({ err, filename }, `[Migrate] ❌ Failed: ${filename}`);
    return false;
  }
}

/**
 * Acquire advisory lock for migrations
 */
async function acquireLock(client) {
  const { rows } = await client.query(
    'SELECT pg_try_advisory_lock($1) as acquired',
    [MIGRATION_LOCK_ID]
  );
  return rows[0].acquired;
}

/**
 * Release advisory lock
 */
async function releaseLock(client) {
  await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
}

/**
 * Run all pending migrations with distributed locking
 */
async function migrate() {
  logger.info('[Migrate] Checking for pending migrations...');
  
  const client = await db.pool.connect();
  
  try {
    // Try to acquire advisory lock
    const lockAcquired = await acquireLock(client);
    
    if (!lockAcquired) {
      logger.warn('[Migrate] Another migration is in progress, waiting...');
      // Wait and retry a few times
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 2000));
        if (await acquireLock(client)) {
          break;
        }
      }
      if (!await acquireLock(client)) {
        throw new Error('Could not acquire migration lock after retries');
      }
    }
    
    logger.info('[Migrate] Lock acquired');
    
    const applied = await getAppliedMigrations(client);
    const files = getMigrationFiles();
    const pending = files.filter(f => !applied.has(f));
    
    if (pending.length === 0) {
      logger.info('[Migrate] No pending migrations');
      return { applied: 0, failed: 0 };
    }
    
    logger.info(`[Migrate] Found ${pending.length} pending migration(s)`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const file of pending) {
      const success = await applyMigration(client, file);
      if (success) successCount++;
      else failCount++;
    }
    
    logger.info(`[Migrate] Complete: ${successCount} applied, ${failCount} failed`);
    return { applied: successCount, failed: failCount };
    
  } finally {
    await releaseLock(client);
    client.release();
    logger.info('[Migrate] Lock released');
  }
}

/**
 * Create a new migration file
 */
function createMigration(name) {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const filename = `${timestamp}_${name.replace(/\s+/g, '_').toLowerCase()}.sql`;
  const filepath = path.join(MIGRATIONS_DIR, filename);
  
  const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Add your SQL here

`;
  
  fs.writeFileSync(filepath, template);
  logger.info(`[Migrate] Created: ${filepath}`);
  return filepath;
}

/**
 * Get migration status
 */
async function status() {
  const client = await db.pool.connect();
  try {
    const applied = await getAppliedMigrations(client);
    const files = getMigrationFiles();
    
    return {
      total: files.length,
      applied: applied.size,
      pending: files.filter(f => !applied.has(f)),
      migrations: files.map(f => ({
        filename: f,
        status: applied.has(f) ? 'applied' : 'pending'
      }))
    };
  } finally {
    client.release();
  }
}

// CLI support
if (require.main === module) {
  const command = process.argv[2];
  
  (async () => {
    // Initialize DB connection
    await db.connectWithRetry();
    
    switch (command) {
      case 'up':
        await migrate();
        break;
      case 'status':
        const s = await status();
        console.log('\nMigration Status:');
        console.log('=================');
        console.log(`Total: ${s.total}`);
        console.log(`Applied: ${s.applied}`);
        console.log(`Pending: ${s.pending.length}`);
        if (s.pending.length > 0) {
          console.log('\nPending migrations:');
          s.pending.forEach(f => console.log(`  - ${f}`));
        }
        break;
      case 'create':
        const name = process.argv[3];
        if (!name) {
          console.error('Usage: node migrate.js create <migration_name>');
          process.exit(1);
        }
        createMigration(name);
        break;
      default:
        console.log('Usage: node migrate.js [up|status|create <name>]');
    }
    
    await db.close();
    process.exit(0);
  })().catch(err => {
    logger.error({ err }, 'Migration CLI error');
    process.exit(1);
  });
}

module.exports = { migrate, status, createMigration };
