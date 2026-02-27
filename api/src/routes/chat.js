const express = require('express');
const db = require('../db');
const config = require('../config');
const { logger } = require('../utils/logger');
const { sanitizeForLLM } = require('../middlewares/security');
const { validateChatInput } = require('../utils/schemas');
const { searchChunks } = require('../services/embeddings');

const router = express.Router();

const CHAT_SYSTEM_PROMPT = `You are Max, an AI field assistant for CTL Plumbing LLC, a new construction plumbing company in the Dallas-Fort Worth area.

You have access to transcripts, summaries, and plan analyses from job walk recordings. When answering questions, use ONLY the provided context from real recordings. If you don't have enough information, say so — never make up job details.

Key context about CTL Plumbing:
- Works five phases: Underground, Rough-In, Top-Out, Trim, Final
- Common builders: DR Horton, Horizon Homes, and various custom builders
- Tracks fixtures, change orders, action items, and discrepancies between plans and conversations

Be concise and direct. You're talking to the owner who's probably on a job site — give quick, useful answers. Use specific details from the recordings when available.`;

/**
 * POST /api/chat
 * RAG-powered chat with Max
 * 
 * Body:
 *  - message: user's question
 *  - job_id (optional): scope to a specific job
 *  - history (optional): array of {role, content} for conversation context
 */
router.post('/', async (req, res) => {
  const reqLogger = logger.child({ reqId: req.id });
  
  try {
    // Validate input
    const validated = validateChatInput(req.body);
    if (validated.error) {
      return res.status(400).json({ error: 'Invalid input', details: validated.error });
    }
    
    const { message, job_id, history = [] } = validated;

    reqLogger.info({ jobId: job_id, messageLength: message.length }, '[Chat] Query received');

    // --- Step 1: Search for relevant context ---
    const relevantChunks = await searchChunks(message, {
      jobId: job_id || null,
      limit: 8,
    });

    // Build context string from relevant chunks
    let context = '';
    if (relevantChunks.length > 0) {
      context = '\n\nRELEVANT INFORMATION FROM RECORDINGS:\n\n';
      for (const chunk of relevantChunks) {
        const meta = [];
        if (chunk.builder_name) meta.push(chunk.builder_name);
        if (chunk.subdivision) meta.push(chunk.subdivision);
        if (chunk.lot_number) meta.push(`Lot ${chunk.lot_number}`);
        if (chunk.recorded_at) meta.push(new Date(chunk.recorded_at).toLocaleDateString());
        
        const header = meta.length > 0 ? `[${meta.join(' — ')}]` : '[Recording]';
        context += `${header} (${chunk.chunk_type}):\n${chunk.content}\n\n`;
      }
    }

    // --- Step 2: Also pull recent action items if relevant ---
    const actionContext = await getActionItemContext(job_id, message);

    // --- Step 3: Build messages for Ollama ---
    const messages = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ];

    // Add conversation history (last 10 turns, validated roles only)
    const recentHistory = history.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;
      messages.push({
        role: msg.role,
        content: sanitizeForLLM(msg.content).substring(0, 5000),
      });
    }

    // Add the current question with context
    let userMessage = sanitizeForLLM(message);
    if (context) userMessage += context;
    if (actionContext) userMessage += actionContext;
    messages.push({ role: 'user', content: userMessage });

    // --- Step 4: Get response from Ollama with timeout ---
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.ollama.chatTimeout);

    const response = await fetch(`${config.ollama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        messages,
        stream: false,
        options: {
          temperature: 0.5,
          num_predict: 1024,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama chat failed: ${response.status}`);
    }

    const result = await response.json();
    const reply = result.message?.content || 'Sorry, I couldn\'t generate a response.';

    // --- Step 5: Save to chat history ---
    await db.query(
      `INSERT INTO chat_messages (role, content) VALUES ('user', $1)`,
      [message]
    );
    await db.query(
      `INSERT INTO chat_messages (role, content, context_used) VALUES ('assistant', $1, $2)`,
      [reply, JSON.stringify(relevantChunks.map(c => ({ id: c.id, similarity: c.similarity })))]
    );

    reqLogger.info({ replyLength: reply.length }, '[Chat] Response sent');

    res.json({
      reply,
      sources: relevantChunks.map(c => ({
        session_id: c.session_id,
        builder: c.builder_name,
        subdivision: c.subdivision,
        lot: c.lot_number,
        date: c.recorded_at,
        type: c.chunk_type,
        similarity: parseFloat(c.similarity?.toFixed(3) || 0),
      })),
    });

  } catch (err) {
    if (err.name === 'AbortError') {
      reqLogger.warn('[Chat] Request timed out');
      return res.status(504).json({ error: 'Chat request timed out' });
    }
    reqLogger.error({ err }, '[Chat] Error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get open action items as additional context for chat
 */
async function getActionItemContext(jobId, question) {
  // Only include if the question seems related to tasks/action items
  const taskKeywords = /action|todo|task|item|open|pending|due|follow.?up|what.*(need|should|do)/i;
  if (!taskKeywords.test(question)) return '';

  const params = [];
  let sql = `SELECT ai.*, j.builder_name, j.subdivision, j.lot_number
             FROM action_items ai
             LEFT JOIN jobs j ON ai.job_id = j.id
             WHERE ai.completed = FALSE AND ai.deleted_at IS NULL`;

  if (jobId) {
    params.push(jobId);
    sql += ` AND ai.job_id = $${params.length}`;
  }

  sql += ' ORDER BY ai.created_at DESC LIMIT 20';

  const { rows } = await db.query(sql, params);
  if (rows.length === 0) return '';

  let context = '\n\nOPEN ACTION ITEMS:\n';
  for (const item of rows) {
    const meta = [item.builder_name, item.subdivision, item.lot_number].filter(Boolean).join(' — ');
    context += `• [${meta}] ${item.description} (${item.priority})\n`;
  }
  return context;
}

module.exports = router;
