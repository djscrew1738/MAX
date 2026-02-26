# Pre-Production Security Checklist

## Required Environment Variables

```bash
# Database (REQUIRED - no defaults)
POSTGRES_DB=max
POSTGRES_USER=max
POSTGRES_PASSWORD=<generate-secure-password>

# API Security (REQUIRED - no defaults)
MAX_API_KEY=<generate-48-char-key>

# External Services
OLLAMA_URL=http://host.docker.internal:11434
WHISPER_URL=http://whisper:8000

# Email (optional but recommended)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_TO=

# Security Options
CLAMAV_ENABLED=true
ALLOWED_ORIGINS=http://localhost:3210
```

## Quick Verification Commands

```bash
# 1. Generate secure keys
openssl rand -base64 48  # For MAX_API_KEY
openssl rand -base64 32  # For POSTGRES_PASSWORD

# 2. Verify configuration
npm ci --production
docker compose config

# 3. Start with full security
docker compose --profile production --profile full up -d

# 4. Test health endpoint
curl http://localhost:3210/health

# 5. Test API with key
curl -H "x-api-key: YOUR_KEY" http://localhost:3210/api/jobs

# 6. Test WebSocket auth
# Connect to ws://localhost:3210/ws?token=YOUR_KEY (should succeed)
# Connect to ws://localhost:3210/ws?token=WRONG_KEY (should fail)
```

## Security Features Enabled

✅ Timing-safe API key comparison
✅ No hardcoded credentials
✅ MIME type validation
✅ Explicit CORS whitelist
✅ Request timeouts on all external calls
✅ ClamAV virus scanning
✅ Database connection retry with backoff
✅ WebSocket authentication
✅ Migration advisory locking
✅ Soft delete support
✅ Structured logging (Pino)
✅ Deep health checks
✅ Centralized configuration
✅ Docker security (non-root, read-only)
✅ Automated backups
✅ Rate limiting
✅ Prompt injection sanitization
✅ LLM output validation (Zod)
✅ Helmet security headers
✅ Request ID tracking
