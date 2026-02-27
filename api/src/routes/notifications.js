const express = require('express');
const db = require('../db');
const { getCounts, markRead, markAllRead } = require('../services/notifications');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/notifications
 * Get notifications with pagination.
 *
 * Query params:
 *   unread=false  — include read notifications (default: unread only)
 *   limit         — max results per page (1–100, default 20)
 *   offset        — skip N results (default 0)
 */
router.get('/', async (req, res) => {
  try {
    const onlyUnread = req.query.unread !== 'false';
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 100);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    const whereClause = onlyUnread ? 'WHERE read = FALSE' : '';

    const [{ rows: notifications }, { rows: [countRow] }] = await Promise.all([
      db.query(
        `SELECT * FROM notifications ${whereClause}
         ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      db.query(
        `SELECT COUNT(*) AS total FROM notifications ${whereClause}`
      ),
    ]);

    const total = parseInt(countRow.total);
    return res.json({
      notifications,
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    });
  } catch (err) {
    logger.error({ err }, '[Notifications] Error getting notifications');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/notifications/counts
 * Get notification counts
 */
router.get('/counts', async (req, res) => {
  try {
    const counts = await getCounts();
    res.json(counts);
  } catch (err) {
    logger.error({ err }, '[Notifications] Error getting counts');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notifications/read
 * Mark notifications as read
 * Body: { ids: [1, 2, 3] }
 */
router.post('/read', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids array required' });
    }
    await markRead(ids);
    res.json({ success: true, marked: ids.length });
  } catch (err) {
    logger.error({ err }, '[Notifications] Error marking read');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read
 */
router.post('/read-all', async (req, res) => {
  try {
    await markAllRead();
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[Notifications] Error marking all read');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
