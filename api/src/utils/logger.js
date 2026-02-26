const pino = require('pino');
const config = require('../config');

/**
 * Structured logging with Pino
 * Provides consistent JSON logging for production
 * Pretty printing for development
 */

const logger = pino({
  level: config.logLevel,
  ...(config.nodeEnv === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  }),
  base: {
    service: 'max-api',
    version: '1.0.0',
  },
  // Redact sensitive fields
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'password', 'pass', 'apiKey'],
    remove: true,
  },
});

/**
 * Create a child logger with request context
 */
function createRequestLogger(req) {
  return logger.child({
    reqId: req.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
  });
}

module.exports = {
  logger,
  createRequestLogger,
};
