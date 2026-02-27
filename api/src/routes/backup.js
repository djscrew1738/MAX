const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { logger } = require('../utils/logger');

const router = express.Router();
const execFileAsync = promisify(execFile);

/**
 * Admin-only gate: requires MAX_ADMIN_KEY header or falls back to MAX_API_KEY
 * Backup/restore are destructive operations that warrant stricter access control.
 */
function requireAdminKey(req, res, next) {
  const provided = req.headers['x-admin-key'];
  const adminKey = config.adminKey;

  if (!adminKey) {
    // No admin key configured — fall through (admin key auth disabled)
    return next();
  }

  if (!provided) {
    return res.status(403).json({ error: 'Admin key required for this operation' });
  }

  const crypto = require('crypto');
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(adminKey);
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    logger.warn({ ip: req.ip }, '[Backup] Invalid admin key');
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  next();
}

/**
 * Resolve and validate that a filename stays within BACKUP_DIR.
 * Returns the resolved absolute path or throws if outside the directory.
 */
function safeBackupPath(filename) {
  // Filenames must be plain filenames, not paths
  if (path.basename(filename) !== filename) {
    throw Object.assign(new Error('Invalid filename'), { statusCode: 400 });
  }
  const resolved = path.resolve(BACKUP_DIR, filename);
  if (!resolved.startsWith(BACKUP_DIR + path.sep) && resolved !== BACKUP_DIR) {
    throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 });
  }
  return resolved;
}

const BACKUP_DIR = path.join(process.cwd(), '..', 'backups');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * GET /api/backup - List all backups
 */
router.get('/', async (req, res, next) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sql.gz') || f.endsWith('.sql'))
      .map(f => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          filename: f,
          size: stats.size,
          created: stats.birthtime,
          size_formatted: formatBytes(stats.size),
        };
      })
      .sort((a, b) => b.created - a.created);
    
    res.json({
      backups: files,
      count: files.length,
      backup_dir: BACKUP_DIR,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/backup/create - Create a new backup
 */
router.post('/create', requireAdminKey, async (req, res, next) => {
  try {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const filename = `max_backup_${timestamp}.sql.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    // Parse database URL
    const dbUrl = new URL(config.db.connectionString);
    const host = dbUrl.hostname;
    const port = String(dbUrl.port || 5432);
    const database = dbUrl.pathname.slice(1);
    const username = dbUrl.username;
    const password = dbUrl.password;

    logger.info({ filename }, '[Backup] Creating backup');

    // Use pg_dump piped through gzip — execFile prevents shell injection.
    // pg_dump args are passed as an array, never interpolated into a shell string.
    const env = { ...process.env, PGPASSWORD: password };
    const pgDumpArgs = [
      '-h', host,
      '-p', port,
      '-U', username,
      '-d', database,
      '--clean',
      '--if-exists',
      '--format=plain',
    ];

    const { stdout: dumpOutput } = await execFileAsync('pg_dump', pgDumpArgs, {
      env,
      timeout: 120000,
      maxBuffer: 512 * 1024 * 1024,
    });

    // Compress and write
    const zlib = require('zlib');
    const compressed = zlib.gzipSync(Buffer.from(dumpOutput));
    fs.writeFileSync(filepath, compressed);

    const stats = fs.statSync(filepath);

    res.json({
      success: true,
      filename,
      size: stats.size,
      size_formatted: formatBytes(stats.size),
      message: 'Backup created successfully',
    });
  } catch (err) {
    logger.error({ err }, '[Backup] Error creating backup');
    next(err);
  }
});

/**
 * POST /api/backup/restore - Restore from backup
 * Body: { filename: "max_backup_xxx.sql.gz" }
 */
router.post('/restore', requireAdminKey, async (req, res, next) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    let filepath;
    try {
      filepath = safeBackupPath(filename);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message });
    }

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    // Parse database URL
    const dbUrl = new URL(config.db.connectionString);
    const host = dbUrl.hostname;
    const port = String(dbUrl.port || 5432);
    const database = dbUrl.pathname.slice(1);
    const username = dbUrl.username;
    const password = dbUrl.password;

    logger.info({ filename }, '[Backup] Restoring from backup');

    const env = { ...process.env, PGPASSWORD: password };

    // Decompress if needed, then pass SQL via stdin to psql (no shell injection)
    const zlib = require('zlib');
    const rawData = fs.readFileSync(filepath);
    const sql = filename.endsWith('.gz') ? zlib.gunzipSync(rawData) : rawData;

    const psqlArgs = ['-h', host, '-p', port, '-U', username, '-d', database];
    await execFileAsync('psql', psqlArgs, {
      env,
      input: sql,
      timeout: 300000,
      maxBuffer: 512 * 1024 * 1024,
    });

    res.json({
      success: true,
      filename,
      message: 'Database restored successfully',
    });
  } catch (err) {
    logger.error({ err }, '[Backup] Restore error');
    next(err);
  }
});

/**
 * GET /api/backup/download/:filename - Download a backup file
 */
router.get('/download/:filename', requireAdminKey, async (req, res, next) => {
  try {
    const { filename } = req.params;
    let filepath;
    try {
      filepath = safeBackupPath(filename);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message });
    }

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    res.download(filepath);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/backup/:filename - Delete a backup
 */
router.delete('/:filename', requireAdminKey, async (req, res, next) => {
  try {
    const { filename } = req.params;
    let filepath;
    try {
      filepath = safeBackupPath(filename);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message });
    }

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    fs.unlinkSync(filepath);

    res.json({
      success: true,
      message: 'Backup deleted',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/backup/cleanup - Remove old backups (keep last N)
 * Body: { keep: 10 }
 */
router.post('/cleanup', requireAdminKey, async (req, res, next) => {
  try {
    const keep = req.body.keep || 10;
    
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sql.gz') || f.endsWith('.sql'))
      .map(f => ({
        filename: f,
        path: path.join(BACKUP_DIR, f),
        created: fs.statSync(path.join(BACKUP_DIR, f)).birthtime,
      }))
      .sort((a, b) => b.created - a.created);
    
    const toDelete = files.slice(keep);
    let deletedCount = 0;
    let freedSpace = 0;
    
    for (const file of toDelete) {
      const stats = fs.statSync(file.path);
      fs.unlinkSync(file.path);
      deletedCount++;
      freedSpace += stats.size;
    }
    
    logger.info({ deleted: deletedCount, freedSpace }, '[Backup] Cleanup complete');
    
    res.json({
      success: true,
      deleted: deletedCount,
      kept: Math.min(files.length, keep),
      freed_space: formatBytes(freedSpace),
    });
  } catch (err) {
    next(err);
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;
