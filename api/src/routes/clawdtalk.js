const express = require('express');
const { logger } = require('../utils/logger');
const clawdtalk = require('../services/clawdtalk');

const router = express.Router();

/**
 * GET /api/clawdtalk/status
 * Return the current ClawdTalk WebSocket connection status.
 */
router.get('/status', (req, res) => {
  res.json(clawdtalk.getStatus());
});

/**
 * POST /api/clawdtalk/call
 * Initiate an outbound voice call through ClawdTalk.
 * Useful for alerting team members about urgent job issues.
 *
 * Body:
 *  - to (string, required): E.164 phone number, e.g. "+15550123456"
 *  - message (string, optional): What MAX should say when the call connects
 */
router.post('/call', async (req, res) => {
  const { to, message } = req.body;

  if (!to || typeof to !== 'string') {
    return res.status(400).json({ error: '"to" phone number is required (E.164 format)' });
  }

  // Basic E.164 validation
  if (!/^\+[1-9]\d{7,14}$/.test(to)) {
    return res.status(400).json({ error: 'Invalid phone number format — use E.164 (e.g. +15550123456)' });
  }

  if (!clawdtalk.isConfigured()) {
    return res.status(503).json({ error: 'ClawdTalk is not configured' });
  }

  try {
    const result = await clawdtalk.initiateCall(to, message || null);
    if (result.success) {
      res.json({ success: true, call_id: result.call_id });
    } else {
      res.status(502).json({ success: false, reason: result.reason });
    }
  } catch (err) {
    logger.error({ err }, '[ClawdTalk] Outbound call error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/clawdtalk/reconnect
 * Force a reconnection attempt to the ClawdTalk WebSocket gateway.
 * Useful if the connection has dropped and you don't want to wait for auto-reconnect.
 */
router.post('/reconnect', (req, res) => {
  if (!clawdtalk.isConfigured()) {
    return res.status(503).json({ error: 'ClawdTalk is not configured' });
  }

  clawdtalk.connect();
  res.json({ success: true, status: clawdtalk.getStatus() });
});

module.exports = router;
