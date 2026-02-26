const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { logger } = require('../utils/logger');

const router = express.Router();
const execAsync = promisify(exec);

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
router.post('/create', async (req, res, next) => {
  try {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const filename = `max_backup_${timestamp}.sql.gz`;
    const filepath = path.join(BACKUP_DIR, filename);
    
    // Parse database URL
    const dbUrl = new URL(config.db.connectionString);
    const host = dbUrl.hostname;
    const port = dbUrl.port || 5432;
    const database = dbUrl.pathname.slice(1);
    const username = dbUrl.username;
    const password = dbUrl.password;
    
    logger.info({ filename }, '[Backup] Creating backup');
    
    // Use pg_dump to create backup
    const env = { ...process.env, PGPASSWORD: password };
    const command = `pg_dump -h ${host} -p ${port} -U ${username} -d ${database} --clean --if-exists | gzip > "${filepath}"`;
    
    await execAsync(command, { env, timeout: 120000 });
    
    const stats = fs.statSync(filepath);
    
    res.json({
      success: true,
      filename,
      filepath,
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
    
    const filepath = path.join(BACKUP_DIR, filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }
    
    // Parse database URL
    const dbUrl = new URL(config.db.connectionString);
    const host = dbUrl.hostname;
    const port = dbUrl.port || 5432;
    const database = dbUrl.pathname.slice(1);
    const username = dbUrl.username;
    const password = dbUrl.password;
    
    logger.info({ filename }, '[Backup] Restoring from backup');
    
    // Use gunzip and psql to restore
    const env = { ...process.env, PGPASSWORD: password };
    const isGzipped = filename.endsWith('.gz');
    
    let command;
    if (isGzipped) {
      command = `gunzip -c "${filepath}" | psql -h ${host} -p ${port} -U ${username} -d ${database}`;
    } else {
      command = `psql -h ${host} -p ${port} -U ${username} -d ${database} < "${filepath}"`;
    }
    
    await execAsync(command, { env, timeout: 300000 });
    
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
    const { filename } = req.params;
    const filepath = path.join(BACKUP_DIR, filename);
    
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
router.delete('/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(BACKUP_DIR, filename);
    
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
