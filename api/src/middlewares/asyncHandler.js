/**
 * Async handler wrapper for Express routes
 * Catches errors from async functions and passes them to Express error handler
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
