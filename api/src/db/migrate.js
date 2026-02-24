const fs = require('fs');
const path = require('path');
const db = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Get list of applied migrations from database
 */
async function getAppliedMigrations() {
  try {
    // Create migrations table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    const { rows } = await db.query('SELECT filename FROM schema_migrations ORDER BY id');
    return new Set(rows.map(r => r.filename));
  } catch (err) {
    console.error('[Migrate] Error getting applied migrations:', err);
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
async function applyMigration(filename) {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf8');
  
  console.log(`[Migrate] Applying: ${filename}`);
  
  try {
    await db.query('BEGIN');
    await db.query(sql);
    await db.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename]
    );
    await db.query('COMMIT');
    console.log(`[Migrate] ✅ Applied: ${filename}`);
    return true;
  } catch (err) {
    await db.query('ROLLBACK');
    console.error(`[Migrate] ❌ Failed: ${filename}`, err.message);
    return false;
  }
}

/**
 * Run all pending migrations
 */
async function migrate() {
  console.log('[Migrate] Checking for pending migrations...');
  
  const applied = await getAppliedMigrations();
  const files = getMigrationFiles();
  const pending = files.filter(f => !applied.has(f));
  
  if (pending.length === 0) {
    console.log('[Migrate] No pending migrations');
    return { applied: 0, failed: 0 };
  }
  
  console.log(`[Migrate] Found ${pending.length} pending migration(s)`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const file of pending) {
    const success = await applyMigration(file);
    if (success) successCount++;
    else failCount++;
  }
  
  console.log(`[Migrate] Complete: ${successCount} applied, ${failCount} failed`);
  return { applied: successCount, failed: failCount };
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
  console.log(`[Migrate] Created: ${filepath}`);
  return filepath;
}

/**
 * Get migration status
 */
async function status() {
  const applied = await getAppliedMigrations();
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
}

// CLI support
if (require.main === module) {
  const command = process.argv[2];
  
  (async () => {
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
    process.exit(0);
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { migrate, status, createMigration };
