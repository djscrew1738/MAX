const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { logger } = require('../utils/logger');

const router = express.Router();

const BACKUP_DIR = path.join(process.cwd(), '..', 'backups');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Validate a user-supplied backup filename and return the resolved safe path.
 * Throws a 400 error if the filename is invalid or escapes BACKUP_DIR.
 */
function safeBackupPath(filename) {
  if (!/^[\w\-\.]+\.sql(\.gz)?$/.test(filename)) {
    const err = new Error('Invalid filename');
    err.status = 400;
    throw err;
  }
  const resolved = path.resolve(BACKUP_DIR, filename);
  if (!resolved.startsWith(path.resolve(BACKUP_DIR) + path.sep)) {
    const err = new Error('Invalid filename');
    err.status = 400;
    throw err;
  }
  return resolved;
}

/**
 * Run pg_dump → gzip → file using stdio piping (no shell, no injection risk).
 * Returns a Promise that resolves on success or rejects on error.
 */
function runBackup(args, env, filepath) {
  return new Promise((resolve, reject) => {
    const dump = spawn('pg_dump', args, { env });
    const gzip = spawn('gzip');
    const out = fs.createWriteStream(filepath);

    dump.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(out);

    const errors = [];
    dump.stderr.on('data', (d) => errors.push(`pg_dump: ${d}`));
    gzip.stderr.on('data', (d) => errors.push(`gzip: ${d}`));

    dump.on('error', reject);
    gzip.on('error', reject);

    out.on('error', reject);
    out.on('finish', () => {
      if (dump.exitCode !== null && dump.exitCode !== 0) {
        return reject(new Error(`pg_dump exited ${dump.exitCode}: ${errors.join(' ')}`));
      }
      resolve();
    });

    dump.on('close', (code) => {
      if (code !== 0) {
        gzip.stdin.end();
      }
    });
  });
}

/**
 * Run gunzip | psql restore using stdio piping (no shell).
 * Returns a Promise that resolves on success or rejects on error.
 */
function runRestore(psqlArgs, env, filepath, isGzipped) {
  return new Promise((resolve, reject) => {
    const psql = spawn('psql', psqlArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    const errors = [];
    psql.stderr.on('data', (d) => errors.push(d.toString()));
    psql.on('error', reject);
    psql.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`psql exited ${code}: ${errors.join(' ')}`));
      }
      resolve();
    });

    if (isGzipped) {
      const gunzip = spawn('gunzip', ['-c', filepath]);
      gunzip.stdout.pipe(psql.stdin);
      gunzip.on('error', reject);
      gunzip.on('close', (code) => {
        if (code !== 0) reject(new Error(`gunzip exited ${code}`));
      });
    } else {
      fs.createReadStream(filepath).pipe(psql.stdin);
    }
  });
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
router.post('/create', async (req, res, next) => {
  try {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const filename = `max_backup_${timestamp}.sql.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    // Parse database URL
    const dbUrl = new URL(config.db.connectionString);
    const host = dbUrl.hostname;
    const port = dbUrl.port || '5432';
    const database = dbUrl.pathname.slice(1);
    const username = dbUrl.username;
    const password = dbUrl.password;

    logger.info({ filename }, '[Backup] Creating backup');

    const env = { ...process.env, PGPASSWORD: password };
    const pgdumpArgs = [
      '-h', host, '-p', String(port),
      '-U', username, '-d', database,
      '--clean', '--if-exists',
    ];

    await runBackup(pgdumpArgs, env, filepath);

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
router.post('/restore', async (req, res, next) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    const filepath = safeBackupPath(filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    // Parse database URL
    const dbUrl = new URL(config.db.connectionString);
    const host = dbUrl.hostname;
    const port = dbUrl.port || '5432';
    const database = dbUrl.pathname.slice(1);
    const username = dbUrl.username;
    const password = dbUrl.password;

    logger.info({ filename }, '[Backup] Restoring from backup');

    const env = { ...process.env, PGPASSWORD: password };
    const isGzipped = filename.endsWith('.gz');
    const psqlArgs = ['-h', host, '-p', String(port), '-U', username, '-d', database];

    await runRestore(psqlArgs, env, filepath, isGzipped);

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
router.get('/download/:filename', async (req, res, next) => {
  try {
    const filepath = safeBackupPath(req.params.filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    res.download(filepath);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

/**
 * DELETE /api/backup/:filename - Delete a backup
 */
router.delete('/:filename', async (req, res, next) => {
  try {
    const filepath = safeBackupPath(req.params.filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    fs.unlinkSync(filepath);

    res.json({
      success: true,
      message: 'Backup deleted',
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

/**
 * POST /api/backup/cleanup - Remove old backups (keep last N)
 * Body: { keep: 10 }
 */
router.post('/cleanup', async (req, res, next) => {
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
