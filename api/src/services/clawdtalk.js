const WebSocket = require('ws');
const fetch = require('node-fetch');
const config = require('../config');
const { logger } = require('../utils/logger');
const { searchChunks } = require('./embeddings');

/**
 * ClawdTalk Integration Service
 *
 * ClawdTalk gives MAX a voice — callers can phone in and ask questions
 * about jobs, fixtures, action items, and plans, and MAX answers via speech.
 *
 * Architecture:
 *  - ClawdTalk maintains a persistent outbound WebSocket connection FROM MAX to ClawdTalk.
 *    (No public gateway / port-forwarding required on MAX's end.)
 *  - Incoming voice is transcribed by ClawdTalk and sent to MAX as text events.
 *  - MAX runs the query through its RAG system and sends a text response back.
 *  - ClawdTalk converts the text to speech for the caller.
 *  - MAX can also initiate outbound voice calls via ClawdTalk's REST API.
 *
 * WebSocket event format — Inbound (ClawdTalk → MAX):
 *   { event: "message", call_id: "clk_xxx", text: "...", timestamp: "...", sequence: 1, is_interruption: false }
 *
 * WebSocket response format — Outbound (MAX → ClawdTalk):
 *   { type: "response", call_id: "clk_xxx", text: "..." }
 *
 * REST: POST /v1/calls { "to": "+15550123456" }
 */

const CLAWDTALK_SYSTEM_CONTEXT = `You are Max, an AI voice assistant for CTL Plumbing LLC.
A caller is asking you questions about job walks, fixtures, action items, or job status.
Answer concisely since this is a voice call — no more than 2-3 sentences per response.
Use plain language. Do not use bullet points or lists — speak in natural sentences.
If you do not have the information, say so clearly.`;

let ws = null;
let reconnectTimer = null;
let isShuttingDown = false;
let connectionAttempts = 0;

// Active calls: call_id → { history, jobId }
const activeCalls = new Map();

/**
 * Returns true if ClawdTalk is configured via environment.
 */
function isConfigured() {
  return Boolean(config.clawdtalk.apiKey);
}

/**
 * Returns the current connection state.
 */
function getStatus() {
  if (!isConfigured()) return { connected: false, reason: 'not_configured' };

  if (!ws) return { connected: false, reason: 'not_started' };

  const states = {
    [WebSocket.CONNECTING]: 'connecting',
    [WebSocket.OPEN]: 'connected',
    [WebSocket.CLOSING]: 'closing',
    [WebSocket.CLOSED]: 'disconnected',
  };

  return {
    connected: ws.readyState === WebSocket.OPEN,
    state: states[ws.readyState] || 'unknown',
    active_calls: activeCalls.size,
    connection_attempts: connectionAttempts,
  };
}

// ============================================
// WEBSOCKET CONNECTION MANAGEMENT
// ============================================

/**
 * Connect to ClawdTalk's WebSocket gateway.
 * This is a persistent outbound connection — ClawdTalk routes incoming
 * voice calls to this socket without requiring MAX to be publicly exposed.
 */
function connect() {
  if (!isConfigured()) {
    logger.info('[ClawdTalk] Not configured — skipping connection');
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    logger.info('[ClawdTalk] Already connected');
    return;
  }

  connectionAttempts++;
  logger.info({ attempt: connectionAttempts }, '[ClawdTalk] Connecting to gateway...');

  const wsUrl = config.clawdtalk.wsUrl;

  ws = new WebSocket(wsUrl, {
    headers: {
      'Authorization': `Bearer ${config.clawdtalk.apiKey}`,
      'X-Max-Version': '2.0',
    },
  });

  ws.on('open', () => {
    connectionAttempts = 0;
    logger.info('[ClawdTalk] Connected to gateway ✓');

    // Send registration handshake
    ws.send(JSON.stringify({
      type: 'register',
      agent: 'max',
      version: '2.0',
      capabilities: ['rag_query', 'job_lookup', 'action_items'],
    }));
  });

  ws.on('message', (rawData) => {
    handleIncomingEvent(rawData);
  });

  ws.on('close', (code, reason) => {
    logger.info({ code, reason: reason.toString() }, '[ClawdTalk] Connection closed');
    ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    logger.warn({ err: err.message }, '[ClawdTalk] WebSocket error');
    // 'close' event fires after 'error', which triggers reconnect
  });

  // Heartbeat ping every 30 seconds to keep the connection alive
  ws.on('open', () => {
    const pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  });
}

