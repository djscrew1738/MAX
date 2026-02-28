'use strict';

// ---------------------------------------------------------------------------
// Mock all external dependencies before requiring the pipeline module
// ---------------------------------------------------------------------------
jest.mock('../../db');
jest.mock('../../services/transcription');
jest.mock('../../services/summarizer');
jest.mock('../../services/embeddings');
jest.mock('../../services/email');
jest.mock('../../services/discrepancy-email');
jest.mock('../../services/plans');
jest.mock('../../services/intelligence');
jest.mock('../../services/notifications');
jest.mock('../../services/opensite');
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

const db = require('../../db');
const { transcribe, stripMaxCommands, parseCommands } = require('../../services/transcription');
const { summarizeTranscript, formatSummaryText, generateDiscrepancies } = require('../../services/summarizer');
const { embedSession, embedSummary } = require('../../services/embeddings');
const { sendSummaryEmail } = require('../../services/email');
const { sendDiscrepancyAlert } = require('../../services/discrepancy-email');
const { analyzePlan, crossReference } = require('../../services/plans');
const { updateJobIntelligence } = require('../../services/intelligence');
const { notifySessionComplete, notifyDiscrepancies, notifyError } = require('../../services/notifications');

const { processSession } = require('../../services/pipeline');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSession(overrides = {}) {
  return {
    id: 1,
    audio_path: '/uploads/test.m4a',
    job_id: null,
    recorded_at: '2024-01-15T10:00:00Z',
    created_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function makeDbQueryFactory(sessionRow, jobRow = null) {
  // Returns a db.query mock that returns appropriate data for each SQL call
  return jest.fn().mockImplementation((sql) => {
    if (/SELECT \* FROM sessions/.test(sql)) {
      return Promise.resolve({ rows: [sessionRow] });
    }
    if (/SELECT id FROM attachments/.test(sql)) {
      return Promise.resolve({ rows: [] }); // no new attachments
    }
    if (/SELECT analysis FROM attachments/.test(sql)) {
      return Promise.resolve({ rows: [] }); // no existing analysis
    }
    if (/SELECT id FROM jobs/.test(sql)) {
      return Promise.resolve({ rows: jobRow ? [jobRow] : [] });
    }
    if (/INSERT INTO jobs/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 99 }] });
    }
    if (/INSERT INTO action_items/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }
    // All UPDATE queries
    return Promise.resolve({ rows: [] });
  });
}

