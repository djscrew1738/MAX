'use strict';

// Manual mock for the db module.
// Tests that need specific query results should override db.query using
// jest.fn().mockResolvedValue(...) or db.query.mockImplementation(...).
const db = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
};

module.exports = db;
