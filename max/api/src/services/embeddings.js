const fetch = require('node-fetch');
const config = require('../config');
const db = require('../db');

/**
 * Generate embedding vector from text using Ollama
 */
async function generateEmbedding(text) {
  const response = await fetch(`${config.ollama.url}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.embedModel,
      prompt: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding generation failed: ${response.status}`);
  }

  const result = await response.json();
  return result.embedding;
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
  console.log(`[Embeddings] Embedding session ${sessionId}...`);
  
  const chunks = chunkText(transcript);
  let stored = 0;

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
      console.error(`[Embeddings] Failed to embed chunk: ${err.message}`);
    }
  }

  console.log(`[Embeddings] Stored ${stored}/${chunks.length} chunks`);
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
    console.error(`[Embeddings] Failed to embed summary: ${err.message}`);
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
    console.error(`[Embeddings] Failed to embed plan analysis: ${err.message}`);
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
    WHERE 1=1
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