/**
 * Schedule a reconnection attempt with exponential backoff.
 */
function scheduleReconnect() {
  if (isShuttingDown) return;
  if (reconnectTimer) return; // Already scheduled

  const baseDelay = config.clawdtalk.reconnectDelay;
  const delay = Math.min(baseDelay * Math.pow(1.5, Math.min(connectionAttempts, 8)), 120000);

  logger.info({ delayMs: delay }, '[ClawdTalk] Scheduling reconnect...');

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/**
 * Gracefully disconnect.
 */
function disconnect() {
  isShuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close(1000, 'Server shutting down');
    ws = null;
  }

  logger.info('[ClawdTalk] Disconnected');
}

// ============================================
// INCOMING EVENT HANDLER
// ============================================

/**
 * Handle an event received from ClawdTalk.
 */
async function handleIncomingEvent(rawData) {
  let event;

  try {
    event = JSON.parse(rawData.toString());
  } catch (err) {
    logger.warn('[ClawdTalk] Received non-JSON message');
    return;
  }

  logger.debug({ event: event.event, callId: event.call_id }, '[ClawdTalk] Event received');

  switch (event.event) {
    case 'message':
      await handleVoiceMessage(event);
      break;

    case 'call.started':
      handleCallStarted(event);
      break;

    case 'call.ended':
      handleCallEnded(event);
      break;

    case 'registered':
      logger.info({ phoneNumber: event.phone_number }, '[ClawdTalk] Skill registered ✓');
      break;

    case 'error':
      logger.error({ error: event.message, callId: event.call_id }, '[ClawdTalk] Server error');
      break;

    default:
      logger.debug({ event: event.event }, '[ClawdTalk] Unhandled event type');
  }
}

/**
 * Handle the start of a new inbound call.
 */
function handleCallStarted(event) {
  const { call_id, from } = event;
  activeCalls.set(call_id, { history: [], from, startedAt: Date.now() });
  logger.info({ call_id, from }, '[ClawdTalk] Call started');
}

/**
 * Handle a call ending — clean up state.
 */
function handleCallEnded(event) {
  const { call_id } = event;
  const call = activeCalls.get(call_id);

  if (call) {
    const durationSecs = Math.round((Date.now() - call.startedAt) / 1000);
    logger.info({ call_id, durationSecs, turns: call.history.length }, '[ClawdTalk] Call ended');
    activeCalls.delete(call_id);
  }
}

// ============================================
// VOICE QUERY (RAG) HANDLER
// ============================================

/**
 * Handle a transcribed voice message from a caller.
 * Runs the message through MAX's RAG system and sends the response back.
 */
async function handleVoiceMessage(event) {
  const { call_id, text, is_interruption } = event;

  if (!text?.trim()) return;

  // Skip processing if this is an interruption (caller spoke while MAX was responding)
  if (is_interruption) {
    logger.info({ call_id }, '[ClawdTalk] Interruption detected — discarding previous response');
    return;
  }

  logger.info({ call_id, text: text.substring(0, 80) }, '[ClawdTalk] Voice query');

  // Initialize call state if not already tracked
  if (!activeCalls.has(call_id)) {
    activeCalls.set(call_id, { history: [], startedAt: Date.now() });
  }

  const call = activeCalls.get(call_id);

  try {
    // Build response via RAG
    const responseText = await queryRAG(text, call.history, call.jobId);

    // Update conversation history
    call.history.push({ role: 'user', text });
    call.history.push({ role: 'assistant', text: responseText });

    // Keep history from growing unbounded
    if (call.history.length > 20) {
      call.history = call.history.slice(-20);
    }

    // Send response back to ClawdTalk
    sendResponse(call_id, responseText);

    logger.info({ call_id, responseLength: responseText.length }, '[ClawdTalk] Response sent');

  } catch (err) {
    logger.error({ call_id, err: err.message }, '[ClawdTalk] RAG query failed');
    sendResponse(call_id, "I'm sorry, I'm having trouble accessing the job data right now. Please try again in a moment.");
  }
}

