const db = require('../db');
const config = require('../config');
const { logger } = require('../utils/logger');

/**
 * OpenSite Integration Service
 * 
 * Bridges Max job walk data into OpenSite's:
 * - Pricing calculator (fixture counts → cost estimates)
 * - Proposal generator (summaries → draft proposals)
 * - Job tracker (sessions → job status updates)
 * - Lead Radar (builder mentions → lead scoring)
 */

const OPENSITE_URL = config.opensite.url;
const OPENSITE_KEY = config.opensite.apiKey;

// ============================================
// FIXTURE → PRICING BRIDGE
// ============================================

/**
 * Convert Max fixture data to OpenSite pricing format
 * Maps conversation/plan fixtures to the 3-tier pricing engine
 */
function mapFixturesToPricing(summaryJson, planAnalysis = null) {
  // Prefer plan analysis data (more accurate), fall back to conversation
  const source = planAnalysis?.total_fixtures || {};
  const conversationFixtures = summaryJson?.fixture_changes || {};

  const fixtures = {
    toilets: source.toilets || 0,
    lavatory_sinks: source.lavatory_sinks || 0,
    kitchen_sinks: source.kitchen_sinks || 0,
    tubs: source.tubs || 0,
    showers: source.showers || 0,
    hose_bibs: source.hose_bibs || 0,
    water_heaters: source.water_heaters || 0,
    dishwashers: source.dishwashers || 0,
    washing_machines: source.washing_machines || 0,
    ice_makers: source.ice_makers || 0,
    gas_lines: source.gas_lines || 0,
    floor_drains: source.floor_drains || 0,
    cleanouts: source.cleanouts || 0,
  };

  // Total fixture count
  fixtures.total = Object.values(fixtures).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);

  // Detect tier from conversation context
  let tier = 'production'; // default
  const keywords = JSON.stringify(summaryJson).toLowerCase();
  if (keywords.includes('custom') || keywords.includes('premium') || keywords.includes('upgrade')) {
    tier = keywords.includes('premium') ? 'premium' : 'custom';
  }

  return {
    fixtures,
    tier,
    source: planAnalysis ? 'plans' : 'conversation',
    confidence: planAnalysis ? 'high' : 'medium',
  };
}

/**
 * Generate a price estimate using OpenSite's pricing engine
 * Falls back to local calculation if OpenSite is unavailable
 */
