const db = require('../db');
const { logger } = require('../utils/logger');

/**
 * Notification service with WebSocket broadcasting
 * Stores notifications for polling and broadcasts to connected WebSocket clients
 */

// WebSocket server reference (set from index.js)
let wss = null;

/**
 * Set WebSocket server reference for broadcasting
 */
function setWebSocketServer(server) {
  wss = server;
}

/**
 * Create a notification
 */
async function createNotification(type, title, body, data = {}) {
  try {
    await db.query(
      `INSERT INTO notifications (type, title, body, data, read)
       VALUES ($1, $2, $3, $4, FALSE)`,
      [type, title, body, JSON.stringify(data)]
    );
    logger.info({ type, title }, '[Notify] Created notification');
    
    // Broadcast to all connected WebSocket clients
    broadcastNotification({
      type: 'notification',
      notification: { type, title, body, data, created_at: new Date().toISOString() },
    });
  } catch (err) {
    logger.error({ err, type }, '[Notify] Failed to create notification');
  }
}

/**
 * Broadcast message to all connected WebSocket clients
 * Optionally filter by subscribed jobs
 */
function broadcastNotification(message) {
  if (!wss) return;
  
  const messageStr = JSON.stringify(message);
  
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      // If client has subscribed to specific jobs, filter accordingly
      if (client.subscribedJobs && client.subscribedJobs.length > 0) {
        const jobId = message.notification?.data?.job_id || message.sessionId;
        if (jobId && client.subscribedJobs.includes(jobId)) {
          client.send(messageStr);
        }
      } else {
        // No subscription filter, send to all
        client.send(messageStr);
      }
    }
  });
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
  
  // Broadcast session complete event
  broadcastNotification({
    type: 'session_complete',
    sessionId,
    summary: summaryJson,
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
  
  // Broadcast discrepancies event
  broadcastNotification({
    type: 'discrepancies',
    sessionId,
    discrepancies,
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
  
  // Broadcast error event
  broadcastNotification({
    type: 'error',
    sessionId,
    message: error,
  });
}

/**
 * Get unread notifications
 */
async function getUnread() {
  const { rows } = await db.query(
    `SELECT * FROM notifications 
     WHERE read = FALSE 
     ORDER BY created_at DESC 
     LIMIT 50`
  );
  return rows;
}

/**
 * Get notification counts
 */
async function getCounts() {
  const { rows: [counts] } = await db.query(`
    SELECT 
      COUNT(*) FILTER (WHERE read = FALSE) as unread,
      COUNT(*) as total
    FROM notifications
  `);
  return counts;
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

module.exports = {
  setWebSocketServer,
  createNotification,
  broadcastNotification,
  notifySessionComplete,
  notifyDiscrepancies,
  notifyError,
  getUnread,
  getCounts,
  markRead,
  markAllRead,
};