// ---------------------------------------------------------------------------
// Setup defaults for all mocked services
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();

  transcribe.mockResolvedValue({
    text: 'Two toilets in master bath.',
    segments: [],
    duration: 120,
  });

  stripMaxCommands.mockImplementation((text) => ({
    cleaned: text,
    commands: [],
  }));

  parseCommands.mockReturnValue({
    roomMarkers: [],
    flags: [],
    jobTag: null,
    planAttachRequested: false,
    photoRequested: false,
  });

  summarizeTranscript.mockResolvedValue({
    builder_name: 'Smith Homes',
    subdivision: 'Oak Creek',
    lot_number: '42',
    phase: 'Rough-In',
    action_items: [],
  });

  formatSummaryText.mockReturnValue('Summary: two toilets in master bath.');

  crossReference.mockResolvedValue(null);
  generateDiscrepancies.mockResolvedValue(null);
  embedSession.mockResolvedValue(undefined);
  embedSummary.mockResolvedValue(undefined);
  sendSummaryEmail.mockResolvedValue(true);
  sendDiscrepancyAlert.mockResolvedValue(undefined);
  analyzePlan.mockResolvedValue({});
  updateJobIntelligence.mockResolvedValue(undefined);
  notifySessionComplete.mockResolvedValue(undefined);
  notifyDiscrepancies.mockResolvedValue(undefined);
  notifyError.mockResolvedValue(undefined);

  db.query = makeDbQueryFactory(makeSession());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('processSession', () => {
  it('completes successfully for a basic session with no job or attachments', async () => {
    const result = await processSession(1);
    expect(result.sessionId).toBe(1);
    expect(transcribe).toHaveBeenCalledWith('/uploads/test.m4a');
    expect(summarizeTranscript).toHaveBeenCalled();
    expect(embedSession).toHaveBeenCalled();
    expect(embedSummary).toHaveBeenCalled();
    expect(sendSummaryEmail).toHaveBeenCalled();
    expect(notifySessionComplete).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it('throws and marks session as error when session is not found', async () => {
    db.query = jest.fn().mockImplementation((sql) => {
      if (/SELECT \* FROM sessions/.test(sql)) {
        return Promise.resolve({ rows: [] }); // not found
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(processSession(99)).rejects.toThrow('Session 99 not found');
    expect(notifyError).toHaveBeenCalledWith(99, expect.stringContaining('not found'));
  });

  it('throws and notifies on transcription failure', async () => {
    transcribe.mockRejectedValue(new Error('Whisper server unreachable'));
    await expect(processSession(1)).rejects.toThrow('Whisper server unreachable');
    expect(notifyError).toHaveBeenCalledWith(1, 'Whisper server unreachable');
  });

  it('saves error_message to database on failure', async () => {
    transcribe.mockRejectedValue(new Error('transcription failed'));
    const queryCalls = [];
    const origQuery = db.query;
    db.query = jest.fn().mockImplementation((sql, ...args) => {
      queryCalls.push(sql);
      return origQuery(sql, ...args);
    });

    try { await processSession(1); } catch {}

    const errorUpdate = queryCalls.find(sql => /status.*error/.test(sql));
    expect(errorUpdate).toBeDefined();
  });

  it('emails the summary and records emailed_at when email succeeds', async () => {
    sendSummaryEmail.mockResolvedValue(true);
    await processSession(1);
    const updateCalls = db.query.mock.calls.map(c => c[0]);
    expect(updateCalls.some(sql => /emailed_at/.test(sql))).toBe(true);
  });

  it('skips emailed_at update when email is not sent', async () => {
    sendSummaryEmail.mockResolvedValue(false);
    await processSession(1);
    const updateCalls = db.query.mock.calls.map(c => c[0]);
    expect(updateCalls.some(sql => /emailed_at/.test(sql))).toBe(false);
  });

  it('sends discrepancy alert when discrepancies are found', async () => {
    crossReference.mockResolvedValue({
      items: [
        { category: 'fixture_count', severity: 'high', recommendation: 'Verify' },
      ],
      match_score: 60,
    });

    // Provide a plan analysis so the discrepancy path is triggered
    db.query = jest.fn().mockImplementation((sql) => {
      if (/SELECT \* FROM sessions/.test(sql)) {
        return Promise.resolve({ rows: [makeSession({ job_id: 10 })] });
      }
      if (/SELECT id FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT analysis FROM attachments/.test(sql)) {
        return Promise.resolve({
          rows: [{ analysis: JSON.stringify({ document_type: 'floor_plan', total_fixtures: {} }) }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await processSession(1);
    expect(sendDiscrepancyAlert).toHaveBeenCalled();
    expect(notifyDiscrepancies).toHaveBeenCalled();
  });

  it('does NOT send discrepancy alert when no discrepancies exist', async () => {
    crossReference.mockResolvedValue({ items: [], match_score: 100 });
    await processSession(1);
    expect(sendDiscrepancyAlert).not.toHaveBeenCalled();
    expect(notifyDiscrepancies).not.toHaveBeenCalled();
  });

  it('resolves a job by voice tag from parseCommands', async () => {
    parseCommands.mockReturnValue({
      roomMarkers: [],
      flags: [],
      jobTag: 'oak creek lot 42',
      planAttachRequested: false,
      photoRequested: false,
    });

    db.query = jest.fn().mockImplementation((sql) => {
      if (/SELECT \* FROM sessions/.test(sql)) {
        return Promise.resolve({ rows: [makeSession({ job_id: null })] });
      }
      // Simulate no existing job found, so one gets created
      if (/SELECT id FROM jobs/.test(sql)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO jobs/.test(sql)) return Promise.resolve({ rows: [{ id: 77 }] });
      if (/SELECT id FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT analysis FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await processSession(1);
    // The job was auto-created from the voice tag
    expect(result.jobId).toBe(77);
  });

  it('resolves a job from summary data when no voice tag is present', async () => {
    summarizeTranscript.mockResolvedValue({
      builder_name: 'Summit Builders',
      subdivision: 'Maple Ridge',
      lot_number: '7',
      phase: 'Trim',
      action_items: [],
    });

    db.query = jest.fn().mockImplementation((sql) => {
      if (/SELECT \* FROM sessions/.test(sql)) {
        return Promise.resolve({ rows: [makeSession({ job_id: null })] });
      }
      if (/SELECT id FROM jobs/.test(sql)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO jobs/.test(sql)) return Promise.resolve({ rows: [{ id: 55 }] });
      if (/SELECT id FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT analysis FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await processSession(1);
    expect(result.jobId).toBe(55);
  });

  it('saves action items when the summary contains them', async () => {
    summarizeTranscript.mockResolvedValue({
      builder_name: 'Test Builder',
      phase: 'Underground',
      action_items: [
        { description: 'Verify cleanout location', priority: 'high' },
        { description: 'Re-check pipe slope', priority: 'normal' },
      ],
    });

    const insertCalls = [];
    db.query = jest.fn().mockImplementation((sql, params) => {
      if (/SELECT \* FROM sessions/.test(sql)) {
        return Promise.resolve({ rows: [makeSession()] });
      }
      if (/INSERT INTO action_items/.test(sql)) {
        insertCalls.push(params);
        return Promise.resolve({ rows: [] });
      }
      if (/INSERT INTO jobs/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1 }] });
      }
      if (/SELECT id FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT analysis FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await processSession(1);
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][2]).toBe('Verify cleanout location');
    expect(insertCalls[1][2]).toBe('Re-check pipe slope');
  });

  it('updates job intelligence when a job id is present', async () => {
    db.query = jest.fn().mockImplementation((sql) => {
      if (/SELECT \* FROM sessions/.test(sql)) {
        return Promise.resolve({ rows: [makeSession({ job_id: 10 })] });
      }
      if (/SELECT id FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT analysis FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await processSession(1);
    expect(updateJobIntelligence).toHaveBeenCalledWith(10);
  });

  it('does NOT update job intelligence when no job is associated', async () => {
    // Override: return a summary with no identifying info so resolveJob won't create a job
    summarizeTranscript.mockResolvedValueOnce({ phase: 'Rough-In', action_items: [] });
    await processSession(1);
    expect(updateJobIntelligence).not.toHaveBeenCalled();
  });

  it('processes unanalyzed PDF attachments before summarizing', async () => {
    db.query = jest.fn().mockImplementation((sql) => {
      if (/SELECT \* FROM sessions/.test(sql)) {
        return Promise.resolve({ rows: [makeSession({ job_id: 5 })] });
      }
      if (/SELECT id FROM attachments/.test(sql)) {
        // Return one unanalyzed attachment
        return Promise.resolve({ rows: [{ id: 88 }] });
      }
      if (/SELECT analysis FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await processSession(1);
    expect(analyzePlan).toHaveBeenCalledWith(88);
  });

  it('continues processing even when plan analysis fails', async () => {
    analyzePlan.mockRejectedValue(new Error('PDF unreadable'));
    db.query = jest.fn().mockImplementation((sql) => {
      if (/SELECT \* FROM sessions/.test(sql)) {
        return Promise.resolve({ rows: [makeSession({ job_id: 5 })] });
      }
      if (/SELECT id FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 88 }] });
      }
      if (/SELECT analysis FROM attachments/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    // Should NOT throw even though analyzePlan failed
    await expect(processSession(1)).resolves.toBeDefined();
  });
});
