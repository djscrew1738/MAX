# Security Implementation Summary

This document summarizes all security improvements implemented for the Max API.

## 🔴 Critical Security Issues (All Fixed)

### 1. API Key Timing Attack Prevention
**File:** `api/src/middlewares/security.js`
- Implemented `crypto.timingSafeEqual()` for constant-time API key comparison
- Added protection against timing attacks that could leak key length
- Returns dummy hash comparison for wrong-length keys to avoid length leaks

### 2. Removed Hardcoded Fallback Credentials
**File:** `docker-compose.yml`, `.env.example`
- Removed all default fallbacks for sensitive values:
  - `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}` → `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}`
  - `MAX_API_KEY: ${MAX_API_KEY:-max-secret-key-change-me}` → `MAX_API_KEY: ${MAX_API_KEY}`
- Application now exits with error if required credentials are not set
- Updated `.env.example` with clear documentation

### 3. MIME Type Validation for File Uploads
**File:** `api/src/routes/upload.js`, `api/src/middlewares/security.js`
- Added whitelist validation for allowed MIME types:
  - Audio: `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, etc.
  - Images: `image/jpeg`, `image/png`, `image/webp`, `image/heic`
  - Documents: `application/pdf`
- Files with invalid types are rejected before processing

### 4. CORS Origin Validation Fix
**File:** `api/src/middlewares/security.js`, `api/src/config.js`
- Replaced substring matching with explicit whitelist checking
- Uses `allowedOrigins.includes(origin)` instead of `origin.includes('localhost')`
- Configured via `ALLOWED_ORIGINS` environment variable

## 🟠 Architecture & Performance (All Fixed)

### 5. Request Timeouts for External Services
**Files:** `api/src/services/transcription.js`, `summarizer.js`, `embeddings.js`, `plans.js`, `intelligence.js`, `digest.js`
- Implemented `AbortController` with configurable timeouts:
  - Ollama chat: 60 seconds
  - Ollama embeddings: 15 seconds
  - Ollama general: 30 seconds
  - Whisper transcription: 5 minutes (for large files)
- Prevents indefinite hanging on external service failures

### 6. Virus Scanning for Uploads
**File:** `api/src/routes/upload.js`
- Integrated ClamAV virus scanning using `clamscan` npm package
- Scans all uploaded files before processing
- Rejects infected files immediately
- Optional profile in docker-compose for resource efficiency

### 7. Database Connection Retry Logic
**File:** `api/src/db/index.js`
- Implemented exponential backoff retry (5 attempts, starting at 5s)
- Prevents crash loops during container startup
- Waits for PostgreSQL to be fully ready before starting API

### 8. WebSocket Authentication
**File:** `api/src/index.js`
- Added token-based authentication during WebSocket handshake
- Uses timing-safe comparison for API key validation
- Supports connection subscriptions by job ID
- Heartbeat/ping-pong for stale connection detection

## 🟡 Database & Data Integrity (All Fixed)

### 9. Database Migration Locking
**File:** `api/src/db/migrate.js`
- Implemented PostgreSQL advisory locks (`pg_advisory_lock`)
- Prevents concurrent migrations in multi-container deployments
- Lock released even on migration failure

### 10. Soft Deletes
**File:** `api/src/db/migrations/20240226170000_add_soft_deletes.sql`
- Added `deleted_at` columns to: `jobs`, `sessions`, `attachments`, `action_items`
- Created partial indexes for efficient querying of active records
- Added triggers for automatic chunk cleanup on session soft delete

### 11. Vector Embedding Cleanup
**Files:** Migration file and `api/src/routes/jobs.js`
- Database trigger cascades soft delete to chunks table
- Updated all queries to filter `WHERE deleted_at IS NULL`

## 🔵 Code Quality & Maintainability (All Fixed)

### 12. Structured Logging with Pino
**Files:** All service files
- Replaced `console.log/error` with Pino structured logger
- Request ID tracking for distributed tracing
- Sensitive data redaction (API keys, passwords)
- JSON output in production, pretty print in development

### 13. Deep Health Checks
**File:** `api/src/index.js`
- Health endpoint checks all dependencies:
  - Database connection and query latency
  - Whisper service availability
  - Ollama service and model availability
- Returns 503 status if any service is degraded

### 14. Centralized Configuration
**File:** `api/src/config.js`
- Single source of truth for all configuration
- Environment variable validation
- No sensitive defaults in production
- Organized by service/component

## 🟣 Infrastructure & DevOps (All Fixed)

### 15. Docker Security Hardening
**File:** `docker-compose.yml`, `api/Dockerfile`
- Non-root user (`1000:1000` for API, `999:999` for PostgreSQL)
- Read-only root filesystem with tmpfs for `/tmp`
- Resource limits (CPU: 2, Memory: 2G with 512M reservation)
- Health checks for all services

### 16. Automated Backups
**File:** `docker-compose.yml`
- Added `postgres-backup-local` sidecar container
- Daily automated backups with configurable retention:
  - Daily: 7 days
  - Weekly: 4 weeks
  - Monthly: 6 months
- Manual backup endpoint at `/api/backup`

### 17. Production Deployment Documentation
**File:** `docs/PRODUCTION_DEPLOYMENT.md`
- Comprehensive deployment guide
- SSL/TLS configuration with Nginx
- Security checklist for production
- Backup and recovery procedures

## 🟤 AI/LLM Specific Security (All Fixed)

### 18. Prompt Injection Sanitization
**File:** `api/src/middlewares/security.js`
- `sanitizeForLLM()` function strips potential injection attempts:
  - Removes `system:`, `assistant:`, `human:`, `user:` prefixes
  - Blocks `ignore previous instructions` patterns
  - Removes angle bracket tags
  - Limits input length to 10,000 characters

### 19. LLM Output Validation
**File:** `api/src/utils/schemas.js`
- Zod schemas for validating Ollama outputs
- Summary schema with typed fields
- Discrepancy item validation
- Plan analysis structure validation
- Returns parse error info on validation failure

### 20. Rate Limiting
**File:** `api/src/index.js`
- Express-rate-limit integration
- Different limits per endpoint:
  - Standard: 100 req/min
  - Chat: 60 req/min
  - Embeddings: 30 req/min
- Configurable via environment variables

## Additional Security Improvements

### Helmet Security Headers
**File:** `api/src/index.js`
- Content Security Policy
- XSS Protection
- Strict Transport Security
- Frame options

### Request ID Tracking
**File:** `api/src/middlewares/security.js`
- Unique request ID for every request
- Propagated through all logs
- Returned in response headers

### Input Validation
**File:** `api/src/utils/schemas.js`, `api/src/routes/chat.js`
- Zod validation for chat input
- Message length limits
- History validation
- Job ID validation

## Security Checklist for Production

Before deploying to production, ensure:

- [ ] `MAX_API_KEY` is set to a secure random value (48+ characters)
- [ ] `POSTGRES_PASSWORD` is set to a secure random value
- [ ] `NODE_ENV=production` is set
- [ ] ClamAV is enabled: `CLAMAV_ENABLED=true`
- [ ] Containers run as non-root user
- [ ] Resource limits are configured
- [ ] Nginx reverse proxy with SSL is used
- [ ] Automated backups are configured
- [ ] Rate limiting is enabled
- [ ] CORS origins are explicitly whitelisted
- [ ] Logging level is set appropriately (`LOG_LEVEL=info`)

## Files Modified

```
api/
├── package.json                          # Added security dependencies
├── Dockerfile                            # Non-root user, healthcheck
├── src/
│   ├── index.js                          # WebSocket auth, rate limiting, helmet
│   ├── config.js                         # Centralized config with validation
│   ├── utils/
│   │   ├── logger.js                     # Pino structured logging (NEW)
│   │   └── schemas.js                    # Zod validation schemas (NEW)
│   ├── middlewares/
│   │   ├── security.js                   # Timing-safe auth, CORS, sanitization (NEW)
│   │   └── errorHandler.js               # Structured error logging
│   ├── db/
│   │   ├── index.js                      # Connection retry logic
│   │   ├── migrate.js                    # Advisory locks
│   │   └── migrations/
│   │       └── 20240226170000_add_soft_deletes.sql
│   ├── routes/
│   │   ├── upload.js                     # MIME validation, virus scanning
│   │   ├── chat.js                       # Input validation, sanitization
│   │   ├── jobs.js                       # Soft delete support
│   │   ├── notifications.js              # Structured logging
│   │   ├── search.js                     # Soft delete filters
│   │   ├── backup.js                     # Structured logging
│   │   └── metrics.js                    # Soft delete filters
│   └── services/
│       ├── pipeline.js                   # Structured logging
│       ├── transcription.js              # Request timeouts
│       ├── summarizer.js                 # Input sanitization, output validation
│       ├── embeddings.js                 # Request timeouts
│       ├── notifications.js              # WebSocket broadcasting
│       ├── plans.js                      # Timeout handling, structured logging
│       ├── intelligence.js               # Timeout handling, structured logging
│       ├── digest.js                     # Timeout handling, structured logging
│       ├── scheduler.js                  # Structured logging
│       ├── email.js                      # Structured logging
│       ├── discrepancy-email.js          # Structured logging
│       ├── digest-email.js               # Structured logging
│       └── opensite.js                   # Timeout handling, structured logging
├── docker-compose.yml                    # Security hardening, backup, ClamAV
├── .env.example                          # No fallback credentials
└── docs/
    ├── PRODUCTION_DEPLOYMENT.md          # Production deployment guide
    └── SECURITY_IMPLEMENTATION_SUMMARY.md # This file
