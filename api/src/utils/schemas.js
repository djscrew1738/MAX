const { z } = require('zod');

/**
 * Zod schemas for LLM output validation
 * Ensures structured data from Ollama meets expected format
 */

// Action item schema
const ActionItemSchema = z.object({
  description: z.string().min(1).max(500),
  assignee: z.string().max(100).optional().nullable(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional().nullable(),
  due: z.string().max(50).optional().nullable(),
});

// Fixture change schema
const FixtureChangeSchema = z.object({
  mentioned_count: z.number().int().min(0).optional().nullable(),
  details: z.array(z.string().max(500)).optional().nullable(),
});

// Summary JSON schema from Ollama
const SummarySchema = z.object({
  builder_name: z.string().max(200).optional().nullable(),
  subdivision: z.string().max(200).optional().nullable(),
  lot_number: z.string().max(50).optional().nullable(),
  phase: z.enum(['Underground', 'Rough-In', 'Top-Out', 'Trim', 'Final', 'Other']).optional().nullable(),
  
  key_decisions: z.array(z.string().max(1000)).optional().nullable(),
  action_items: z.array(ActionItemSchema).optional().nullable(),
  fixture_changes: FixtureChangeSchema.optional().nullable(),
  flags: z.array(z.string().max(500)).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  
  // Allow additional fields but validate known ones
}).passthrough();

// Discrepancy item schema
const DiscrepancyItemSchema = z.object({
  type: z.enum(['fixture_count', 'location', 'spec', 'missing_from_plans', 'not_discussed', 'other']),
  description: z.string().min(1).max(1000),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  // Fields used by discrepancy-email.js template
  plan_says: z.string().max(500).optional().nullable(),
  conversation_says: z.string().max(500).optional().nullable(),
  recommendation: z.string().max(500).optional().nullable(),
});

// Discrepancies schema
const DiscrepanciesSchema = z.object({
  has_discrepancies: z.boolean(),
  items: z.array(DiscrepancyItemSchema).optional().nullable(),
  recommendation: z.string().max(500).optional().nullable(),
  overall_recommendation: z.string().max(500).optional().nullable(),
  match_score: z.number().min(0).max(100).optional().nullable(),
  matches: z.array(z.string().max(500)).optional().nullable(),
});

// Plan analysis schema
const PlanAnalysisSchema = z.object({
  fixtures: z.array(z.object({
    type: z.string().max(100),
    count: z.number().int().min(0).optional(),
    locations: z.array(z.string().max(200)).optional(),
  })).optional().nullable(),
  rooms: z.array(z.string().max(100)).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
}).passthrough();

/**
 * Validate summary JSON from LLM
 * Returns validated data or null if invalid
 */
function validateSummary(data) {
  try {
    return SummarySchema.parse(data);
  } catch (err) {
    return {
      parse_error: true,
      raw_response: typeof data === 'string' ? data : JSON.stringify(data),
      validation_errors: err.errors,
    };
  }
}

/**
 * Validate discrepancies JSON from LLM
 */
function validateDiscrepancies(data) {
  try {
    return DiscrepanciesSchema.parse(data);
  } catch (err) {
    return null;
  }
}

/**
 * Validate plan analysis JSON
 */
function validatePlanAnalysis(data) {
  try {
    return PlanAnalysisSchema.parse(data);
  } catch (err) {
    return null;
  }
}

/**
 * Sanitize and validate chat message
 */
const ChatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  job_id: z.number().int().positive().optional().nullable(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(10000),
  })).max(50).optional(),
});

function validateChatInput(data) {
  try {
    return ChatMessageSchema.parse(data);
  } catch (err) {
    return { error: err.errors };
  }
}

module.exports = {
  SummarySchema,
  ActionItemSchema,
  DiscrepanciesSchema,
  PlanAnalysisSchema,
  validateSummary,
  validateDiscrepancies,
  validatePlanAnalysis,
  validateChatInput,
};
