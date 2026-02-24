const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const config = require('./config');

const app = express();
const server = http.createServer(app);

// --- Security Middleware ---
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // Disable for API
}));

// --- CORS Configuration for Tailscale ---
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (config.allowedOrigins.indexOf(origin) !== -1 || 
        origin.includes(config.tailscaleIp) ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
};

app.use(cors(corsOptions));

// --- Compression ---
app.use(compression());

// --- Logging ---
const logFormat = config.nodeEnv === 'production' 
  ? ':remote-addr - :method :url :status :response-time ms - :res[content-length]'
  : 'dev';
app.use(morgan(logFormat));

// --- Body Parsing ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- Rate Limiting ---
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.uploadMaxRequests,
  message: { error: 'Upload limit reached, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);
app.use('/api/upload', uploadLimiter);

// --- API Key Auth ---
app.use('/api', (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) {
    return res.status(401).json({ error: 'API key required' });
  }
  if (key !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
});

// --- Ensure Upload Directory Exists ---
if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  console.log(`[Server] Created upload directory: ${config.uploadDir}`);
}

// --- Static Files (Attachments) ---
app.use('/uploads', express.static(config.uploadDir, {
  maxAge: '1d',
  etag: true,
  lastModified: true,
}));

// --- Routes ---
app.use('/api/upload', require('./routes/upload'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/search', require('./routes/search'));
app.use('/api/backup', require('./routes/backup'));

// --- Metrics & Monitoring ---
const { router: metricsRouter, recordRequest } = require('./routes/metrics');
app.use('/metrics', metricsRouter);

// Request recording middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    recordRequest(req.method, req.path, res.statusCode, duration);
  });
  next();
});

// --- Web Dashboard ---
app.use(express.static(path.join(__dirname, '../../web')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../web/index.html'));
});

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    name: 'Max — AI Field Assistant',
    version: '1.1.0',
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    tailscale: {
      ip: config.tailscaleIp,
      port: config.externalPort,
    },
  });
});

// --- Detailed Status ---
app.get('/status', async (req, res) => {
  const db = require('./db');
  const startTime = Date.now();
  
  try {
    const { rows: [counts] } = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM sessions) as total_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'complete') as completed_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'error') as error_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'transcribing' OR status = 'summarizing') as processing_sessions,
        (SELECT COUNT(*) FROM jobs) as total_jobs,
        (SELECT COUNT(*) FROM chunks) as total_chunks,
        (SELECT COUNT(*) FROM action_items WHERE completed = FALSE) as open_actions,
        (SELECT COUNT(*) FROM attachments) as total_attachments,
        (SELECT COUNT(*) FROM notifications WHERE read = FALSE) as unread_notifications
    `);
    
    res.json({
      status: 'ok',
      responseTime: Date.now() - startTime,
      ...counts,
      version: '1.1.0',
    });
  } catch (err) {
    res.status(500).json({
      status: 'db_error',
      error: err.message,
      responseTime: Date.now() - startTime,
    });
  }
});

// --- Error Handling ---
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS error: Origin not allowed' });
  }
  
  res.status(err.status || 500).json({
    error: config.nodeEnv === 'production' 
      ? 'Internal server error' 
      : err.message,
    ...(config.nodeEnv !== 'production' && { stack: err.stack }),
  });
});

// --- 404 Handler ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- WebSocket Setup ---
const wss = new WebSocket.Server({ server, path: '/ws' });

const clients = new Map();

wss.on('connection', (ws, req) => {
  const clientId = Math.random().toString(36).substring(7);
  const clientInfo = {
    id: clientId,
    ip: req.socket.remoteAddress,
    connectedAt: new Date(),
  };
  
  clients.set(ws, clientInfo);
  console.log(`[WebSocket] Client connected: ${clientId} (${clients.size} total)`);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    timestamp: new Date().toISOString(),
  }));
  
  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleWebSocketMessage(ws, message);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }
  });
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WebSocket] Client disconnected: ${clientId} (${clients.size} remaining)`);
  });
  
  ws.on('error', (err) => {
    console.error(`[WebSocket] Error for client ${clientId}:`, err.message);
  });
});

// Heartbeat interval
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      clients.delete(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, config.ws.heartbeatInterval);

function handleWebSocketMessage(ws, message) {
  switch (message.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;
    case 'subscribe':
      // Subscribe to job updates
      ws.subscribedJobs = message.jobIds || [];
      ws.send(JSON.stringify({ type: 'subscribed', jobs: ws.subscribedJobs }));
      break;
    default:
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
  }
}

// Broadcast function for notifications
function broadcast(message, filter = null) {
  const data = JSON.stringify(message);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (!filter || filter(ws)) {
        ws.send(data);
      }
    }
  });
}

// Export for use in other modules
app.broadcast = broadcast;
app.wss = wss;

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully');
  clearInterval(heartbeatInterval);
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

// --- Start Server ---
async function startServer() {
  // Run database migrations
  console.log('[Server] Running database migrations...');
  const db = require('./db');
  const migrationResult = await db.runMigrations();
  if (migrationResult.applied > 0) {
    console.log(`[Server] Applied ${migrationResult.applied} migration(s)`);
  }
  
  // Check database connection
  const dbHealth = await db.healthCheck();
  if (!dbHealth.ok) {
    console.error('[Server] Database connection failed:', dbHealth.error);
    process.exit(1);
  }
  console.log(`[Server] Database connected (${dbHealth.responseTime}ms)`);
  
  // Start HTTP server
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║                                                          ║
  ║   🔨 MAX — AI Field Assistant v1.2.0                    ║
  ║   CTL Plumbing LLC                                       ║
  ║                                                          ║
  ║   HTTP:  http://localhost:${config.port}                        ║
  ║   WS:    ws://localhost:${config.port}/ws                       ║
  ║   Web:   http://localhost:${config.port}/ (dashboard)             ║
  ║                                                          ║
  ║   Tailscale: http://${config.tailscaleIp}:${config.externalPort}            ║
  ║                                                          ║
  ╚══════════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(err => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});

module.exports = { app, server, wss, broadcast };
