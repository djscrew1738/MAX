const db = require('../db');

/**
 * Notification System
 * - Stores notifications for Android app polling
 * - Broadcasts via WebSocket for real-time updates
 * - Can be extended to use Firebase Cloud Messaging (FCM)
 */

/**
 * Broadcast via WebSocket if available
 */
function broadcast(message) {
  try {
    const { broadcast: wsBroadcast } = require('../index');
    if (wsBroadcast) {
      wsBroadcast(message);
    }
  } catch (e) {
    // WebSocket not available, ignore
  }
}

/**
 * Create a notification
 */
async function createNotification(type, title, body, data = {}) {
  const { rows: [notification] } = await db.query(
    `INSERT INTO notifications (type, title, body, data, read)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING *`,
    [type, title, body, JSON.stringify(data)]
  );
  
  console.log(`[Notify] ${type}: ${title}`);
  
  // Broadcast real-time notification
  broadcast({
    type: 'notification',
    notification: {
      id: notification.id,
      type,
      title,
      body,
      data,
      created_at: notification.created_at,
    },
  });
  
  return notification;
}

/**
 * Notify that a session has been processed
 */
async function notifySessionComplete(sessionId, summaryJson) {
  const builder = summaryJson.builder_name || '';
  const subdivision = summaryJson.subdivision || '';
  const lot = summaryJson.lot_number ? `Lot ${summaryJson.lot_number}` : '';
  const parts = [builder, subdivision, lot].filter(Boolean);
  const jobLabel = parts.length > 0 ? parts.join(' — ') : `Session #${sessionId}`;

  const actionCount = summaryJson.action_items?.length || 0;
  const flagCount = summaryJson.flags?.length || 0;

  let body = `Summary ready for ${jobLabel}`;
  if (actionCount > 0) body += ` • ${actionCount} action items`;
  if (flagCount > 0) body += ` • ${flagCount} flags`;

  await createNotification('session_complete', '🔨 Job Walk Processed', body, {
    session_id: sessionId,
    action_items: actionCount,
    flags: flagCount,
  });
  
  // Also broadcast session completion
  broadcast({
    type: 'session_complete',
    sessionId,
    summary: {
      builder_name: summaryJson.builder_name,
      subdivision: summaryJson.subdivision,
      lot_number: summaryJson.lot_number,
      action_items: actionCount,
      flags: flagCount,
    },
  });
}

/**
 * Notify about discrepancies found
 */
async function notifyDiscrepancies(sessionId, discrepancies) {
  if (!discrepancies?.items?.length) return;

  const high = discrepancies.items.filter(d => d.severity === 'high' || d.severity === 'critical');
  
  if (high.length > 0) {
    await createNotification(
      'discrepancy',
      '⚠️ Plan Discrepancies Found',
      `${high.length} high-priority discrepancies detected. ${discrepancies.recommendation || ''}`,
      { session_id: sessionId, count: discrepancies.items.length }
    );
  }
  
  // Broadcast discrepancy alert
  broadcast({
    type: 'discrepancies',
    sessionId,
    discrepancies: {
      count: discrepancies.items.length,
      highPriority: high.length,
      items: discrepancies.items.slice(0, 5), // Limit to first 5
    },
  });
}

/**
 * Notify about processing errors
 */
async function notifyError(sessionId, error) {
  await createNotification(
    'error',
    '❌ Processing Failed',
    `Session #${sessionId}: ${error}`,
    { session_id: sessionId }
  );
  
  broadcast({
    type: 'error',
    sessionId,
    error: error.substring(0, 200), // Limit error length
  });
}

/**
 * Get unread notifications
 */
async function getUnread(limit = 50) {
  const { rows } = await db.query(
    `SELECT * FROM notifications WHERE read = FALSE ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

/**
 * Get all notifications with pagination
 */
async function getAll(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const { rows } = await db.query(
    `SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

/**
 * Mark notifications as read
 */
async function markRead(notificationIds) {
  if (!notificationIds || notificationIds.length === 0) return;
  await db.query(
    `UPDATE notifications SET read = TRUE WHERE id = ANY($1)`,
    [notificationIds]
  );
}

/**
 * Mark all notifications as read
 */
async function markAllRead() {
  await db.query(`UPDATE notifications SET read = TRUE WHERE read = FALSE`);
}

/**
 * Get notification count
 */
async function getCounts() {
  const { rows: [counts] } = await db.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE read = FALSE) as unread,
      COUNT(*) FILTER (WHERE type = 'session_complete') as sessions,
      COUNT(*) FILTER (WHERE type = 'discrepancy') as discrepancies,
      COUNT(*) FILTER (WHERE type = 'error') as errors
    FROM notifications
  `);
  return counts;
}

module.exports = {
  createNotification,
  notifySessionComplete,
  notifyDiscrepancies,
  notifyError,
  getUnread,
  getAll,
  markRead,
  markAllRead,
  getCounts,
};
