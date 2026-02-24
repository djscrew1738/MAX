require('dotenv').config();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3210')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

module.exports = {
  port: parseInt(process.env.PORT || '3210', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Tailscale / External Access
  tailscaleIp: process.env.TAILSCALE_IP || '100.83.120.32',
  externalPort: parseInt(process.env.EXTERNAL_PORT || '4000', 10),
  allowedOrigins,
  
  db: {
    connectionString: process.env.DATABASE_URL || 'postgres://max:changeme@localhost:5433/max',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  },
  
  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
    embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    timeout: parseInt(process.env.OLLAMA_TIMEOUT || '300000', 10), // 5 min default
  },
  
  whisper: {
    url: process.env.WHISPER_URL || 'http://localhost:8100',
    timeout: parseInt(process.env.WHISPER_TIMEOUT || '300000', 10), // 5 min for large files
  },
  
  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    to: process.env.EMAIL_TO,
    from: process.env.EMAIL_FROM || 'max@ctlplumbing.com',
    enabled: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
  },
  
  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    uploadMaxRequests: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX || '10', 10),
  },
  
  // File Upload
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '209715200', 10), // 200MB
  allowedFileTypes: {
    audio: ['audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/x-m4a'],
    attachment: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  },
  
  // Security
  apiKey: process.env.MAX_API_KEY || 'max-secret-key-change-me',
  
  // WebSocket
  ws: {
    enabled: process.env.WS_ENABLED !== 'false',
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT || '30000', 10),
  },
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};
