const { logger } = require('../utils/logger');

/**
 * Global error handler middleware
 * Uses structured logging for production
 */
const errorHandler = (err, req, res, next) => {
  const reqLogger = logger.child({ 
    reqId: req.id,
    method: req.method,
    url: req.originalUrl,
  });

  // Log error with context
  reqLogger.error({
    err: {
      message: err.message,
      stack: err.stack,
      name: err.name,
      code: err.code,
    },
    statusCode: err.statusCode || err.status || 500,
  }, 'Request error');

  const status = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  // Don't expose internal errors in production
  const response = {
    error: {
      message,
      ...(process.env.NODE_ENV === 'development' && { 
        stack: err.stack,
        code: err.code,
      }),
    },
  };

  res.status(status).json(response);
};

module.exports = errorHandler;
