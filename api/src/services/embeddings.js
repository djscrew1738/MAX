const fetch = require('node-fetch');
const config = require('../config');
const db = require('../db');
const { logger } = require('../utils/logger');
const { sanitizeForLLM } = require('../middlewares/security');

/**
 * Generate embedding vector from text using Ollama
 * Includes timeout handling and input sanitization
 */
async function generateEmbedding(text) {
  // Sanitize input
  const sanitizedText = sanitizeForLLM(text).substring(0, 8000); // Limit length
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.ollama.embeddingTimeout);

  try {
    const response = await fetch(`${config.ollama.url}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.embedModel,
        prompt: sanitizedText,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Embedding generation failed: ${response.status}`);
    }

    const result = await response.json();
    return result.embedding;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Embedding generation timed out after ${config.ollama.embeddingTimeout}ms`);
    }
    throw err;
  }
}

/**
 * Chunk a transcript into overlapping pieces for embedding
 */
function chunkText(text, { chunkSize = 500, overlap = 100 } = {}) {
  const words = text.split(/\s+/);
  const chunks = [];
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 20) {
      chunks.push(chunk);
    }
  }
  
  return chunks;
}

/**
 * Embed and store transcript chunks for a session
 */
async function embedSession(sessionId, jobId, transcript, segments = []) {
  logger.info({ sessionId }, '[Embeddings] Embedding session...');
  
  const chunks = chunkText(transcript);
  let stored = 0;
  let failed = 0;

  for (const chunk of chunks) {
    try {
      const embedding = await generateEmbedding(chunk);
      const vectorStr = `[${embedding.join(',')}]`;

      await db.query(
        `INSERT INTO chunks (session_id, job_id, chunk_type, content, embedding)
         VALUES ($1, $2, 'transcript', $3, $4::vector)`,
        [sessionId, jobId, chunk, vectorStr]
      );
      stored++;
    } catch (err) {
      failed++;
      logger.error({ err: err.message, sessionId, chunkIndex: stored + failed }, '[Embeddings] Failed to embed chunk');
    }
  }

  logger.info({ sessionId, stored, failed, total: chunks.length }, '[Embeddings] Complete');
  return stored;
}

/**
 * Embed a summary and store it
 */
async function embedSummary(sessionId, jobId, summaryText) {
  try {
    const embedding = await generateEmbedding(summaryText);
    const vectorStr = `[${embedding.join(',')}]`;

    await db.query(
      `INSERT INTO chunks (session_id, job_id, chunk_type, content, embedding)
       VALUES ($1, $2, 'summary', $3, $4::vector)`,
      [sessionId, jobId, summaryText, vectorStr]
    );
  } catch (err) {
    logger.error({ err: err.message, sessionId }, '[Embeddings] Failed to embed summary');
  }
}

/**
 * Embed plan analysis text
 */
async function embedPlanAnalysis(sessionId, jobId, analysisText) {
  try {
    const embedding = await generateEmbedding(analysisText);
    const vectorStr = `[${embedding.join(',')}]`;

    await db.query(
      `INSERT INTO chunks (session_id, job_id, chunk_type, content, embedding)
       VALUES ($1, $2, 'plan_analysis', $3, $4::vector)`,
      [sessionId, jobId, analysisText, vectorStr]
    );
  } catch (err) {
    logger.error({ err: err.message, sessionId }, '[Embeddings] Failed to embed plan analysis');
  }
}

/**
 * Search for relevant chunks using vector similarity
 */
async function searchChunks(queryText, { jobId = null, limit = 10 } = {}) {
  const embedding = await generateEmbedding(queryText);
  const vectorStr = `[${embedding.join(',')}]`;

  let sql = `
    SELECT c.*, s.title as session_title, s.recorded_at,
           j.builder_name, j.subdivision, j.lot_number,
           1 - (c.embedding <=> $1::vector) as similarity
    FROM chunks c
    LEFT JOIN sessions s ON c.session_id = s.id
    LEFT JOIN jobs j ON c.job_id = j.id
    WHERE c.deleted_at IS NULL
  `;
  const params = [vectorStr];

  if (jobId) {
    params.push(jobId);
    sql += ` AND c.job_id = $${params.length}`;
  }

  sql += ` ORDER BY c.embedding <=> $1::vector LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await db.query(sql, params);
  return result.rows;
}

module.exports = {
  generateEmbedding,
  chunkText,
  embedSession,
  embedSummary,
  embedPlanAnalysis,
  searchChunks,
};
