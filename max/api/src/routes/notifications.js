const express = require('express');
const { getUnread, markRead } = require('../services/notifications');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

/**
 * GET /api/notifications
 * Get unread notifications (for Android polling)
 */
router.get('/', asyncHandler(async (req, res) => {
  const notifications = await getUnread();
  res.json(notifications);
}));

/**
 * POST /api/notifications/read
 * Mark notifications as read
 * Body: { ids: [1, 2, 3] }
 */
router.post('/read', asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    const error = new Error('ids array required');
    error.statusCode = 400;
    throw error;
  }
  await markRead(ids);
  res.json({ success: true });
}));

module.exports = router;