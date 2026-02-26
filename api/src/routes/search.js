const express = require('express');
const db = require('../db');
const { logger } = require('../utils/logger');
const { searchChunks } = require('../services/embeddings');

const router = express.Router();

/**
 * GET /api/search?q=hose+bib&type=all
 * Search across transcripts, summaries, plans, and action items
 * 
 * Types: all, transcripts, summaries, plans, actions
 */
router.get('/', async (req, res) => {
  const reqLogger = logger.child({ reqId: req.id });
  
  try {
    const { q, type = 'all', job_id, limit = 20 } = req.query;

    if (!q) return res.status(400).json({ error: 'Query parameter "q" required' });

    reqLogger.info({ query: q, type, jobId: job_id }, '[Search] Query received');

    const results = {
      query: q,
      vector_results: [],
      text_results: [],
    };

    // --- Vector search (semantic) ---
    const vectorResults = await searchChunks(q, {
      jobId: job_id ? parseInt(job_id) : null,
      limit: parseInt(limit),
    });

    results.vector_results = vectorResults.map(r => ({
      chunk_id: r.id,
      session_id: r.session_id,
      job_id: r.job_id,
      type: r.chunk_type,
      content: r.content.substring(0, 300) + (r.content.length > 300 ? '...' : ''),
      section: r.section_label,
      flagged: r.is_flagged,
      builder: r.builder_name,
      subdivision: r.subdivision,
      lot: r.lot_number,
      date: r.recorded_at,
      similarity: parseFloat(r.similarity?.toFixed(3) || 0),
    }));

    // --- Full-text search (keyword) ---
    if (type === 'all' || type === 'transcripts' || type === 'summaries') {
      let ftsQuery = `
        SELECT s.id, s.title, s.phase, s.recorded_at, s.duration_secs,
               j.builder_name, j.subdivision, j.lot_number,
               ts_headline('english', COALESCE(s.transcript, ''), plainto_tsquery('english', $1),
                 'MaxWords=40,MinWords=15,StartSel=**,StopSel=**') as headline,
               ts_rank(to_tsvector('english', COALESCE(s.transcript, '') || ' ' || COALESCE(s.summary, '')),
                 plainto_tsquery('english', $1)) as rank
        FROM sessions s
        LEFT JOIN jobs j ON s.job_id = j.id
        WHERE to_tsvector('english', COALESCE(s.transcript, '') || ' ' || COALESCE(s.summary, ''))
              @@ plainto_tsquery('english', $1)
        AND s.deleted_at IS NULL
        AND j.deleted_at IS NULL
      `;
      const params = [q];

      if (job_id) {
        params.push(parseInt(job_id));
        ftsQuery += ` AND s.job_id = $${params.length}`;
      }

      params.push(parseInt(limit));
      ftsQuery += ` ORDER BY rank DESC LIMIT $${params.length}`;

      const { rows } = await db.query(ftsQuery, params);
      results.text_results = rows.map(r => ({
        session_id: r.id,
        title: r.title,
        phase: r.phase,
        builder: r.builder_name,
        subdivision: r.subdivision,
        lot: r.lot_number,
        date: r.recorded_at,
        duration: r.duration_secs,
        headline: r.headline,
        rank: parseFloat(r.rank?.toFixed(3) || 0),
      }));
    }

    // --- Action item search ---
    if (type === 'all' || type === 'actions') {
      let actionsQuery = `
        SELECT ai.*, j.builder_name, j.subdivision, j.lot_number
        FROM action_items ai
        LEFT JOIN jobs j ON ai.job_id = j.id
        WHERE ai.description ILIKE $1
        AND ai.deleted_at IS NULL
        AND j.deleted_at IS NULL
      `;
      const params = [`%${q}%`];

      if (job_id) {
        params.push(parseInt(job_id));
        actionsQuery += ` AND ai.job_id = $${params.length}`;
      }

      actionsQuery += ' ORDER BY ai.created_at DESC LIMIT 20';

      const { rows } = await db.query(actionsQuery, params);
      results.action_results = rows;
    }

    reqLogger.info({ 
      vectorCount: results.vector_results.length,
      textCount: results.text_results.length,
    }, '[Search] Results returned');

    res.json(results);

  } catch (err) {
    logger.error({ err, reqId: req.id }, '[Search] Error');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
