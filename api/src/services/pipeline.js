const db = require('../db');
const { logger } = require('../utils/logger');
const { transcribe, stripMaxCommands, parseCommands } = require('./transcription');
const { summarizeTranscript, formatSummaryText, generateDiscrepancies } = require('./summarizer');
const { embedSession, embedSummary } = require('./embeddings');
const { sendSummaryEmail } = require('./email');
const { sendDiscrepancyAlert } = require('./discrepancy-email');
const { analyzePlan, crossReference } = require('./plans');
const { updateJobIntelligence } = require('./intelligence');
const { notifySessionComplete, notifyDiscrepancies, notifyError } = require('./notifications');

/**
 * Process a complete recording session:
 * 1. Transcribe audio
 * 2. Strip Max commands
 * 3. Resolve or create job
 * 4. Summarize with Ollama
 * 5. Check discrepancies against plans
 * 6. Embed for RAG
 * 7. Email summary
 */
async function processSession(sessionId) {
  const sessionLogger = logger.child({ sessionId });
  
  sessionLogger.info('\n' + '='.repeat(50));
  sessionLogger.info('[Pipeline] Processing session');
  sessionLogger.info('='.repeat(50) + '\n');

  try {
    // Get session from DB
    const { rows: [session] } = await db.query(
      'SELECT * FROM sessions WHERE id = $1 AND deleted_at IS NULL', [sessionId]
    );
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // --- Step 1: Transcribe ---
    await updateStatus(sessionId, 'transcribing');
    const { text: rawTranscript, segments, duration } = await transcribe(session.audio_path);

    // --- Step 2: Strip commands ---
    const { cleaned: transcript, commands } = stripMaxCommands(rawTranscript);
    const commandMeta = parseCommands(commands);
    
    sessionLogger.info({ 
      transcriptLength: transcript.length, 
      commandsStripped: commands.length 
    }, '[Pipeline] Transcript processed');

    // Update session with transcript and duration
    await db.query(
      `UPDATE sessions SET transcript = $1, duration_secs = $2 WHERE id = $3`,
      [transcript, Math.round(duration), sessionId]
    );

    // --- Step 3: Auto-tag job if commanded ---
    let jobId = session.job_id;
    if (!jobId && commandMeta.jobTag) {
      jobId = await resolveJob(commandMeta.jobTag);
      if (jobId) {
        await db.query('UPDATE sessions SET job_id = $1 WHERE id = $2', [jobId, sessionId]);
      }
    }

    // --- Step 4: Get plan analysis if attachments exist ---
    let planAnalysis = null;
    if (jobId || sessionId) {
      // First, analyze any new unprocessed attachments
      const { rows: newAttachments } = await db.query(
        `SELECT id FROM attachments 
         WHERE (session_id = $1 OR job_id = $2) AND analysis IS NULL AND file_type = 'pdf' AND deleted_at IS NULL`,
        [sessionId, jobId]
      );
      for (const att of newAttachments) {
        try {
          await analyzePlan(att.id);
        } catch (err) {
          sessionLogger.error({ attachmentId: att.id, err: err.message }, '[Pipeline] Plan analysis failed');
        }
      }

      // Now fetch any available analysis
      const { rows: attachments } = await db.query(
        `SELECT analysis FROM attachments 
         WHERE (session_id = $1 OR job_id = $2) AND analysis IS NOT NULL AND deleted_at IS NULL
         LIMIT 1`,
        [sessionId, jobId]
      );
      if (attachments.length > 0) {
        planAnalysis = typeof attachments[0].analysis === 'string' ?
          JSON.parse(attachments[0].analysis) : attachments[0].analysis;
      }
    }

    // --- Step 5: Summarize ---
    await updateStatus(sessionId, 'summarizing');
    const summaryJson = await summarizeTranscript(transcript, planAnalysis);
    const summaryText = formatSummaryText(summaryJson, {
      recorded_at: session.recorded_at || session.created_at,
      duration_secs: Math.round(duration),
    });

    // Auto-resolve job from summary if we still don't have one
    if (!jobId && summaryJson.builder_name) {
      jobId = await resolveJob(null, summaryJson);
      if (jobId) {
        await db.query('UPDATE sessions SET job_id = $1 WHERE id = $2', [jobId, sessionId]);
      }
    }

    // --- Step 6: Check discrepancies ---
    let discrepancies = null;
    if (planAnalysis && !planAnalysis.error) {
      discrepancies = await crossReference(planAnalysis, summaryJson);
      if (!discrepancies) {
        // Fallback to basic discrepancy check
        discrepancies = await generateDiscrepancies(transcript, planAnalysis);
      }
    }

    // --- Step 7: Save summary ---
    await db.query(
      `UPDATE sessions SET 
        summary = $1, summary_json = $2, discrepancies = $3,
        phase = COALESCE($4, phase),
        processed_at = NOW()
       WHERE id = $5`,
      [summaryText, JSON.stringify(summaryJson), JSON.stringify(discrepancies), 
       summaryJson.phase, sessionId]
    );

    // Save action items
    if (summaryJson.action_items?.length) {
      for (const item of summaryJson.action_items) {
        await db.query(
          `INSERT INTO action_items (session_id, job_id, description, priority)
           VALUES ($1, $2, $3, $4)`,
          [sessionId, jobId, item.description, item.priority || 'normal']
        );
      }
    }

    // --- Step 8: Embed for RAG ---
    await embedSession(sessionId, jobId, transcript);
    await embedSummary(sessionId, jobId, summaryText);

    // --- Step 9: Email ---
    const emailed = await sendSummaryEmail(summaryText, summaryJson, {
      recorded_at: session.recorded_at || session.created_at,
      duration_secs: Math.round(duration),
    });

    if (emailed) {
      await db.query('UPDATE sessions SET emailed_at = NOW() WHERE id = $1', [sessionId]);
    }

    // Send discrepancy alert if any found
    if (discrepancies?.items?.length > 0) {
      await sendDiscrepancyAlert(discrepancies, {
        builder: summaryJson.builder_name,
        subdivision: summaryJson.subdivision,
        lot: summaryJson.lot_number ? `Lot ${summaryJson.lot_number}` : null,
      });
    }

    // --- Step 10: Update job intelligence ---
    if (jobId) {
      await updateJobIntelligence(jobId);
    }

    // --- Step 11: Send notifications ---
    await notifySessionComplete(sessionId, summaryJson);
    if (discrepancies?.items?.length > 0) {
      await notifyDiscrepancies(sessionId, discrepancies);
    }

    // --- Step 12: OpenSite integration ---
    try {
      const { fireWebhook, syncToJobTracker } = require('./opensite');
      await fireWebhook('session.complete', {
        session_id: sessionId,
        job_id: jobId,
        summary: summaryJson,
        has_discrepancies: discrepancies?.items?.length > 0,
      });
      if (jobId) {
        await syncToJobTracker(jobId);
      }
    } catch (err) {
      sessionLogger.info(`[Pipeline] OpenSite sync skipped: ${err.message}`);
    }

    // Done!
    await updateStatus(sessionId, 'complete');
    sessionLogger.info('\n[Pipeline] ✅ Session complete!\n');

    return { sessionId, jobId, summary: summaryJson };

  } catch (err) {
    sessionLogger.error({ err }, '[Pipeline] ❌ Error processing session');
    await db.query(
      `UPDATE sessions SET status = 'error', error_message = $1 WHERE id = $2`,
      [err.message, sessionId]
    );
    await notifyError(sessionId, err.message);
    throw err;
  }
}

