'use strict';

const {
  validateSummary,
  validateDiscrepancies,
  validatePlanAnalysis,
  validateChatInput,
} = require('../../utils/schemas');

describe('validateSummary', () => {
  it('accepts a valid minimal summary object', () => {
    const result = validateSummary({});
    expect(result).toEqual({});
  });

  it('accepts a fully populated summary', () => {
    const input = {
      builder_name: 'Smith Homes',
      subdivision: 'Oak Creek',
      lot_number: '42',
      phase: 'Rough-In',
      key_decisions: ['Use 2-inch pipe for main line'],
      action_items: [
        { description: 'Verify fixture count', priority: 'high' },
      ],
      fixture_changes: {
        mentioned_count: 2,
        details: ['Added hose bib', 'Moved toilet'],
      },
      flags: ['Check with inspector before proceeding'],
      notes: 'Builder wants to schedule re-inspection.',
    };
    const result = validateSummary(input);
    expect(result.builder_name).toBe('Smith Homes');
    expect(result.phase).toBe('Rough-In');
    expect(result.action_items).toHaveLength(1);
  });

  it('rejects an invalid phase enum value', () => {
    const result = validateSummary({ phase: 'Framing' });
    expect(result.parse_error).toBe(true);
    expect(result.validation_errors).toBeDefined();
  });

  it('rejects action items with too-long description', () => {
    const result = validateSummary({
      action_items: [{ description: 'x'.repeat(501) }],
    });
    expect(result.parse_error).toBe(true);
  });

  it('rejects action items with invalid priority', () => {
    const result = validateSummary({
      action_items: [{ description: 'Fix pipe', priority: 'urgent' }],
    });
    expect(result.parse_error).toBe(true);
  });

  it('accepts all valid phase values', () => {
    const phases = ['Underground', 'Rough-In', 'Top-Out', 'Trim', 'Final', 'Other'];
    phases.forEach(phase => {
      const result = validateSummary({ phase });
      expect(result.phase).toBe(phase);
    });
  });

  it('allows extra passthrough fields in the summary', () => {
    const result = validateSummary({ custom_field: 'extra data', phase: 'Trim' });
    expect(result.custom_field).toBe('extra data');
  });

  it('handles non-object input gracefully', () => {
    const result = validateSummary('not an object');
    expect(result.parse_error).toBe(true);
  });
});

describe('validateDiscrepancies', () => {
  it('accepts valid discrepancy report with no items', () => {
    const result = validateDiscrepancies({
      has_discrepancies: false,
      items: [],
      recommendation: 'All clear',
    });
    expect(result).not.toBeNull();
    expect(result.has_discrepancies).toBe(false);
  });

  it('accepts valid discrepancy report with items', () => {
    const result = validateDiscrepancies({
      has_discrepancies: true,
      items: [
        {
          type: 'fixture_count',
          description: 'Plans show 3 toilets, conversation mentions 2',
          severity: 'high',
        },
      ],
      recommendation: 'Verify toilet count on-site',
    });
    expect(result).not.toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('fixture_count');
  });

  it('accepts all valid discrepancy type values', () => {
    const types = [
      'fixture_count',
      'location',
      'spec',
      'missing_from_plans',
      'not_discussed',
      'other',
    ];
    types.forEach(type => {
      const result = validateDiscrepancies({
        has_discrepancies: true,
        items: [{ type, description: 'test', severity: 'low' }],
      });
      expect(result).not.toBeNull();
    });
  });

  it('returns null for invalid severity value', () => {
    const result = validateDiscrepancies({
      has_discrepancies: true,
      items: [{ type: 'other', description: 'test', severity: 'extreme' }],
    });
    expect(result).toBeNull();
  });

  it('returns null when has_discrepancies is missing', () => {
    const result = validateDiscrepancies({ items: [] });
    expect(result).toBeNull();
  });

  it('returns null for completely invalid input', () => {
    expect(validateDiscrepancies(null)).toBeNull();
    expect(validateDiscrepancies('invalid')).toBeNull();
    expect(validateDiscrepancies(42)).toBeNull();
  });
});

describe('validatePlanAnalysis', () => {
  it('accepts empty object', () => {
    const result = validatePlanAnalysis({});
    expect(result).not.toBeNull();
  });

  it('accepts fully populated plan analysis', () => {
    const result = validatePlanAnalysis({
      fixtures: [
        { type: 'toilet', count: 3, locations: ['Master Bath', 'Hall Bath'] },
        { type: 'sink', count: 4 },
      ],
      rooms: ['Master Bath', 'Hall Bath', 'Kitchen'],
      notes: 'All rough-in per plan set A3',
    });
    expect(result).not.toBeNull();
    expect(result.fixtures).toHaveLength(2);
    expect(result.rooms).toHaveLength(3);
  });

  it('allows passthrough fields', () => {
    const result = validatePlanAnalysis({ confidence: 'high', extra: 'data' });
    expect(result).not.toBeNull();
    expect(result.confidence).toBe('high');
  });

  it('returns null for invalid fixture count (negative)', () => {
    const result = validatePlanAnalysis({
      fixtures: [{ type: 'toilet', count: -1 }],
    });
    expect(result).toBeNull();
  });

  it('returns null for non-integer fixture count', () => {
    const result = validatePlanAnalysis({
      fixtures: [{ type: 'sink', count: 2.5 }],
    });
    expect(result).toBeNull();
  });
});

describe('validateChatInput', () => {
  it('accepts a valid chat message', () => {
    const result = validateChatInput({ message: 'What fixtures are on the plans?' });
    expect(result.message).toBe('What fixtures are on the plans?');
  });

  it('accepts a message with optional job_id and history', () => {
    const result = validateChatInput({
      message: 'How many toilets?',
      job_id: 5,
      history: [
        { role: 'user', content: 'Tell me about job 5' },
        { role: 'assistant', content: 'Job 5 is at Oak Creek, Lot 12.' },
      ],
    });
    expect(result.message).toBe('How many toilets?');
    expect(result.job_id).toBe(5);
    expect(result.history).toHaveLength(2);
  });

  it('returns an error for an empty message', () => {
    const result = validateChatInput({ message: '' });
    expect(result.error).toBeDefined();
  });

  it('returns an error for a message over 2000 characters', () => {
    const result = validateChatInput({ message: 'x'.repeat(2001) });
    expect(result.error).toBeDefined();
  });

  it('returns an error for a negative job_id', () => {
    const result = validateChatInput({ message: 'test', job_id: -1 });
    expect(result.error).toBeDefined();
  });

  it('returns an error for an invalid history role', () => {
    const result = validateChatInput({
      message: 'test',
      history: [{ role: 'admin', content: 'hello' }],
    });
    expect(result.error).toBeDefined();
  });

  it('returns an error when message is missing entirely', () => {
    const result = validateChatInput({});
    expect(result.error).toBeDefined();
  });

  it('accepts all valid history roles', () => {
    const result = validateChatInput({
      message: 'hello',
      history: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'system', content: 'c' },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.history).toHaveLength(3);
  });
});
