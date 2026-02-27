const config = require('../config');
const db = require('../db');
const { logger } = require('../utils/logger');
const { sendDigestEmail } = require('./digest-email');

/**
 * Weekly Digest Service
 * 
 * Generates a comprehensive weekly report covering:
 * - All job walk activity this week
 * - Open action items across all jobs
 * - Builder activity summary
 * - Pipeline value estimate
 * - Discrepancy summary
 * - Upcoming work predictions
 */

const DIGEST_PROMPT = `You are Max, an AI field assistant for CTL Plumbing LLC in the DFW area.

Generate a concise weekly business intelligence digest from the data below. Write it like a brief you'd give a business owner on Monday morning — what happened, what needs attention, and what's coming up.

Sections to include:
1. **This Week at a Glance** — key stats (walks completed, new jobs, hours recorded)
2. **Job Updates** — what happened on each active job this week
3. **Action Items Needing Attention** — overdue or high-priority items
4. **Builder Insights** — any patterns, preferences, or things to note about builders
5. **Pipeline Estimate** — total estimated value of active work
6. **Heads Up** — anything that looks like it needs attention soon

Be direct and concise. This is for a busy plumber who wants the highlights in under 2 minutes of reading.`;

/**
 * Generate weekly digest
 */
async function generateWeeklyDigest() {
  logger.info('[Digest] Generating weekly digest...');

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // --- Gather data ---

  // Sessions this week
  const { rows: weekSessions } = await db.query(`
    SELECT s.id, s.title, s.phase, s.summary, s.duration_secs, s.recorded_at,
           j.builder_name, j.subdivision, j.lot_number,
           s.discrepancies
    FROM sessions s
    LEFT JOIN jobs j ON s.job_id = j.id
    WHERE s.status = 'complete' AND s.recorded_at >= $1 AND s.deleted_at IS NULL AND j.deleted_at IS NULL
    ORDER BY s.recorded_at DESC
  `, [weekAgo.toISOString()]);

  // All open action items
  const { rows: openActions } = await db.query(`
    SELECT ai.description, ai.priority, ai.due_date, ai.created_at,
           j.builder_name, j.subdivision, j.lot_number
    FROM action_items ai
    LEFT JOIN jobs j ON ai.job_id = j.id
    WHERE ai.completed = FALSE AND ai.deleted_at IS NULL AND j.deleted_at IS NULL
    ORDER BY 
      CASE ai.priority 
        WHEN 'critical' THEN 1 WHEN 'high' THEN 2 
        WHEN 'normal' THEN 3 ELSE 4 END,
      ai.created_at ASC
  `);

  // Active jobs summary
  const { rows: activeJobs } = await db.query(`
    SELECT j.*,
      (SELECT COUNT(*) FROM sessions s WHERE s.job_id = j.id AND s.status = 'complete' AND s.deleted_at IS NULL) as total_walks,
      (SELECT COUNT(*) FROM sessions s WHERE s.job_id = j.id AND s.recorded_at >= $1 AND s.deleted_at IS NULL) as walks_this_week,
      (SELECT COUNT(*) FROM action_items ai WHERE ai.job_id = j.id AND ai.completed = FALSE AND ai.deleted_at IS NULL) as open_items
    FROM jobs j
    WHERE j.status = 'active' AND j.deleted_at IS NULL
    ORDER BY j.updated_at DESC
  `, [weekAgo.toISOString()]);

  // Aggregate stats
  const totalMinutes = weekSessions.reduce((sum, s) => sum + (s.duration_secs || 0), 0) / 60;
  const discrepancyCount = weekSessions.filter(s => {
    const disc = typeof s.discrepancies === 'string' ? JSON.parse(s.discrepancies || '{}') : s.discrepancies;
    return disc?.items?.length > 0;
  }).length;

  // Builder activity
  const builderMap = {};
  for (const s of weekSessions) {
    const builder = s.builder_name || 'Unknown';
    if (!builderMap[builder]) builderMap[builder] = { walks: 0, lots: new Set() };
    builderMap[builder].walks++;
    if (s.lot_number) builderMap[builder].lots.add(s.lot_number);
  }

  // --- Build context for Ollama ---
  let context = `WEEKLY REPORT DATA (${weekAgo.toLocaleDateString()} — ${now.toLocaleDateString()})\n\n`;

  context += `STATS:\n`;
  context += `- Job walks completed: ${weekSessions.length}\n`;
  context += `- Total recording time: ${Math.round(totalMinutes)} minutes\n`;
  context += `- Active jobs: ${activeJobs.length}\n`;
  context += `- Open action items: ${openActions.length}\n`;
  context += `- Sessions with discrepancies: ${discrepancyCount}\n\n`;

  context += `BUILDER ACTIVITY:\n`;
  for (const [builder, data] of Object.entries(builderMap)) {
    context += `- ${builder}: ${data.walks} walks, ${data.lots.size} lots\n`;
  }
  context += '\n';

  context += `JOB WALKS THIS WEEK:\n`;
  for (const s of weekSessions) {
    const job = [s.builder_name, s.subdivision, s.lot_number].filter(Boolean).join(' — ');
    context += `- ${new Date(s.recorded_at).toLocaleDateString()}: ${job} (${s.phase || 'untagged'})\n`;
    if (s.summary) context += `  Summary: ${s.summary.substring(0, 200)}\n`;
  }
  context += '\n';

  context += `ACTIVE JOBS:\n`;
  for (const j of activeJobs) {
    context += `- ${j.builder_name || 'Unknown'} — ${j.subdivision || ''} Lot ${j.lot_number || '?'}: `;
    context += `Phase: ${j.phase || '?'}, Walks: ${j.total_walks} (${j.walks_this_week} this week), `;
    context += `Open items: ${j.open_items}\n`;
  }
  context += '\n';

  if (openActions.length > 0) {
    context += `OPEN ACTION ITEMS:\n`;
    for (const ai of openActions.slice(0, 20)) {
      const job = [ai.builder_name, ai.subdivision, ai.lot_number].filter(Boolean).join(' — ');
      const due = ai.due_date ? ` (due: ${ai.due_date})` : '';
      context += `- [${ai.priority.toUpperCase()}] ${job}: ${ai.description}${due}\n`;
    }
    if (openActions.length > 20) {
      context += `  ... and ${openActions.length - 20} more\n`;
    }
  }

  // --- Generate digest with Ollama with timeout ---
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.ollama.chatTimeout);

  try {
    const response = await fetch(`${config.ollama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        messages: [
          { role: 'system', content: DIGEST_PROMPT },
          { role: 'user', content: context },
        ],
        stream: false,
        options: { temperature: 0.4, num_predict: 3000 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Ollama failed: ${response.status}`);

    const result = await response.json();
    const digestText = result.message?.content || 'Digest generation failed.';

    // Save digest
    await db.query(
      `INSERT INTO notifications (type, title, body, data)
       VALUES ('weekly_digest', 'Weekly Digest', $1, $2)`,
      [digestText.substring(0, 200), JSON.stringify({
        full_text: digestText,
        stats: {
          walks: weekSessions.length,
          minutes: Math.round(totalMinutes),
          active_jobs: activeJobs.length,
          open_actions: openActions.length,
        },
        period_start: weekAgo.toISOString(),
        period_end: now.toISOString(),
      })]
    );

    // Send digest email
    await sendDigestEmail(digestText, {
      walks: weekSessions.length,
      minutes: Math.round(totalMinutes),
      activeJobs: activeJobs.length,
      openActions: openActions.length,
      discrepancies: discrepancyCount,
      periodStart: weekAgo,
      periodEnd: now,
    });

    logger.info('[Digest] Weekly digest generated and emailed');
    return digestText;

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.error('[Digest] Request timed out');
    } else {
      logger.error({ err: err.message }, '[Digest] Failed');
    }
    return null;
  }
}

module.exports = { generateWeeklyDigest };
