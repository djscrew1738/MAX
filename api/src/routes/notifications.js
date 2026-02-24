const express = require('express');
const { 
  getUnread, 
  getAll, 
  markRead, 
  markAllRead, 
  getCounts 
} = require('../services/notifications');

const router = express.Router();

/**
 * GET /api/notifications
 * Get unread notifications (for Android polling)
 * Query params:
 *   - all: if true, returns all notifications (default: false = unread only)
 *   - page: page number for pagination (default: 1)
 *   - limit: items per page (default: 50)
 */
router.get('/', async (req, res, next) => {
  try {
    const { all, page, limit } = req.query;
    
    if (all === 'true') {
      const notifications = await getAll(
        parseInt(page) || 1, 
        parseInt(limit) || 50
      );
      res.json(notifications);
    } else {
      const notifications = await getUnread(parseInt(limit) || 50);
      res.json(notifications);
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications/counts
 * Get notification counts
 */
router.get('/counts', async (req, res, next) => {
  try {
    const counts = await getCounts();
    res.json(counts);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/read
 * Mark specific notifications as read
 * Body: { ids: [1, 2, 3] }
 */
router.post('/read', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids array required' });
    }
    await markRead(ids);
    res.json({ success: true, marked: ids.length });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read
 */
router.post('/read-all', async (req, res, next) => {
  try {
    await markAllRead();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