```

## Migration Guide

### For Existing Deployments

1. **Backup your database:**
   ```bash
   docker exec max-postgres pg_dump -U max max > backup_$(date +%Y%m%d).sql
   ```

2. **Set required environment variables:**
   ```bash
   # Generate secure keys
   export MAX_API_KEY=$(openssl rand -base64 48)
   export POSTGRES_PASSWORD=$(openssl rand -base64 32)
   ```

3. **Update .env file with new variables:**
   ```bash
   # Copy the new .env.example
   cp .env.example .env
   # Edit and fill in all values
   ```

4. **Run migrations:**
   ```bash
   docker compose run --rm api node src/db/migrate.js up
   ```

5. **Deploy with full security:**
   ```bash
   docker compose --profile production --profile full up -d
   ```

## Testing Security

### Test API Key Authentication
```bash
# Should fail (no key)
curl http://localhost:3210/api/jobs

# Should succeed
curl -H "x-api-key: YOUR_KEY" http://localhost:3210/api/jobs
```

### Test Health Endpoint
```bash
curl http://localhost:3210/health
```

### Test WebSocket Authentication
```javascript
const ws = new WebSocket('ws://localhost:3210/ws?token=WRONG_KEY'); // Should fail
const ws = new WebSocket('ws://localhost:3210/ws?token=YOUR_KEY');  // Should succeed
```

### Test File Upload Validation
```bash
# Should fail (invalid type)
curl -H "x-api-key: YOUR_KEY" -F "audio=@test.txt" http://localhost:3210/api/upload/audio
```

## License

Private — CTL Plumbing LLC
