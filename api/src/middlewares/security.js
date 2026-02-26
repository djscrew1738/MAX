const crypto = require('crypto');
const config = require('../config');
const { logger } = require('../utils/logger');

/**
 * Security middleware
 * - Timing-safe API key comparison
 * - CORS with explicit whitelist
 * - Request ID generation for tracing
 */

/**
 * Generate unique request ID
 */
function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/**
 * Timing-safe API key authentication
 * Prevents timing attacks on key comparison
 */
function authenticateApiKey(req, res, next) {
  const providedKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!providedKey) {
    logger.warn({ reqId: req.id, ip: req.ip }, 'API key missing');
    return res.status(401).json({ error: 'API key required' });
  }
  
  // Constant-time comparison to prevent timing attacks
  try {
    const providedBuf = Buffer.from(providedKey);
    const actualBuf = Buffer.from(config.apiKey);
    
    // Different length keys are not equal
    if (providedBuf.length !== actualBuf.length) {
      // Still perform comparison to avoid leaking length info
      // Hash both and compare to make timing constant
      const providedHash = crypto.createHash('sha256').update(providedBuf).digest();
      const dummyHash = crypto.createHash('sha256').update(Buffer.from('dummy')).digest();
      crypto.timingSafeEqual(providedHash, dummyHash); // Constant time
      
      logger.warn({ reqId: req.id, ip: req.ip }, 'Invalid API key (length mismatch)');
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    if (!crypto.timingSafeEqual(providedBuf, actualBuf)) {
      logger.warn({ reqId: req.id, ip: req.ip }, 'Invalid API key');
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    next();
  } catch (err) {
    logger.error({ reqId: req.id, err }, 'API key validation error');
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * CORS with explicit whitelist matching
 * No substring matching to prevent bypasses
 */
function corsOptions() {
  const allowedOrigins = config.allowedOrigins;
  
  return {
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }
      
      // Check exact match against whitelist
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // Log blocked origins
      logger.warn({ origin }, 'CORS blocked origin');
      callback(new Error('CORS not allowed for this origin'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id'],
  };
}

/**
 * Sanitize user input for LLM prompts
 * Prevents prompt injection attacks
 */
function sanitizeForLLM(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // Remove potential instruction override attempts
  // Block attempts to inject system, assistant, or human roles
  return text
    .replace(/system:|assistant:|human:|user:/gi, '')
    .replace(/\[system\]|\[assistant\]|\[human\]|\[user\]/gi, '')
    .replace(/<system>|<\/system>|<assistant>|<\/assistant>/gi, '')
    .replace(/{"role":\s*"system".*?}/gi, '')
    .replace(/ignore\s+(previous|above|all)\s+instructions/gi, '[REDACTED]')
    .replace(/disregard\s+(previous|above|all)\s+instructions/gi, '[REDACTED]')
    .replace(/you\s+are\s+now/gi, '[REDACTED]')
    .substring(0, 10000); // Limit length
}

/**
 * Validate file MIME type
 */
function validateFileType(allowedTypes) {
  return (req, res, next) => {
    if (!req.file && !req.files) {
      return next();
    }
    
    const files = req.files || [req.file];
    
    for (const file of files) {
      if (!allowedTypes.includes(file.mimetype)) {
        logger.warn({ 
          mimetype: file.mimetype, 
          filename: file.originalname,
          reqId: req.id 
        }, 'Invalid file type uploaded');
        
        return res.status(400).json({ 
          error: 'Invalid file type',
          allowed: allowedTypes,
          received: file.mimetype,
        });
      }
    }
    
    next();
  };
}

module.exports = {
  requestId,
  authenticateApiKey,
  corsOptions,
  sanitizeForLLM,
  validateFileType,
};