async function generatePriceEstimate(fixtureData, jobInfo = {}) {
  // Try OpenSite API first
  if (OPENSITE_URL && OPENSITE_KEY) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(`${OPENSITE_URL}/api/pricing/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': OPENSITE_KEY,
        },
        body: JSON.stringify({
          fixtures: fixtureData.fixtures,
          tier: fixtureData.tier,
          builder: jobInfo.builder_name,
          subdivision: jobInfo.subdivision,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const result = await response.json();
        return {
          source: 'opensite',
          ...result,
        };
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.warn('[OpenSite] Pricing API timed out');
      } else {
        logger.info('[OpenSite] Pricing API unavailable, using local estimate');
      }
    }
  }

  // Local fallback pricing (simplified CTL rates)
  return calculateLocalEstimate(fixtureData);
}

/**
 * Local pricing fallback based on CTL's rate structure
 */
function calculateLocalEstimate(fixtureData) {
  const { fixtures, tier } = fixtureData;

  // Base rates per fixture type (Production tier)
  const rates = {
    production: {
      toilets: 185, lavatory_sinks: 145, kitchen_sinks: 195,
      tubs: 225, showers: 275, hose_bibs: 85,
      water_heaters: 350, dishwashers: 95, washing_machines: 125,
      ice_makers: 75, gas_lines: 195, floor_drains: 125, cleanouts: 95,
    },
    custom: {
      toilets: 245, lavatory_sinks: 195, kitchen_sinks: 265,
      tubs: 325, showers: 395, hose_bibs: 115,
      water_heaters: 475, dishwashers: 125, washing_machines: 165,
      ice_makers: 95, gas_lines: 265, floor_drains: 165, cleanouts: 125,
    },
    premium: {
      toilets: 325, lavatory_sinks: 275, kitchen_sinks: 365,
      tubs: 475, showers: 575, hose_bibs: 145,
      water_heaters: 625, dishwashers: 165, washing_machines: 215,
      ice_makers: 125, gas_lines: 345, floor_drains: 225, cleanouts: 165,
    },
  };

  const tierRates = rates[tier] || rates.production;
  const lineItems = [];
  let total = 0;

  for (const [type, count] of Object.entries(fixtures)) {
    if (type === 'total' || count === 0) continue;
    const rate = tierRates[type] || 150;
    const subtotal = rate * count;
    total += subtotal;
    lineItems.push({ type, count, rate, subtotal });
  }

  // Phase breakdown estimate (typical split)
  const phaseBreakdown = {
    underground: Math.round(total * 0.25),
    rough_in: Math.round(total * 0.35),
    top_out: Math.round(total * 0.15),
    trim: Math.round(total * 0.20),
    final: Math.round(total * 0.05),
  };

  return {
    source: 'local_estimate',
    tier,
    line_items: lineItems,
    subtotal: total,
    tax_estimate: Math.round(total * 0.0825), // TX sales tax
    total_estimate: Math.round(total * 1.0825),
    phase_breakdown: phaseBreakdown,
    fixture_count: fixtures.total,
    disclaimer: 'Estimate based on standard rates. Final pricing may vary.',
  };
}

// ============================================
// PROPOSAL GENERATION BRIDGE
// ============================================

/**
 * Generate a draft proposal from Max session data
 */
async function generateProposalDraft(sessionId) {
  const { rows: [session] } = await db.query(
    `SELECT s.*, j.builder_name, j.subdivision, j.lot_number, j.address
     FROM sessions s
     LEFT JOIN jobs j ON s.job_id = j.id
     WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [sessionId]
  );

  if (!session) throw new Error('Session not found');

  const summaryJson = typeof session.summary_json === 'string' ?
    JSON.parse(session.summary_json) : session.summary_json;

  // Get plan analysis
  let planAnalysis = null;
  const { rows: attachments } = await db.query(
    'SELECT analysis FROM attachments WHERE session_id = $1 AND analysis IS NOT NULL AND deleted_at IS NULL LIMIT 1',
    [sessionId]
  );
  if (attachments.length > 0) {
    planAnalysis = typeof attachments[0].analysis === 'string' ?
      JSON.parse(attachments[0].analysis) : attachments[0].analysis;
  }

  // Map fixtures and get pricing
  const fixtureData = mapFixturesToPricing(summaryJson, planAnalysis);
  const pricing = await generatePriceEstimate(fixtureData, {
    builder_name: session.builder_name,
    subdivision: session.subdivision,
  });

  // Generate proposal text via Ollama with timeout
  const proposalPrompt = `You are generating a professional plumbing proposal for CTL Plumbing LLC based on a job walk.

JOB DETAILS:
Builder: ${session.builder_name || 'N/A'}
Subdivision: ${session.subdivision || 'N/A'}
Lot: ${session.lot_number || 'N/A'}
Phase: ${session.phase || 'All phases'}

FIXTURE SUMMARY:
${JSON.stringify(fixtureData.fixtures, null, 2)}

PRICING:
${JSON.stringify(pricing, null, 2)}

JOB WALK NOTES:
${session.summary || 'No summary available'}

Generate a professional proposal that includes:
1. Header with CTL Plumbing LLC info
2. Scope of work based on the fixtures and conversation
3. Phase-by-phase breakdown with pricing
4. Terms and conditions (Net 30, warranty info)
5. Signature lines

Keep it professional, concise, and ready to send. Format as clean text.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.ollama.timeout);

  try {
    const response = await fetch(`${config.ollama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        messages: [{ role: 'user', content: proposalPrompt }],
        stream: false,
        options: { temperature: 0.3, num_predict: 3000 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const result = await response.json();
    const proposalText = result.message?.content || '';

    return {
      session_id: sessionId,
      job: {
        builder: session.builder_name,
        subdivision: session.subdivision,
        lot: session.lot_number,
        address: session.address,
      },
      fixtures: fixtureData,
      pricing,
      proposal_text: proposalText,
      generated_at: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.error('[OpenSite] Proposal generation timed out');
    }
    throw err;
  }
}

// ============================================
// JOB TRACKER SYNC
// ============================================

/**
 * Sync Max session data to OpenSite job tracker
 */
async function syncToJobTracker(jobId) {
  if (!OPENSITE_URL || !OPENSITE_KEY) return null;

  const { rows: [job] } = await db.query(
    `SELECT j.*, 
      (SELECT COUNT(*) FROM sessions s WHERE s.job_id = j.id AND s.status = 'complete' AND s.deleted_at IS NULL) as walk_count,
      (SELECT COUNT(*) FROM action_items ai WHERE ai.job_id = j.id AND ai.completed = FALSE AND ai.deleted_at IS NULL) as open_actions,
      (SELECT MAX(recorded_at) FROM sessions WHERE job_id = j.id AND deleted_at IS NULL) as last_walk
     FROM jobs j WHERE j.id = $1 AND j.deleted_at IS NULL`,
    [jobId]
  );

  if (!job) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${OPENSITE_URL}/api/jobs/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': OPENSITE_KEY,
      },
      body: JSON.stringify({
        source: 'max',
        builder_name: job.builder_name,
        subdivision: job.subdivision,
        lot_number: job.lot_number,
        address: job.address,
        phase: job.phase,
        status: job.status,
        fixture_count: job.fixture_count,
        walk_count: job.walk_count,
        open_actions: job.open_actions,
        last_walk: job.last_walk,
        job_intel: job.job_intel,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json();
      logger.info({ jobId, opensiteJobId: result.opensite_job_id }, '[OpenSite] Job synced');
      return result;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.warn({ jobId }, '[OpenSite] Sync timed out');
    } else {
      logger.info({ jobId, err: err.message }, '[OpenSite] Sync failed');
    }
  }

  return null;
}

