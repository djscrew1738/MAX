const express = require('express');
const db = require('../db');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/jobs
 * List all active (non-deleted) jobs
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT j.*, 
        (SELECT COUNT(*) FROM sessions s WHERE s.job_id = j.id AND s.deleted_at IS NULL) as session_count,
        (SELECT COUNT(*) FROM attachments a WHERE a.job_id = j.id AND a.deleted_at IS NULL) as attachment_count,
        (SELECT COUNT(*) FROM action_items ai WHERE ai.job_id = j.id AND ai.completed = FALSE AND ai.deleted_at IS NULL) as open_items
       FROM jobs j
       WHERE j.deleted_at IS NULL
       ORDER BY j.updated_at DESC`
    );
    res.json(rows);
  } catch (err) {
    logger.error({ err }, '[Jobs] Error listing jobs');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/:id
 * Get job detail with sessions, attachments, action items
 */
router.get('/:id', async (req, res) => {
  try {
    const { rows: [job] } = await db.query(
      'SELECT * FROM jobs WHERE id = $1 AND deleted_at IS NULL', 
      [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { rows: sessions } = await db.query(
      'SELECT * FROM sessions WHERE job_id = $1 AND deleted_at IS NULL ORDER BY recorded_at DESC', 
      [req.params.id]
    );

    const { rows: attachments } = await db.query(
      'SELECT * FROM attachments WHERE job_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', 
      [req.params.id]
    );

    const { rows: actionItems } = await db.query(
      'SELECT * FROM action_items WHERE job_id = $1 AND deleted_at IS NULL ORDER BY completed ASC, created_at DESC', 
      [req.params.id]
    );

    res.json({ ...job, sessions, attachments, action_items: actionItems });
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, '[Jobs] Error getting job');
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/jobs/:id
 * Soft delete a job (and associated sessions)
 */
router.delete('/:id', async (req, res) => {
  try {
    // Soft delete the job
    const { rows: [job] } = await db.query(
      `UPDATE jobs SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id]
    );
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Soft delete associated sessions (cascade will handle chunks)
    await db.query(
      `UPDATE sessions SET deleted_at = NOW() WHERE job_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    
    // Soft delete associated action items
    await db.query(
      `UPDATE action_items SET deleted_at = NOW() WHERE job_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    
    // Soft delete associated attachments
    await db.query(
      `UPDATE attachments SET deleted_at = NOW() WHERE job_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );

    logger.info({ jobId: req.params.id }, '[Jobs] Job soft deleted');
    res.json({ success: true, message: 'Job deleted' });
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, '[Jobs] Error deleting job');
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/jobs/sessions/:id
 * Soft delete a session
 */
router.delete('/sessions/:id', async (req, res) => {
  try {
    const { rows: [session] } = await db.query(
      `UPDATE sessions SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    logger.info({ sessionId: req.params.id }, '[Jobs] Session soft deleted');
    res.json({ success: true, message: 'Session deleted' });
  } catch (err) {
    logger.error({ err, sessionId: req.params.id }, '[Jobs] Error deleting session');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/sessions/:id
 * Get full session detail
 */
router.get('/sessions/:id', async (req, res) => {
  try {
    const { rows: [session] } = await db.query(
      `SELECT s.*, j.builder_name, j.subdivision, j.lot_number
       FROM sessions s
       LEFT JOIN jobs j ON s.job_id = j.id
       WHERE s.id = $1 AND s.deleted_at IS NULL`, 
      [req.params.id]
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { rows: attachments } = await db.query(
      'SELECT * FROM attachments WHERE session_id = $1 AND deleted_at IS NULL', 
      [req.params.id]
    );

    const { rows: actionItems } = await db.query(
      'SELECT * FROM action_items WHERE session_id = $1 AND deleted_at IS NULL', 
      [req.params.id]
    );

    res.json({ ...session, attachments, action_items: actionItems });
  } catch (err) {
    logger.error({ err, sessionId: req.params.id }, '[Jobs] Error getting session');
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/jobs/actions/:id
 * Toggle action item completion
 */
router.patch('/actions/:id', async (req, res) => {
  try {
    const { completed } = req.body;
    const { rows: [item] } = await db.query(
      `UPDATE action_items SET completed = $1, completed_at = $2 WHERE id = $3 AND deleted_at IS NULL RETURNING *`,
      [completed, completed ? new Date() : null, req.params.id]
    );
    if (!item) return res.status(404).json({ error: 'Action item not found' });
    res.json(item);
  } catch (err) {
    logger.error({ err, actionId: req.params.id }, '[Jobs] Error updating action item');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/:id/intel
 * Get rolling intelligence for a job (generates if stale)
 */
router.get('/:id/intel', async (req, res) => {
  try {
    const { getJobIntelligence } = require('../services/intelligence');
    const forceRefresh = req.query.refresh === 'true';
    const intel = await getJobIntelligence(parseInt(req.params.id), forceRefresh);
    
    if (!intel) return res.status(404).json({ error: 'Job not found or no data' });

    const { rows: [job] } = await db.query(
      'SELECT id, builder_name, subdivision, lot_number FROM jobs WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    res.json({ ...job, intel });
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, '[Jobs] Error getting intelligence');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/jobs/sessions/:id/reprocess
 * Reprocess a session through the pipeline
 */
router.post('/sessions/:id/reprocess', async (req, res) => {
  try {
    const { processSession } = require('../services/pipeline');
    
    // Reset session status
    await db.query(
      `UPDATE sessions SET status = 'uploaded', error_message = NULL WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );

    // Clear old chunks for this session
    await db.query('DELETE FROM chunks WHERE session_id = $1', [req.params.id]);
    await db.query(
      'DELETE FROM action_items WHERE session_id = $1',
      [req.params.id]
    );

    // Reprocess
    processSession(parseInt(req.params.id)).catch(err => {
      logger.error({ err, sessionId: req.params.id }, '[Reprocess] Failed');
    });

    res.json({ success: true, message: 'Reprocessing started' });
  } catch (err) {
    logger.error({ err, sessionId: req.params.id }, '[Reprocess] Error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/dashboard/stats
 * Dashboard stats for the app home screen
 */
router.get('/dashboard/stats', async (req, res) => {
  try {
    const { rows: [stats] } = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM jobs WHERE status = 'active' AND deleted_at IS NULL) as active_jobs,
        (SELECT COUNT(*) FROM sessions WHERE status = 'complete' AND deleted_at IS NULL) as total_walks,
        (SELECT COUNT(*) FROM sessions WHERE status = 'complete' AND deleted_at IS NULL
         AND recorded_at > NOW() - INTERVAL '7 days') as walks_this_week,
        (SELECT COUNT(*) FROM action_items WHERE completed = FALSE AND deleted_at IS NULL) as open_actions,
        (SELECT COUNT(*) FROM action_items WHERE completed = FALSE AND priority IN ('high', 'critical') AND deleted_at IS NULL) as urgent_actions,
        (SELECT COUNT(*) FROM attachments WHERE file_type = 'pdf' AND deleted_at IS NULL) as total_plans,
        (SELECT COUNT(*) FROM sessions WHERE status = 'error' AND deleted_at IS NULL) as error_sessions,
        (SELECT SUM(duration_secs) FROM sessions WHERE status = 'complete' AND deleted_at IS NULL) as total_recording_secs
    `);

    // Recent activity
    const { rows: recentSessions } = await db.query(`
      SELECT s.id, s.title, s.phase, s.status, s.recorded_at, s.duration_secs,
             j.builder_name, j.subdivision, j.lot_number
      FROM sessions s
      LEFT JOIN jobs j ON s.job_id = j.id
      WHERE s.deleted_at IS NULL AND j.deleted_at IS NULL
      ORDER BY s.created_at DESC
      LIMIT 10
    `);

    // Urgent action items
    const { rows: urgentActions } = await db.query(`
      SELECT ai.*, j.builder_name, j.subdivision, j.lot_number
      FROM action_items ai
      LEFT JOIN jobs j ON ai.job_id = j.id
      WHERE ai.completed = FALSE AND ai.priority IN ('high', 'critical') 
        AND ai.deleted_at IS NULL AND j.deleted_at IS NULL
      ORDER BY ai.created_at DESC
      LIMIT 10
    `);

    res.json({
      stats: {
        ...stats,
        total_recording_hours: stats.total_recording_secs ? 
          (parseInt(stats.total_recording_secs) / 3600).toFixed(1) : '0',
      },
      recent_sessions: recentSessions,
      urgent_actions: urgentActions,
    });
  } catch (err) {
    logger.error({ err }, '[Jobs] Error getting dashboard stats');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
