const express = require('express');
const { logger } = require('../utils/logger');
const openclaw = require('../services/openclaw');

const router = express.Router();

/**
 * GET /api/openclaw/status
 * Check connection status and health of the self-hosted OpenClaw instance.
 */
router.get('/status', async (req, res) => {
  try {
    const health = await openclaw.checkHealth();
    const agents = health.connected ? await openclaw.listAgents() : [];

    res.json({
      configured: openclaw.isConfigured(),
      ...health,
      agent_count: agents.length,
      agents: agents.slice(0, 10), // Cap list size
    });
  } catch (err) {
    logger.error({ err }, '[OpenClaw] Status check error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/openclaw/message
 * Send a message to the OpenClaw agent directly.
 *
 * Body:
 *  - message (string, required): The message text to send
 *  - metadata (object, optional): Additional context
 */
router.post('/message', async (req, res) => {
  const { message, metadata } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (!openclaw.isConfigured()) {
    return res.status(503).json({ error: 'OpenClaw is not configured' });
  }

  try {
    const result = await openclaw.sendMessage(message.trim(), metadata || {});
    res.json({ success: true, result });
  } catch (err) {
    logger.error({ err }, '[OpenClaw] Send message error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/openclaw/push-session/:sessionId
 * Manually push a completed session's summary to OpenClaw.
 * Normally called automatically by the pipeline, but available for re-sends.
 */
router.post('/push-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const db = require('../db');

  if (!openclaw.isConfigured()) {
    return res.status(503).json({ error: 'OpenClaw is not configured' });
  }

  try {
    const { rows: [session] } = await db.query(
      'SELECT summary_json, discrepancies FROM sessions WHERE id = $1 AND deleted_at IS NULL',
      [sessionId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const summaryJson = typeof session.summary_json === 'string'
      ? JSON.parse(session.summary_json)
      : session.summary_json;

    const discrepancies = typeof session.discrepancies === 'string'
      ? JSON.parse(session.discrepancies)
      : session.discrepancies;

    await openclaw.pushSessionSummary(sessionId, summaryJson || {}, discrepancies);

    res.json({ success: true, session_id: sessionId });
  } catch (err) {
    logger.error({ err, sessionId }, '[OpenClaw] Push session error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/openclaw/job-context/:jobId
 * Return the structured job context that MAX sends to OpenClaw.
 * Useful for debugging what the agent sees.
 */
router.get('/job-context/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const context = await openclaw.buildJobContext(jobId);
    if (!context) return res.status(404).json({ error: 'Job not found' });
    res.json(context);
  } catch (err) {
    logger.error({ err, jobId }, '[OpenClaw] Job context error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/openclaw/webhook
 * Receive events from the OpenClaw instance (agent replies, task completions, etc.)
 *
 * Expected body:
 *  - event (string): Event type, e.g. "agent.reply", "task.complete"
 *  - data (object): Event payload
 */
router.post('/webhook', async (req, res) => {
  // Verify webhook signature
  if (!openclaw.verifyWebhook(req)) {
    logger.warn('[OpenClaw] Webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const { event, data } = req.body;
  if (!event) {
    return res.status(400).json({ error: 'event is required' });
  }

  logger.info({ event, data: JSON.stringify(data).substring(0, 200) }, '[OpenClaw] Webhook received');

  // Respond immediately so OpenClaw doesn't time out waiting
  res.json({ received: true });

  // Process event asynchronously
  setImmediate(() => handleOpenClawEvent(event, data || {}).catch(err => {
    logger.error({ err, event }, '[OpenClaw] Webhook handler error');
  }));
});

/**
 * Handle events pushed from the OpenClaw agent.
 */
async function handleOpenClawEvent(event, data) {
  const db = require('../db');
  const { broadcastNotification } = require('../services/notifications');

  switch (event) {
    case 'agent.reply': {
      // Agent replied to a MAX-initiated message — log and notify
      logger.info({ reply: data.content?.substring(0, 200) }, '[OpenClaw] Agent reply received');

      // Store as a notification for the Android app
      if (data.content) {
        await db.query(
          `INSERT INTO notifications (type, title, message, metadata)
           VALUES ('openclaw_reply', 'OpenClaw Agent', $1, $2)`,
          [data.content.substring(0, 500), JSON.stringify({ source: 'openclaw', event })]
        ).catch(() => {}); // Non-fatal
      }
      break;
    }

    case 'task.complete': {
      logger.info({ task: data.task_id, result: data.result }, '[OpenClaw] Agent task completed');
      break;
    }

    case 'action.created': {
      // OpenClaw agent created an action item — optionally sync back to MAX
      logger.info({ action: data.description }, '[OpenClaw] Agent created action item');

      if (data.job_id && data.description) {
        await db.query(
          `INSERT INTO action_items (job_id, description, priority, notes)
           VALUES ($1, $2, $3, 'Created by OpenClaw agent')`,
          [data.job_id, data.description, data.priority || 'normal']
        ).catch(() => {});
      }
      break;
    }

    case 'query.job': {
      // OpenClaw agent is asking for job context
      if (data.job_id) {
        const context = await openclaw.buildJobContext(data.job_id);
        if (context) {
          await openclaw.sendMessage(
            `[Job Context Response]\n${JSON.stringify(context, null, 2)}`,
            { event: 'query.job.response', job_id: data.job_id }
          );
        }
      }
      break;
    }

    default:
      logger.debug({ event }, '[OpenClaw] Unhandled webhook event');
  }
}

module.exports = router;