/**
 * Send a text response back to ClawdTalk for TTS conversion.
 */
function sendResponse(callId, text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.warn({ callId }, '[ClawdTalk] Cannot send response — not connected');
    return;
  }

  ws.send(JSON.stringify({
    type: 'response',
    call_id: callId,
    text,
  }));
}

// ============================================
// RAG QUERY ENGINE (voice-optimized)
// ============================================

/**
 * Query MAX's job knowledge base and produce a voice-friendly response.
 */
async function queryRAG(question, history = [], jobId = null) {
  const ragFetch = require('node-fetch');
  const cfg = require('../config');

  // Search relevant chunks
  const chunks = await searchChunks(question, {
    jobId: jobId || null,
    limit: 5,
  });

  let context = '';
  if (chunks.length > 0) {
    context = '\n\nRELEVANT JOB DATA:\n';
    for (const chunk of chunks) {
      const meta = [chunk.builder_name, chunk.subdivision, chunk.lot_number ? `Lot ${chunk.lot_number}` : null]
        .filter(Boolean).join(' — ');
      context += `[${meta || 'Recording'}]: ${chunk.content.substring(0, 400)}\n\n`;
    }
  }

  // Build message list
  const messages = [
    { role: 'system', content: CLAWDTALK_SYSTEM_CONTEXT },
  ];

  // Add recent conversation history
  for (const turn of history.slice(-6)) {
    messages.push({ role: turn.role === 'user' ? 'user' : 'assistant', content: turn.text });
  }

  messages.push({
    role: 'user',
    content: question + context,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), cfg.ollama.chatTimeout);

  try {
    const response = await ragFetch(`${cfg.ollama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.ollama.model,
        messages,
        stream: false,
        options: {
          temperature: 0.4,
          num_predict: 300, // Short for voice — 2-3 sentences max
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

    const result = await response.json();
    return result.message?.content?.trim() || 'I could not find an answer to that question.';

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return "I'm still searching for that information. Please hold on or call back in a moment.";
    }
    throw err;
  }
}

// ============================================
// OUTBOUND CALL INITIATION
// ============================================

/**
 * Initiate an outbound voice call through ClawdTalk's REST API.
 * Useful for alerting team members about urgent discrepancies or action items.
 *
 * @param {string} toNumber - E.164 phone number to call (e.g. "+15550123456")
 * @param {string} initialMessage - What MAX should say when the call connects
 */
async function initiateCall(toNumber, initialMessage = null) {
  if (!isConfigured()) {
    return { success: false, reason: 'not_configured' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const body = { to: toNumber };
    if (initialMessage) body.initial_message = initialMessage;

    const response = await fetch(`${config.clawdtalk.apiUrl}/v1/calls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.clawdtalk.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      logger.info({ to: toNumber, callId: result.call_id }, '[ClawdTalk] Outbound call initiated');
      return { success: true, call_id: result.call_id };
    }

    const errBody = await response.json().catch(() => ({}));
    logger.warn({ to: toNumber, status: response.status, error: errBody }, '[ClawdTalk] Call initiation failed');
    return { success: false, reason: errBody.message || `http_${response.status}` };

  } catch (err) {
    clearTimeout(timeoutId);
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    logger.warn({ to: toNumber, reason }, '[ClawdTalk] Call initiation error');
    return { success: false, reason };
  }
}

module.exports = {
  isConfigured,
  getStatus,
  connect,
  disconnect,
  initiateCall,
};
