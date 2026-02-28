module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/db/migrations/**',
    '!src/index.js',
  ],
  coverageReporters: ['text', 'lcov'],
  testTimeout: 10000,
};
