require('dotenv').config();

/**
 * Centralized configuration with validation
 * No hardcoded fallbacks for sensitive values
 */

const REQUIRED_ENV_VARS = [
  'MAX_API_KEY',
  'POSTGRES_PASSWORD',
];

// Validate required environment variables in production
if (process.env.NODE_ENV === 'production') {
  const missing = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error(`[Config] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// Build database URL from components if not provided directly
function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  
  const user = process.env.POSTGRES_USER || 'max';
  const password = process.env.POSTGRES_PASSWORD;
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5433';
  const db = process.env.POSTGRES_DB || 'max';
  
  if (!password) {
    throw new Error('POSTGRES_PASSWORD or DATABASE_URL must be set');
  }
  
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

// CORS allowed origins - explicit whitelist
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3210,http://127.0.0.1:3210')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Tailscale IP if configured
const tailscaleIp = process.env.TAILSCALE_IP;
if (tailscaleIp) {
  allowedOrigins.push(`http://${tailscaleIp}`, `http://${tailscaleIp}:4000`);
}

module.exports = {
  port: parseInt(process.env.PORT || '3210'),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  db: {
    connectionString: buildDatabaseUrl(),
    // Connection pool settings
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000'),
    // Retry configuration
    retryAttempts: parseInt(process.env.DB_RETRY_ATTEMPTS || '5'),
    retryDelay: parseInt(process.env.DB_RETRY_DELAY || '5000'),
  },
  
  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
    embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    visionModel: process.env.OLLAMA_VISION_MODEL || 'llava',
    // Request timeouts
    timeout: parseInt(process.env.OLLAMA_TIMEOUT || '30000'),
    embeddingTimeout: parseInt(process.env.OLLAMA_EMBED_TIMEOUT || '15000'),
    chatTimeout: parseInt(process.env.OLLAMA_CHAT_TIMEOUT || '60000'),
  },
  
  whisper: {
    url: process.env.WHISPER_URL || 'http://localhost:8100',
    timeout: parseInt(process.env.WHISPER_TIMEOUT || '300000'), // 5 min for large files
  },
  
  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    to: process.env.EMAIL_TO,
    from: process.env.EMAIL_FROM || 'max@ctlplumbing.com',
  },
  
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  
  // API Key - NO FALLBACK in production
  apiKey: process.env.NODE_ENV === 'production' 
    ? (process.env.MAX_API_KEY || (() => { throw new Error('MAX_API_KEY is required in production'); })())
    : (process.env.MAX_API_KEY || 'dev-key-change-in-production'),
  
  // CORS configuration
  allowedOrigins,
  tailscaleIp,
  
  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    embeddingMaxRequests: parseInt(process.env.RATE_LIMIT_EMBEDDING_MAX || '30'),
    chatMaxRequests: parseInt(process.env.RATE_LIMIT_CHAT_MAX || '60'),
  },
  
  // File upload settings
  upload: {
    maxSize: parseInt(process.env.UPLOAD_MAX_SIZE || '209715200'), // 200MB
    allowedAudioTypes: [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/wave',
      'audio/ogg',
      'audio/webm',
      'audio/aac',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
    ],
    allowedImageTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ],
    allowedDocumentTypes: [
      'application/pdf',
    ],
  },
  
  // Virus scanning
  clamav: {
    enabled: process.env.CLAMAV_ENABLED === 'true',
    host: process.env.CLAMAV_HOST || 'clamav',
    port: parseInt(process.env.CLAMAV_PORT || '3310'),
  },
  
  opensite: {
    url: process.env.OPENSITE_URL || '',
    apiKey: process.env.OPENSITE_API_KEY || '',
    webhookUrl: process.env.OPENSITE_WEBHOOK_URL || '',
  },
  
  // Logging
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
};
