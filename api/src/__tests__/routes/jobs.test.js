'use strict';

jest.mock('../../db');
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

const request = require('supertest');
const express = require('express');
const db = require('../../db');
const jobsRouter = require('../../routes/jobs');

// Create a minimal Express app for testing (no auth middleware needed for unit tests)
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', jobsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/jobs
// ---------------------------------------------------------------------------
describe('GET /api/jobs', () => {
  it('returns 200 with an array of jobs', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 1, builder_name: 'Smith Homes', subdivision: 'Oak Creek', session_count: 3 },
        { id: 2, builder_name: 'Jones LLC', subdivision: 'Pine Valley', session_count: 1 },
      ],
    });

    const res = await request(makeApp()).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].builder_name).toBe('Smith Homes');
  });

  it('returns 200 with an empty array when no jobs exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 when a database error occurs', async () => {
    db.query.mockRejectedValueOnce(new Error('DB connection lost'));
    const res = await request(makeApp()).get('/api/jobs');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB connection lost');
  });
});

// ---------------------------------------------------------------------------
// GET /api/jobs/dashboard/stats
// ---------------------------------------------------------------------------
describe('GET /api/jobs/dashboard/stats', () => {
  it('returns 200 with stats and recent_sessions', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{
          active_jobs: '5',
          total_walks: '22',
          walks_this_week: '3',
          open_actions: '7',
          urgent_actions: '2',
          total_plans: '8',
          error_sessions: '0',
          total_recording_secs: '7200',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Recent Walk' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp()).get('/api/jobs/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.total_recording_hours).toBe('2.0');
    expect(res.body.recent_sessions).toHaveLength(1);
    expect(res.body.urgent_actions).toEqual([]);
  });

  it('returns total_recording_hours of "0" when no recordings exist', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{
          active_jobs: '0',
          total_walks: '0',
          walks_this_week: '0',
          open_actions: '0',
          urgent_actions: '0',
          total_plans: '0',
          error_sessions: '0',
          total_recording_secs: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp()).get('/api/jobs/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.stats.total_recording_hours).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id
// ---------------------------------------------------------------------------
describe('GET /api/jobs/:id', () => {
  it('returns 200 with the job and nested data when found', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, builder_name: 'Smith Homes', subdivision: 'Oak Creek' }] })
      .mockResolvedValueOnce({ rows: [{ id: 10, title: 'Walk 1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 20, file_name: 'plan.pdf' }] })
      .mockResolvedValueOnce({ rows: [{ id: 30, description: 'Fix pipe' }] });

    const res = await request(makeApp()).get('/api/jobs/1');
    expect(res.status).toBe(200);
    expect(res.body.builder_name).toBe('Smith Homes');
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.action_items).toHaveLength(1);
  });

  it('returns 404 when the job does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).get('/api/jobs/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Job not found');
  });

  it('returns 500 on a database error', async () => {
    db.query.mockRejectedValueOnce(new Error('query failed'));
    const res = await request(makeApp()).get('/api/jobs/1');
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/jobs/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/jobs/:id', () => {
  it('returns 200 with success message when job is deleted', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // job soft delete
      .mockResolvedValueOnce({ rows: [] })           // sessions soft delete
      .mockResolvedValueOnce({ rows: [] })           // action items soft delete
      .mockResolvedValueOnce({ rows: [] });          // attachments soft delete

    const res = await request(makeApp()).delete('/api/jobs/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Job deleted');
  });

  it('returns 404 when the job to delete does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // job not found
    const res = await request(makeApp()).delete('/api/jobs/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Job not found');
  });

  it('returns 500 on database error', async () => {
    db.query.mockRejectedValueOnce(new Error('lock timeout'));
    const res = await request(makeApp()).delete('/api/jobs/1');
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/jobs/sessions/:id
// ---------------------------------------------------------------------------
describe('GET /api/jobs/sessions/:id', () => {
  it('returns 200 with session and nested data', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 10, transcript: 'hello', builder_name: 'Smith' }] })
      .mockResolvedValueOnce({ rows: [{ id: 20, file_name: 'photo.jpg' }] })
      .mockResolvedValueOnce({ rows: [{ id: 30, description: 'Check pipe' }] });

    const res = await request(makeApp()).get('/api/jobs/sessions/10');
    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe('hello');
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.action_items).toHaveLength(1);
  });

  it('returns 404 when session is not found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).get('/api/jobs/sessions/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/jobs/sessions/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/jobs/sessions/:id', () => {
  it('returns 200 on successful session soft delete', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 10 }] });
    const res = await request(makeApp()).delete('/api/jobs/sessions/10');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when the session does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).delete('/api/jobs/sessions/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/jobs/actions/:id
// ---------------------------------------------------------------------------
describe('PATCH /api/jobs/actions/:id', () => {
  it('marks an action item as completed', async () => {
    const completedItem = { id: 30, description: 'Fix pipe', completed: true };
    db.query.mockResolvedValueOnce({ rows: [completedItem] });

    const res = await request(makeApp())
      .patch('/api/jobs/actions/30')
      .send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
  });

  it('marks an action item as not completed', async () => {
    const item = { id: 30, description: 'Fix pipe', completed: false };
    db.query.mockResolvedValueOnce({ rows: [item] });

    const res = await request(makeApp())
      .patch('/api/jobs/actions/30')
      .send({ completed: false });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(false);
  });

  it('returns 404 when action item is not found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp())
      .patch('/api/jobs/actions/999')
      .send({ completed: true });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Action item not found');
  });
});
