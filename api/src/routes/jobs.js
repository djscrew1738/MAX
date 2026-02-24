const express = require('express');
const db = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

/**
 * GET /api/jobs
 * List all jobs (with pagination)
 */
router.get('/', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;

  const { rows } = await db.query(
    `SELECT j.*, 
      (SELECT COUNT(*) FROM sessions s WHERE s.job_id = j.id) as session_count,
      (SELECT COUNT(*) FROM attachments a WHERE a.job_id = j.id) as attachment_count,
      (SELECT COUNT(*) FROM action_items ai WHERE ai.job_id = j.id AND ai.completed = FALSE) as open_items
     FROM jobs j
     ORDER BY j.updated_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  
  // Total count for pagination metadata
  const { rows: [{ count: total }] } = await db.query('SELECT COUNT(*) FROM jobs');

  res.json({
    data: rows,
    pagination: {
      total: parseInt(total),
      limit,
      offset,
      has_more: offset + limit < total
    }
  });
}));

/**
 * GET /api/jobs/:id
 * Get job detail with sessions, attachments, action items
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { rows: [job] } = await db.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!job) {
    const error = new Error('Job not found');
    error.statusCode = 404;
    throw error;
  }

  const { rows: sessions } = await db.query(
    'SELECT * FROM sessions WHERE job_id = $1 ORDER BY recorded_at DESC', [req.params.id]
  );

  const { rows: attachments } = await db.query(
    'SELECT * FROM attachments WHERE job_id = $1 ORDER BY created_at DESC', [req.params.id]
  );

  const { rows: actionItems } = await db.query(
    'SELECT * FROM action_items WHERE job_id = $1 ORDER BY completed ASC, created_at DESC', [req.params.id]
  );

  res.json({ ...job, sessions, attachments, action_items: actionItems });
}));

/**
 * GET /api/jobs/sessions/:id
 * Get full session detail
 */
router.get('/sessions/:id', asyncHandler(async (req, res) => {
  const { rows: [session] } = await db.query(
    `SELECT s.*, j.builder_name, j.subdivision, j.lot_number
     FROM sessions s
     LEFT JOIN jobs j ON s.job_id = j.id
     WHERE s.id = $1`, 
    [req.params.id]
  );
  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 404;
    throw error;
  }

  const { rows: attachments } = await db.query(
    'SELECT * FROM attachments WHERE session_id = $1', [req.params.id]
  );

  const { rows: actionItems } = await db.query(
    'SELECT * FROM action_items WHERE session_id = $1', [req.params.id]
  );

  res.json({ ...session, attachments, action_items: actionItems });
}));

/**
 * PATCH /api/jobs/actions/:id
 * Toggle action item completion
 */
router.patch('/actions/:id', asyncHandler(async (req, res) => {
  const { completed } = req.body;
  const { rows: [item] } = await db.query(
    `UPDATE action_items SET completed = $1, completed_at = $2 WHERE id = $3 RETURNING *`,
    [completed, completed ? new Date() : null, req.params.id]
  );
  if (!item) {
    const error = new Error('Action item not found');
    error.statusCode = 404;
    throw error;
  }
  res.json(item);
}));

/**
 * GET /api/jobs/:id/intel
 * Get rolling intelligence for a job (generates if stale)
 */
router.get('/:id/intel', asyncHandler(async (req, res) => {
  const { getJobIntelligence } = require('../services/intelligence');
  const forceRefresh = req.query.refresh === 'true';
  const intel = await getJobIntelligence(parseInt(req.params.id), forceRefresh);
  
  if (!intel) {
    const error = new Error('Job not found or no data');
    error.statusCode = 404;
    throw error;
  }

  const { rows: [job] } = await db.query(
    'SELECT id, builder_name, subdivision, lot_number FROM jobs WHERE id = $1',
    [req.params.id]
  );
  
  res.json({ ...job, intel });
}));

/**
 * POST /api/jobs/sessions/:id/reprocess
 * Reprocess a session through the pipeline
 */
router.post('/sessions/:id/reprocess', asyncHandler(async (req, res) => {
  const { processSession } = require('../services/pipeline');
  
  // Reset session status
  await db.query(
    `UPDATE sessions SET status = 'uploaded', error_message = NULL WHERE id = $1`,
    [req.params.id]
  );

  // Clear old chunks for this session
  await db.query('DELETE FROM chunks WHERE session_id = $1', [req.params.id]);
  await db.query('DELETE FROM action_items WHERE session_id = $1', [req.params.id]);

  // Reprocess in background
  processSession(parseInt(req.params.id)).catch(err => {
    console.error(`[Reprocess] Failed:`, err.message);
  });

  res.json({ success: true, message: 'Reprocessing started' });
}));

/**
 * GET /api/jobs/dashboard/stats
 * Dashboard stats for the app home screen
 */
router.get('/dashboard/stats', asyncHandler(async (req, res) => {
  const { rows: [stats] } = await db.query(`
    SELECT 
      (SELECT COUNT(*) FROM jobs WHERE status = 'active') as active_jobs,
      (SELECT COUNT(*) FROM sessions WHERE status = 'complete') as total_walks,
      (SELECT COUNT(*) FROM sessions WHERE status = 'complete' 
       AND recorded_at > NOW() - INTERVAL '7 days') as walks_this_week,
      (SELECT COUNT(*) FROM action_items WHERE completed = FALSE) as open_actions,
      (SELECT COUNT(*) FROM action_items WHERE completed = FALSE AND priority IN ('high', 'critical')) as urgent_actions,
      (SELECT COUNT(*) FROM attachments WHERE file_type = 'pdf') as total_plans,
      (SELECT COUNT(*) FROM sessions WHERE status = 'error') as error_sessions,
      (SELECT SUM(duration_secs) FROM sessions WHERE status = 'complete') as total_recording_secs
  `);

  // Recent activity
  const { rows: recentSessions } = await db.query(`
    SELECT s.id, s.title, s.phase, s.status, s.recorded_at, s.duration_secs,
           j.builder_name, j.subdivision, j.lot_number
    FROM sessions s
    LEFT JOIN jobs j ON s.job_id = j.id
    ORDER BY s.created_at DESC
    LIMIT 10
  `);

  // Urgent action items
  const { rows: urgentActions } = await db.query(`
    SELECT ai.*, j.builder_name, j.subdivision, j.lot_number
    FROM action_items ai
    LEFT JOIN jobs j ON ai.job_id = j.id
    WHERE ai.completed = FALSE AND ai.priority IN ('high', 'critical')
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
}));

module.exports = router;