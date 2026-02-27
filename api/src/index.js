const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const config = require('./config');
const db = require('./db');
const { migrate } = require('./db/migrate');
const { logger } = require('./utils/logger');
const { 
  requestId, 
  authenticateApiKey, 
  corsOptions,
} = require('./middlewares/security');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Trust proxy for correct IP behind reverse proxy
app.set('trust proxy', 1);

// --- Security Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedded content
}));

// CORS with explicit whitelist
app.use(cors(corsOptions()));

// Request ID for tracing
app.use(requestId);

// JSON body parsing with limits
app.use(express.json({ limit: '10mb' }));

// --- Rate Limiting ---
const standardLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});

const embeddingLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.embeddingMaxRequests,
  message: { error: 'Too many embedding requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.chatMaxRequests,
  message: { error: 'Too many chat requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(standardLimiter);

// Tight rate limiter for unauthenticated public endpoints (/health, /status)
const publicEndpointLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- API Key Auth for /api routes ---
app.use('/api', authenticateApiKey);

// Apply specific rate limits to embedding/chat endpoints
app.use('/api/chat', chatLimiter);

// Ensure upload directory exists
if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

// --- Routes ---
app.use('/api/upload', require('./routes/upload'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/search', require('./routes/search'));
app.use('/api/opensite', require('./routes/opensite'));
app.use('/api/metrics', require('./routes/metrics'));
app.use('/api/backup', require('./routes/backup'));

// --- Digest endpoint (manual trigger) ---
app.post('/api/digest', async (req, res) => {
  const { generateWeeklyDigest } = require('./services/digest');
  try {
    const digest = await generateWeeklyDigest();
    res.json({ success: true, preview: digest?.substring(0, 500) });
  } catch (err) {
    logger.error({ err }, '[Digest] Error');
    res.status(500).json({ error: err.message });
  }
});

// --- Health check (deep check with dependencies) ---
app.get('/health', publicEndpointLimiter, async (req, res) => {
  // Check database
  const dbHealth = await db.healthCheck();

  // Check Whisper (5s timeout via AbortSignal)
  let whisperHealth = false;
  try {
    const whisperResponse = await fetch(`${config.whisper.url}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    whisperHealth = whisperResponse.ok;
  } catch (err) {
    whisperHealth = false;
  }

  // Check Ollama (5s timeout via AbortSignal)
  let ollamaHealth = false;
  try {
    const ollamaResponse = await fetch(`${config.ollama.url}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    ollamaHealth = ollamaResponse.ok;
  } catch (err) {
    ollamaHealth = false;
  }
  
  const allHealthy = dbHealth.healthy && whisperHealth && ollamaHealth;
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      db: dbHealth.healthy ? { status: 'ok', latency: dbHealth.latency } : { status: 'error', error: dbHealth.error },
      whisper: whisperHealth ? { status: 'ok' } : { status: 'error' },
      ollama: ollamaHealth ? { status: 'ok' } : { status: 'error' },
    },
  });
});

// --- Simple status endpoint (no auth) ---
app.get('/status', publicEndpointLimiter, async (req, res) => {
  try {
    const { rows: [counts] } = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM sessions WHERE deleted_at IS NULL) as total_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'complete' AND deleted_at IS NULL) as completed_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'error' AND deleted_at IS NULL) as error_sessions,
        (SELECT COUNT(*) FROM jobs WHERE deleted_at IS NULL) as total_jobs,
        (SELECT COUNT(*) FROM chunks WHERE deleted_at IS NULL) as total_chunks,
        (SELECT COUNT(*) FROM action_items WHERE completed = FALSE AND deleted_at IS NULL) as open_actions
    `);
    res.json({ status: 'ok', ...counts });
  } catch (err) {
    logger.error({ err }, '[Status] Database error');
    res.json({ status: 'db_error', error: err.message });
  }
});

// --- Error Handler ---
app.use(errorHandler);

// --- Start Server with WebSocket Support ---
const server = http.createServer(app);

// WebSocket server with authentication
const wss = new WebSocket.Server({ 
  server,
  path: '/ws',
  verifyClient: (info, done) => {
    // Verify API key from query string during handshake
    const url = new URL(info.req.url, `http://${info.req.headers.host}`);
    const token = url.searchParams.get('token');
    
    if (!token) {
      logger.warn('[WebSocket] Connection rejected: no token');
      return done(false, 401, 'Authentication required');
    }
    
    // Use timing-safe comparison
    const crypto = require('crypto');
    const providedBuf = Buffer.from(token);
    const actualBuf = Buffer.from(config.apiKey);
    
    if (providedBuf.length !== actualBuf.length) {
      logger.warn('[WebSocket] Connection rejected: invalid token length');
      return done(false, 401, 'Invalid authentication');
    }
    
    try {
      if (!crypto.timingSafeEqual(providedBuf, actualBuf)) {
        logger.warn('[WebSocket] Connection rejected: invalid token');
        return done(false, 401, 'Invalid authentication');
      }
    } catch (err) {
      logger.error('[WebSocket] Token comparison error');
      return done(false, 500, 'Authentication error');
    }
    
    logger.info('[WebSocket] Client authenticated');
    done(true);
  },
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = crypto.randomUUID();
  logger.info({ clientId }, '[WebSocket] Client connected');
  
  // Send connected message
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    timestamp: new Date().toISOString(),
  }));
  
  // Handle ping/pong
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  
  // Handle messages
  ws.on('message', (message) => {
    try {
      // Reject oversized messages before parsing
      if (message.length > 10240) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }));
        return;
      }

      const data = JSON.parse(message);

      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      } else if (data.type === 'subscribe') {
        // Validate jobIds: must be a non-huge array of positive integers
        const rawIds = Array.isArray(data.jobIds) ? data.jobIds : [];
        ws.subscribedJobs = rawIds
          .filter(id => Number.isInteger(id) && id > 0)
          .slice(0, 100);
        ws.send(JSON.stringify({ type: 'subscribed', jobs: ws.subscribedJobs }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });
  
  ws.on('close', () => {
    logger.info({ clientId }, '[WebSocket] Client disconnected');
  });
  
  ws.on('error', (err) => {
    logger.error({ clientId, err }, '[WebSocket] Error');
  });
});

// Heartbeat to detect stale connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Export broadcast function for notifications
const { broadcastNotification } = require('./services/notifications');

// --- Startup Sequence ---
async function start() {
  try {
    // Connect to database with retry
    await db.connectWithRetry();
    
    // Run migrations with locking
    await migrate();
    
    // Start server
    server.listen(config.port, '0.0.0.0', () => {
      logger.info({
        port: config.port,
        env: config.nodeEnv,
      }, `
      ╔══════════════════════════════════════════╗
      ║   🔨 MAX — AI Field Assistant v2.0      ║
      ║   CTL Plumbing LLC                       ║
      ║   Running on port ${config.port}                  ║
      ╚══════════════════════════════════════════╝
      `);
      
      // Start scheduler for weekly digests, cleanup, retries
      const scheduler = require('./services/scheduler');
      scheduler.start();
    });
    
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  wss.close(() => {
    logger.info('WebSocket server closed');
  });
  
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  wss.close(() => {
    logger.info('WebSocket server closed');
  });
  
  await db.close();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

start();

module.exports = { app, server, wss };
