const express = require('express');
const { getUnread, getCounts, markRead, markAllRead } = require('../services/notifications');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/notifications
 * Get notifications (optionally all, not just unread)
 */
router.get('/', async (req, res) => {
  try {
    const { unread } = req.query;
    
    // Default to only unread unless ?unread=false
    const onlyUnread = unread !== 'false';
    
    if (onlyUnread) {
      const notifications = await getUnread();
      return res.json({ notifications, unread: notifications.length });
    } else {
      // Get all recent notifications
      const db = require('../db');
      const { rows: notifications } = await db.query(
        `SELECT * FROM notifications 
         ORDER BY created_at DESC 
         LIMIT 100`
      );
      return res.json({ notifications, total: notifications.length });
    }
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
