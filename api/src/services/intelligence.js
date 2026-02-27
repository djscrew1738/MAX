const config = require('../config');
const db = require('../db');
const { logger } = require('../utils/logger');

const INTEL_PROMPT = `You are Max, an AI field assistant for CTL Plumbing LLC. You are generating a rolling intelligence brief for a specific job/lot.

Below are ALL the job walk summaries for this job in chronological order. Synthesize them into a single comprehensive intelligence brief.

Your output should cover:
1. **Current Status**: What phase is this job in? What's the latest?
2. **Fixture Summary**: Final fixture count with all changes tracked
3. **Decision Timeline**: Key decisions made across all walks, in order
4. **Change Log**: What changed from original plans — upgrades, downgrades, relocations
5. **Open Items**: All unresolved action items across all walks
6. **Risk Flags**: Anything that seems like a potential issue
7. **Builder Notes**: Patterns, preferences, or things to remember about this builder
8. **Related Work**: Any mention of other lots, future work, or bulk deals

Be concise but complete. This is the "catch me up" document for this job.
Format as clean readable text, NOT JSON.`;

/**
 * Generate or update the rolling intelligence brief for a job
 */
async function updateJobIntelligence(jobId) {
  const intelLogger = logger.child({ jobId });
  intelLogger.info('[Intel] Updating intelligence');

  // Get all session summaries (excluding soft deleted)
  const { rows: sessions } = await db.query(
    `SELECT s.id, s.summary, s.summary_json, s.phase, s.recorded_at, s.discrepancies, s.duration_secs
     FROM sessions s
     WHERE s.job_id = $1 AND s.status = 'complete' AND s.deleted_at IS NULL
     ORDER BY s.recorded_at ASC`,
    [jobId]
  );

  if (sessions.length === 0) {
    intelLogger.info('[Intel] No completed sessions, skipping');
    return null;
  }

  // Get plan analyses
  const { rows: planAttachments } = await db.query(
    `SELECT a.file_name, a.analysis, a.analysis_text
     FROM attachments a
     WHERE a.job_id = $1 AND a.analysis IS NOT NULL AND a.deleted_at IS NULL`,
    [jobId]
  );

  // Get open action items
  const { rows: openActions } = await db.query(
    `SELECT ai.description, ai.priority, ai.due_date, ai.created_at
     FROM action_items ai
     WHERE ai.job_id = $1 AND ai.completed = FALSE AND ai.deleted_at IS NULL
     ORDER BY ai.priority DESC, ai.created_at ASC`,
    [jobId]
  );

  // Get job metadata
  const { rows: [job] } = await db.query(
    'SELECT * FROM jobs WHERE id = $1 AND deleted_at IS NULL', [jobId]
  );

  if (!job) {
    intelLogger.warn('[Intel] Job not found or deleted');
    return null;
  }

  // Build the context
  let context = `JOB: ${job.builder_name || 'Unknown'} — ${job.subdivision || ''} ${job.lot_number ? 'Lot ' + job.lot_number : ''}\n`;
  context += `Current Phase: ${job.phase || 'Unknown'}\n`;
  context += `Total Walks: ${sessions.length}\n\n`;

  context += '=== JOB WALK HISTORY ===\n\n';
  for (const session of sessions) {
    const date = session.recorded_at ? new Date(session.recorded_at).toLocaleDateString() : 'Unknown date';
    const dur = session.duration_secs ? `${Math.round(session.duration_secs / 60)}min` : '';
    context += `--- Walk: ${date} ${dur} (${session.phase || 'untagged'}) ---\n`;
    context += session.summary || JSON.stringify(session.summary_json) || '[no summary]';
    
    if (session.discrepancies) {
      const disc = typeof session.discrepancies === 'string' ? 
        JSON.parse(session.discrepancies) : session.discrepancies;
      if (disc?.items?.length > 0) {
        context += '\nDISCREPANCIES FOUND:\n';
        disc.items.forEach(d => {
          context += `  ⚠️ ${d.description} (${d.severity})\n`;
        });
      }
    }
    context += '\n\n';
  }

  if (planAttachments.length > 0) {
    context += '=== PLAN ANALYSES ===\n\n';
    for (const pa of planAttachments) {
      context += `Plan: ${pa.file_name}\n`;
      context += pa.analysis_text || JSON.stringify(pa.analysis);
      context += '\n\n';
    }
  }

  if (openActions.length > 0) {
    context += '=== OPEN ACTION ITEMS ===\n\n';
    for (const action of openActions) {
      const due = action.due_date ? ` (due: ${action.due_date})` : '';
      context += `• [${action.priority.toUpperCase()}] ${action.description}${due}\n`;
    }
    context += '\n';
  }

  // Generate intelligence brief with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.ollama.timeout);

  try {
    const response = await fetch(`${config.ollama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        messages: [
          { role: 'system', content: INTEL_PROMPT },
          { role: 'user', content: context },
        ],
        stream: false,
        options: { temperature: 0.3, num_predict: 3000 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Ollama failed: ${response.status}`);

    const result = await response.json();
    const intel = result.message?.content || '';

    // Save to job
    await db.query(
      'UPDATE jobs SET job_intel = $1, updated_at = NOW() WHERE id = $2',
      [intel, jobId]
    );

    intelLogger.info({ chars: intel.length }, '[Intel] Generated brief');
    return intel;

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      intelLogger.error('[Intel] Request timed out');
    } else {
      intelLogger.error({ err: err.message }, '[Intel] Failed to generate intelligence');
    }
    
    // Fallback: just concatenate summaries
    const fallback = sessions.map(s => s.summary).filter(Boolean).join('\n\n---\n\n');
    await db.query(
      'UPDATE jobs SET job_intel = $1, updated_at = NOW() WHERE id = $2',
      [fallback, jobId]
    );
    return fallback;
  }
}

/**
 * Get intelligence brief, generating if stale
 */
async function getJobIntelligence(jobId, forceRefresh = false) {
  const { rows: [job] } = await db.query(
    'SELECT job_intel, updated_at FROM jobs WHERE id = $1 AND deleted_at IS NULL', [jobId]
  );

  if (!job) return null;

  // Check if we need to refresh (if latest session is newer than intel)
  if (!forceRefresh && job.job_intel) {
    const { rows: [latest] } = await db.query(
      `SELECT MAX(processed_at) as latest FROM sessions 
       WHERE job_id = $1 AND status = 'complete' AND deleted_at IS NULL`,
      [jobId]
    );
    
    if (!latest?.latest || new Date(latest.latest) <= new Date(job.updated_at)) {
      return job.job_intel; // Still fresh
    }
  }

  // Need refresh
  return await updateJobIntelligence(jobId);
}

module.exports = { updateJobIntelligence, getJobIntelligence };
