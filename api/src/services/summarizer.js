const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const config = require('../config');

// Load the construction summary prompt
const SUMMARY_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/construction-summary.md'),
  'utf-8'
);

/**
 * Generate a structured summary from a transcript using Ollama
 */
async function summarizeTranscript(transcript, planAnalysis = null) {
  console.log('[Summarizer] Generating summary...');

  let userPrompt = `Here is the job walk transcript:\n\n${transcript}`;

  if (planAnalysis) {
    userPrompt += `\n\n---\n\nPlan/Blueprint analysis data is also available for this session:\n${JSON.stringify(planAnalysis, null, 2)}\n\nCross-reference the conversation with the plan data. Note any discrepancies between what was discussed and what the plans show.`;
  }

  const response = await fetch(`${config.ollama.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 2048,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama summarization failed (${response.status}): ${errText}`);
  }

  const result = await response.json();
  const content = result.message?.content || '';

  // Parse JSON from response (handle possible markdown fences)
  let summaryJson;
  try {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    summaryJson = JSON.parse(cleaned);
  } catch (err) {
    console.error('[Summarizer] Failed to parse JSON, storing raw text');
    summaryJson = { raw_response: content, parse_error: true };
  }

  console.log('[Summarizer] Summary generated');
  return summaryJson;
}

/**
 * Generate a readable text summary from the structured JSON
 */
function formatSummaryText(json, session = {}) {
  if (json.parse_error) {
    return json.raw_response || 'Summary generation failed — see raw transcript.';
  }

  const lines = [];
  
  lines.push('🔨 MAX — JOB WALK SUMMARY');
  lines.push('━'.repeat(40));
  
  if (json.builder_name) lines.push(`Builder:     ${json.builder_name}`);
  if (json.subdivision) lines.push(`Subdivision: ${json.subdivision}`);
  if (json.lot_number) lines.push(`Lot:         ${json.lot_number}`);
  if (json.phase) lines.push(`Phase:       ${json.phase}`);
  if (session.recorded_at) lines.push(`Date:        ${new Date(session.recorded_at).toLocaleDateString()}`);
  if (session.duration_secs) lines.push(`Duration:    ${Math.round(session.duration_secs / 60)} min`);
  
  lines.push('');

  if (json.key_decisions?.length) {
    lines.push('KEY DECISIONS');
    json.key_decisions.forEach(d => lines.push(`• ${d}`));
    lines.push('');
  }

  if (json.fixture_changes) {
    lines.push('FIXTURE CHANGES');
    if (json.fixture_changes.mentioned_count) {
      lines.push(`Count mentioned: ${json.fixture_changes.mentioned_count}`);
    }
    if (json.fixture_changes.details?.length) {
      json.fixture_changes.details.forEach(d => lines.push(`• ${d}`));
    }
    lines.push('');
  }

  if (json.action_items?.length) {
    lines.push('ACTION ITEMS');
    json.action_items.forEach(item => {
      const priority = item.priority === 'critical' ? '🔴' : item.priority === 'high' ? '🟡' : '☐';
      const due = item.due ? ` (by ${item.due})` : '';
      lines.push(`${priority} ${item.description}${due}`);
    });
    lines.push('');
  }

  if (json.flags?.length) {
    lines.push('⚠️  FLAGS');
    json.flags.forEach(f => lines.push(`• ${f}`));
    lines.push('');
  }

  if (json.notes) {
    lines.push('NOTES');
    lines.push(json.notes);
  }

  return lines.join('\n');
}

/**
 * Generate discrepancy report between conversation and plans
 */
async function generateDiscrepancies(transcript, planAnalysis) {
  if (!planAnalysis) return null;

  const prompt = `You are comparing a job walk conversation with the actual construction plans for a plumbing project.

TRANSCRIPT:
${transcript}

PLAN ANALYSIS:
${JSON.stringify(planAnalysis, null, 2)}

Identify any discrepancies between what was discussed in the conversation and what the plans show. Focus on:
- Fixture count differences
- Fixture locations that don't match
- Specs mentioned verbally that differ from plans
- Items discussed that aren't on the plans at all
- Items on plans that weren't discussed (potential oversights)

Respond ONLY with valid JSON:
{
  "has_discrepancies": true/false,
  "items": [
    {
      "type": "fixture_count|location|spec|missing_from_plans|not_discussed",
      "description": "Clear description of the mismatch",
      "severity": "low|medium|high"
    }
  ],
  "recommendation": "One sentence on what to verify"
}`;

  const response = await fetch(`${config.ollama.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: 0.2, num_predict: 1024 },
    }),
  });

  if (!response.ok) return null;

  const result = await response.json();
  try {
    const cleaned = (result.message?.content || '')
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

module.exports = { summarizeTranscript, formatSummaryText, generateDiscrepancies };