// ============================================
// LEAD SCORING BRIDGE
// ============================================

/**
 * Extract lead intelligence from job walks for Lead Radar
 */
async function extractLeadIntel(jobId) {
  const { rows: sessions } = await db.query(
    `SELECT summary_json FROM sessions 
     WHERE job_id = $1 AND status = 'complete' AND deleted_at IS NULL
     ORDER BY recorded_at DESC`,
    [jobId]
  );

  if (sessions.length === 0) return null;

  // Aggregate builder behavior signals
  const signals = {
    total_walks: sessions.length,
    mentions_future_lots: false,
    mentions_bulk_pricing: false,
    upgrade_tendency: 0,  // +1 for upgrades, -1 for downgrades
    responsiveness: 'unknown',
    change_frequency: 0,
    estimated_annual_lots: null,
  };

  for (const session of sessions) {
    const json = typeof session.summary_json === 'string' ?
      JSON.parse(session.summary_json) : session.summary_json;

    if (!json) continue;

    const notes = (json.notes || '').toLowerCase();
    const decisions = (json.key_decisions || []).join(' ').toLowerCase();

    if (notes.includes('lot') && (notes.includes('future') || notes.includes('next') || notes.includes('more'))) {
      signals.mentions_future_lots = true;
    }
    if (notes.includes('bulk') || notes.includes('all five') || notes.includes('volume')) {
      signals.mentions_bulk_pricing = true;
    }
    if (decisions.includes('upgrade')) signals.upgrade_tendency++;
    if (decisions.includes('downgrade')) signals.upgrade_tendency--;

    signals.change_frequency += (json.fixture_changes?.details?.length || 0);
  }

  // Try to extract lot count from notes
  for (const session of sessions) {
    const json = typeof session.summary_json === 'string' ?
      JSON.parse(session.summary_json) : session.summary_json;
    const notes = json?.notes || '';
    const lotMatch = notes.match(/(\d+)\s*lots?\b/i);
    if (lotMatch) {
      signals.estimated_annual_lots = parseInt(lotMatch[1]);
      break;
    }
  }

  // Calculate lead score (0-100)
  let score = 50; // base
  if (signals.total_walks >= 3) score += 10;
  if (signals.mentions_future_lots) score += 15;
  if (signals.mentions_bulk_pricing) score += 10;
  if (signals.upgrade_tendency > 0) score += 5;
  if (signals.estimated_annual_lots && signals.estimated_annual_lots >= 10) score += 10;

  signals.lead_score = Math.min(100, score);

  return signals;
}

// ============================================
// WEBHOOK SYSTEM
// ============================================

/**
 * Fire webhooks to OpenSite when events happen in Max
 */
async function fireWebhook(event, data) {
  const webhookUrl = config.opensite.webhookUrl;
  if (!webhookUrl) return;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-webhook-source': 'max',
        'x-webhook-event': event,
      },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        data,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    logger.info({ event }, '[Webhook] Fired');
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.warn({ event }, '[Webhook] Timed out');
    } else {
      logger.info({ event, err: err.message }, '[Webhook] Failed');
    }
  }
}

module.exports = {
  mapFixturesToPricing,
  generatePriceEstimate,
  generateProposalDraft,
  syncToJobTracker,
  extractLeadIntel,
  fireWebhook,
};
