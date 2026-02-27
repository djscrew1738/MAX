const { generateWeeklyDigest } = require('./digest');
const db = require('../db');
const { logger } = require('../utils/logger');

/**
 * Simple interval-based scheduler
 * Runs maintenance tasks and periodic reports
 */
class Scheduler {
  constructor() {
    this.tasks = [];
    this.intervals = [];
  }

  /**
   * Start all scheduled tasks
   */
  start() {
    logger.info('[Scheduler] Starting scheduled tasks...');

    // Weekly digest — every Monday at 6 AM (check every hour)
    this.schedule('weekly-digest', 60 * 60 * 1000, async () => {
      const now = new Date();
      if (now.getDay() === 1 && now.getHours() === 6) {
        logger.info('[Scheduler] Running weekly digest...');
        await generateWeeklyDigest();
      }
    });

    // Cleanup old notifications — daily
    this.schedule('cleanup-notifications', 24 * 60 * 60 * 1000, async () => {
      const { rowCount } = await db.query(
        `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days'`
      );
      if (rowCount > 0) logger.info({ count: rowCount }, '[Scheduler] Cleaned up old notifications');
    });

    // Retry failed sessions — every 15 minutes
    this.schedule('retry-failed', 15 * 60 * 1000, async () => {
      const { rows } = await db.query(
        `SELECT id FROM sessions 
         WHERE status = 'error' AND created_at > NOW() - INTERVAL '24 hours' AND deleted_at IS NULL
         LIMIT 3`
      );
      if (rows.length > 0) {
        const { processSession } = require('./pipeline');
        for (const row of rows) {
          logger.info({ sessionId: row.id }, '[Scheduler] Retrying failed session');
          await db.query(
            `UPDATE sessions SET status = 'uploaded', error_message = NULL WHERE id = $1`,
            [row.id]
          );
          processSession(row.id).catch(err => {
            logger.error({ sessionId: row.id, err: err.message }, '[Scheduler] Retry failed');
          });
        }
      }
    });

    // Update stale job intelligence — every 6 hours
    this.schedule('refresh-intel', 6 * 60 * 60 * 1000, async () => {
      const { rows } = await db.query(`
        SELECT j.id FROM jobs j
        WHERE j.status = 'active' AND j.deleted_at IS NULL
        AND j.updated_at < (
          SELECT MAX(s.processed_at) FROM sessions s 
          WHERE s.job_id = j.id AND s.status = 'complete' AND s.deleted_at IS NULL
        )
        LIMIT 5
      `);
      if (rows.length > 0) {
        const { updateJobIntelligence } = require('./intelligence');
        for (const row of rows) {
          await updateJobIntelligence(row.id).catch(() => {});
        }
        logger.info({ count: rows.length }, '[Scheduler] Refreshed intelligence for jobs');
      }
    });

    logger.info({ taskCount: this.tasks.length }, '[Scheduler] Tasks registered');
  }

  /**
   * Register a scheduled task with overlap protection.
   * If a previous run is still in progress the new tick is skipped.
   */
  schedule(name, intervalMs, fn) {
    this.tasks.push(name);

    let isRunning = false;

    const safeRun = async () => {
      if (isRunning) {
        logger.warn({ task: name }, '[Scheduler] Task still running, skipping tick');
        return;
      }
      isRunning = true;
      try {
        await fn();
      } catch (err) {
        logger.error({ task: name, err: err.message }, '[Scheduler] Task failed');
      } finally {
        isRunning = false;
      }
    };

    // Run once after a short delay on startup
    setTimeout(safeRun, 30000);

    // Then run on interval
    const interval = setInterval(safeRun, intervalMs);
    this.intervals.push(interval);
  }

  /**
   * Stop all scheduled tasks
   */
  stop() {
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    logger.info('[Scheduler] All tasks stopped');
  }
}

module.exports = new Scheduler();
