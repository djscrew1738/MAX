const express = require('express');
const fetch = require('node-fetch');
const db = require('../db');
const config = require('../config');
const { searchChunks } = require('../services/embeddings');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

const CHAT_SYSTEM_PROMPT = `You are Max, an AI field assistant for CTL Plumbing LLC, a new construction plumbing company in the Dallas-Fort Worth area.

You have access to transcripts, summaries, and plan analyses from job walk recordings. When answering questions, use ONLY the provided context from real recordings. If you don't have enough information, say so — never make up job details.

Key context about CTL Plumbing:
- Works five phases: Underground, Rough-In, Top-Out, Trim, Final
- Common builders: DR Horton, Horizon Homes, and various custom builders
- Tracks fixtures, change orders, action items, and discrepancies between plans and conversations

Be concise and direct. You're talking to the owner who's probably on a job site — give quick, useful answers. Use specific details from the recordings when available.`;

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
             WHERE ai.completed = FALSE`;

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

/**
 * POST /api/chat
 * RAG-powered chat with Max
 */
router.post('/', asyncHandler(async (req, res) => {
  const { message, job_id, history = [] } = req.body;

  if (!message) {
    const error = new Error('No message provided');
    error.statusCode = 400;
    throw error;
  }

  console.log(`[Chat] Query: "${message.substring(0, 80)}..."`);

  // --- Step 1: Search for relevant context ---
  const relevantChunks = await searchChunks(message, {
    jobId: job_id ? parseInt(job_id) : null,
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

  // Add conversation history (last 10 turns)
  const recentHistory = history.slice(-10);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add the current question with context
  let userMessage = message;
  if (context) userMessage += context;
  if (actionContext) userMessage += actionContext;
  messages.push({ role: 'user', content: userMessage });

  // --- Step 4: Get response from Ollama ---
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
  });

  if (!response.ok) {
    throw new Error(`Ollama chat failed: ${response.status}`);
  }

  const result = await response.json();
  const reply = result.message?.content || "Sorry, I couldn't generate a response.";

  // --- Step 5: Save to chat history ---
  await db.query(
    `INSERT INTO chat_messages (role, content) VALUES ('user', $1)`,
    [message]
  );
  await db.query(
    `INSERT INTO chat_messages (role, content, context_used) VALUES ('assistant', $1, $2)`,
    [reply, JSON.stringify(relevantChunks.map(c => ({ id: c.id, similarity: c.similarity })))]
  );

  console.log(`[Chat] Response: ${reply.substring(0, 80)}...`);

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
}));

module.exports = router;