/**
 * Update session status
 */
async function updateStatus(sessionId, status) {
  await db.query('UPDATE sessions SET status = $1 WHERE id = $2', [status, sessionId]);
  logger.info({ sessionId, status }, '[Pipeline] Status updated');
}

/**
 * Try to find or create a job from voice tag or summary data
 */
async function resolveJob(voiceTag, summaryJson = null) {
  const builder = summaryJson?.builder_name || null;
  const subdivision = summaryJson?.subdivision || null;
  const lot = summaryJson?.lot_number || null;

  // Try to match existing job
  if (subdivision && lot) {
    const { rows } = await db.query(
      `SELECT id FROM jobs 
       WHERE LOWER(subdivision) = LOWER($1) AND LOWER(lot_number) = LOWER($2) AND deleted_at IS NULL
       LIMIT 1`,
      [subdivision, lot]
    );
    if (rows.length > 0) return rows[0].id;
  }

  // Create new job if we have enough info
  if (subdivision || lot || builder || voiceTag) {
    const { rows } = await db.query(
      `INSERT INTO jobs (builder_name, subdivision, lot_number, notes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [builder, subdivision, lot, voiceTag ? `Voice tagged: ${voiceTag}` : null]
    );
    logger.info({ jobId: rows[0].id }, '[Pipeline] Created job');
    return rows[0].id;
  }

  return null;
}

module.exports = { processSession };
