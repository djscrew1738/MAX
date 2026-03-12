const fetch = require('node-fetch');
const db = require('../db');
const config = require('../config');
const { logger } = require('../utils/logger');

/**
 * OpenClaw Integration Service
 *
 * Connects MAX to the user's self-hosted OpenClaw AI agent instance.
 * OpenClaw is an open-source, self-hosted agent orchestration framework.
 *
 * What this does:
 *  - Posts job walk summaries to the OpenClaw agent after every session
 *  - Sends action items so the agent can schedule follow-ups
 *  - Accepts webhook events from OpenClaw (agent replies, task completions)
 *  - Provides a query interface so OpenClaw agents can pull job data from MAX
 *  - Fires events for discrepancies so the agent can take autonomous action
 *
 * Authentication: Bearer token (OPENCLAW_API_KEY)
 * Base URL: OPENCLAW_URL (e.g. http://100.83.120.32:3000)
 */

const BASE_URL = () => config.openclaw.url;
const API_KEY = () => config.openclaw.apiKey;
const AGENT_ID = () => config.openclaw.agentId;

function isConfigured() {
  return Boolean(BASE_URL() && API_KEY());
}

/**
 * Make an authenticated request to the OpenClaw REST API.
 */
async function openclawFetch(path, options = {}) {
  const url = `${BASE_URL()}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.openclaw.timeout);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY()}`,
        ...options.headers,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ============================================
// HEALTH CHECK
// ============================================

/**
 * Verify the OpenClaw instance is reachable and authenticated.
 */
async function checkHealth() {
  if (!isConfigured()) {
    return { connected: false, reason: 'not_configured' };
  }

  try {
    const response = await openclawFetch('/api/health');
    if (response.ok) {
      const body = await response.json().catch(() => ({}));
      return { connected: true, status: body.status || 'ok' };
    }
    return { connected: false, reason: `http_${response.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { connected: false, reason: 'timeout' };
    }
    return { connected: false, reason: err.message };
  }
}

// ============================================
// SEND MESSAGE TO OPENCLAW AGENT
// ============================================

/**
 * Send a message (text or structured data) to the configured OpenClaw agent.
 * OpenClaw receives this as a user message in the agent's conversation channel.
 *
 * @param {string} message - The message text to send
 * @param {Object} metadata - Extra context attached to the message
 */
async function sendMessage(message, metadata = {}) {
  if (!isConfigured()) return null;

  const agentId = AGENT_ID();
  const endpoint = agentId
    ? `/api/agents/${agentId}/message`
    : '/api/message';

  try {
    const response = await openclawFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        role: 'user',
        content: message,
        metadata: {
          source: 'max',
          ...metadata,
        },
      }),
    });

    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      logger.info({ agentId, messageId: result.id }, '[OpenClaw] Message sent');
      return result;
    }

    logger.warn({ status: response.status, agentId }, '[OpenClaw] Message send failed');
    return null;
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('[OpenClaw] Message send timed out');
    } else {
      logger.info({ err: err.message }, '[OpenClaw] Message send error');
    }
    return null;
  }
}

// ============================================
// SESSION COMPLETE — POST SUMMARY TO AGENT
// ============================================

/**
 * After a job walk session is processed, push the full structured summary
 * to OpenClaw so the agent can take autonomous follow-up actions:
 *   - Schedule call-backs
 *   - Update job tracking
 *   - Flag discrepancies to the team
 *   - Trigger pricing updates
 */
async function pushSessionSummary(sessionId, summaryJson, discrepancies = null) {
  if (!isConfigured()) return;

  const { rows: [session] } = await db.query(
    `SELECT s.*, j.builder_name, j.subdivision, j.lot_number, j.address, j.phase as job_phase
     FROM sessions s
     LEFT JOIN jobs j ON s.job_id = j.id
     WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [sessionId]
  );

  if (!session) return;

  const discrepancyCount = discrepancies?.items?.length || 0;

  const message = `
[MAX Job Walk Complete]

Builder: ${summaryJson.builder_name || session.builder_name || 'Unknown'}
Subdivision: ${summaryJson.subdivision || session.subdivision || 'Unknown'}
Lot: ${summaryJson.lot_number || session.lot_number || 'Unknown'}
Phase: ${summaryJson.phase || session.phase || 'Unknown'}
Session ID: ${sessionId}

Key Decisions:
${(summaryJson.key_decisions || []).map(d => `  • ${d}`).join('\n') || '  (none)'}

Action Items:
${(summaryJson.action_items || []).map(a => `  • [${a.priority || 'normal'}] ${a.description}`).join('\n') || '  (none)'}

Fixture Changes:
${summaryJson.fixture_changes ? JSON.stringify(summaryJson.fixture_changes, null, 2) : '  (none)'}

${discrepancyCount > 0 ? `⚠️ ${discrepancyCount} plan discrepancies detected — review required.\n` : ''}
Please acknowledge receipt and take any appropriate follow-up actions.
`.trim();

  await sendMessage(message, {
    event: 'session.complete',
    session_id: sessionId,
    job_id: session.job_id,
    builder: summaryJson.builder_name,
    subdivision: summaryJson.subdivision,
    lot: summaryJson.lot_number,
    phase: summaryJson.phase,
    action_item_count: (summaryJson.action_items || []).length,
    discrepancy_count: discrepancyCount,
  });
}

// ============================================
// PUSH ACTION ITEMS TO OPENCLAW
// ============================================

/**
 * Push open action items for a job to OpenClaw so the agent can
 * track, assign, or schedule follow-up tasks autonomously.
 */
async function pushActionItems(jobId) {
  if (!isConfigured()) return;

  const { rows: actions } = await db.query(
    `SELECT ai.*, s.phase FROM action_items ai
     LEFT JOIN sessions s ON ai.session_id = s.id
     WHERE ai.job_id = $1 AND ai.completed = FALSE AND ai.deleted_at IS NULL
     ORDER BY ai.created_at ASC`,
    [jobId]
  );

  if (actions.length === 0) return;

  const { rows: [job] } = await db.query(
    'SELECT builder_name, subdivision, lot_number FROM jobs WHERE id = $1 AND deleted_at IS NULL',
    [jobId]
  );

  if (!job) return;

  const message = `
[MAX Open Action Items]

Job: ${job.builder_name || 'Unknown'} — ${job.subdivision || ''} Lot ${job.lot_number || ''}

Open items (${actions.length}):
${actions.map((a, i) => `  ${i + 1}. [${a.priority}] ${a.description}${a.phase ? ` (${a.phase})` : ''}`).join('\n')}

Please review and schedule any required follow-ups or assign tasks appropriately.
`.trim();

  await sendMessage(message, {
    event: 'action_items.updated',
    job_id: jobId,
    action_count: actions.length,
  });
}

// ============================================
// DISCREPANCY ALERT TO OPENCLAW
// ============================================

/**
 * Alert the OpenClaw agent when plan discrepancies are found.
 * The agent can escalate to the team, schedule re-walks, etc.
 */
async function alertDiscrepancies(sessionId, discrepancies) {
  if (!isConfigured()) return;
  if (!discrepancies?.items?.length) return;

  const message = `
[MAX ⚠️ Plan Discrepancies Detected]

Session ID: ${sessionId}
Discrepancy Count: ${discrepancies.items.length}

Issues Found:
${discrepancies.items.map((d, i) => `  ${i + 1}. ${d.description || JSON.stringify(d)}`).join('\n')}

${discrepancies.summary || ''}

This requires review before proceeding. Please notify the relevant team members.
`.trim();

  await sendMessage(message, {
    event: 'discrepancies.detected',
    session_id: sessionId,
    discrepancy_count: discrepancies.items.length,
    severity: 'high',
  });
}

// ============================================
// QUERY ENDPOINT (OpenClaw pulls from MAX)
// ============================================

/**
 * Build a context payload for OpenClaw agents to query MAX.
 * Called when OpenClaw webhooks back asking for job data.
 * Returns structured data the agent can use directly.
 */
async function buildJobContext(jobId) {
  const { rows: [job] } = await db.query(
    `SELECT j.*,
      (SELECT COUNT(*) FROM sessions WHERE job_id = j.id AND status = 'complete' AND deleted_at IS NULL) as walk_count,
      (SELECT COUNT(*) FROM action_items WHERE job_id = j.id AND completed = FALSE AND deleted_at IS NULL) as open_actions
     FROM jobs j WHERE j.id = $1 AND j.deleted_at IS NULL`,
    [jobId]
  );

  if (!job) return null;

  const { rows: sessions } = await db.query(
    `SELECT id, phase, summary, recorded_at, duration_secs, summary_json
     FROM sessions WHERE job_id = $1 AND status = 'complete' AND deleted_at IS NULL
     ORDER BY recorded_at DESC LIMIT 5`,
    [jobId]
  );

  const { rows: actions } = await db.query(
    `SELECT description, priority, completed, created_at
     FROM action_items WHERE job_id = $1 AND completed = FALSE AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [jobId]
  );

  return {
    job: {
      id: job.id,
      builder: job.builder_name,
      subdivision: job.subdivision,
      lot: job.lot_number,
      address: job.address,
      phase: job.phase,
      status: job.status,
      walk_count: parseInt(job.walk_count),
      open_actions: parseInt(job.open_actions),
      job_intelligence: job.job_intel,
    },
    recent_sessions: sessions.map(s => ({
      id: s.id,
      phase: s.phase,
      recorded_at: s.recorded_at,
      duration_secs: s.duration_secs,
      summary_preview: s.summary?.substring(0, 300),
    })),
    open_action_items: actions,
  };
}

// ============================================
// WEBHOOK VERIFICATION
// ============================================

/**
 * Verify an incoming webhook from OpenClaw.
 * Checks the x-openclaw-signature header if a webhook secret is configured.
 */
function verifyWebhook(req) {
  const secret = config.openclaw.webhookSecret;
  if (!secret) return true; // No secret configured — trust all (dev mode)

  const signature = req.headers['x-openclaw-signature'];
  if (!signature) return false;

  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// ============================================
// LIST AVAILABLE AGENTS
// ============================================

/**
 * Fetch the list of agents running on the OpenClaw instance.
 */
async function listAgents() {
  if (!isConfigured()) return [];

  try {
    const response = await openclawFetch('/api/agents');
    if (response.ok) {
      const result = await response.json().catch(() => ({ agents: [] }));
      return result.agents || result || [];
    }
  } catch (err) {
    logger.info({ err: err.message }, '[OpenClaw] Could not list agents');
  }

  return [];
}

module.exports = {
  isConfigured,
  checkHealth,
  sendMessage,
  pushSessionSummary,
  pushActionItems,
  alertDiscrepancies,
  buildJobContext,
  verifyWebhook,
  listAgents,
};
