# 🔗 Max Tailscale Setup Guide

> Configure Max to be accessible via Tailscale at `100.83.120.32:4000`

---

## Quick Start

### 1. Configure Your Tailscale

Ensure your server is running Tailscale:

```bash
# Check Tailscale status
tailscale status

# Get your Tailscale IP
tailscale ip -4
```

### 2. Configure Environment

Copy the example environment file and update it:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Tailscale Configuration
TAILSCALE_IP=100.83.120.32
EXTERNAL_PORT=4000

# CORS Origins (add your Tailscale IP)
ALLOWED_ORIGINS=http://localhost:3210,http://100.83.120.32:4000,http://100.83.120.32:3210

# Security - Change this!
MAX_API_KEY=your-secure-random-key-here

# Database
POSTGRES_PASSWORD=your-secure-password-here

# Email (optional but recommended)
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_TO=your-email@example.com
```

### 3. Deploy

```bash
# Run the deployment script
./deploy.sh
```

Or manually:

```bash
# Build and start
docker compose up -d

# Verify health
curl http://100.83.120.32:4000/health
```

### 4. Android App Configuration

The Android app is pre-configured to use `http://100.83.120.32:4000`. If you need to change it:

1. Edit `app/build.gradle.kts`:

```kotlin
defaultConfig {
    buildConfigField("String", "API_BASE_URL", "\"http://100.83.120.32:4000\"")
    buildConfigField("String", "API_KEY", "\"your-secure-api-key\"")
    buildConfigField("String", "WS_URL", "\"ws://100.83.120.32:4000/ws\"")
}
```

2. Build and install:

```bash
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## Network Architecture

```
┌─────────────────┐
│   Android App   │
│  (Field Device) │
└────────┬────────┘
         │ Tailscale VPN
         │ http://100.83.120.32:4000
         ▼
┌─────────────────┐
│   Tailscale     │
│   Network       │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│              Docker Host                     │
│  ┌──────────────────────────────────────┐  │
│  │  Nginx (Port 4000)                   │  │
│  │  - Reverse proxy                     │  │
│  │  - CORS handling                     │  │
│  │  - Static file serving               │  │
│  └──────────┬───────────────────────────┘  │
│             │                              │
│  ┌──────────▼───────────────────────────┐  │
│  │  Max API (Port 3210)                 │  │
│  │  - Express.js                        │  │
│  │  - WebSocket support                 │  │
│  │  - Rate limiting                     │  │
│  └──────────┬───────────────────────────┘  │
│             │                              │
│  ┌──────────▼───────────────────────────┐  │
│  │  PostgreSQL (Port 5433)              │  │
│  │  - pgvector extension                │  │
│  └──────────────────────────────────────┘  │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │  Whisper (Port 8100)                 │  │
│  │  - Transcription                     │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         │
         │ host.docker.internal
         ▼
┌─────────────────┐
│   Ollama        │
│  (Host Machine) │
│  - llama3.1:8b  │
│  - nomic-embed  │
└─────────────────┘
```

---

## Features Added

### 🔒 Security
- **Rate limiting**: Configurable per-route limits
- **Helmet.js**: Security headers
- **CORS**: Properly configured for Tailscale
- **API Key**: Required for all `/api/*` endpoints

### ⚡ Performance
- **Compression**: Gzip for API responses
- **Caching**: Static files cached for 1 day
- **Connection pooling**: Database connection limits
- **WebSocket**: Real-time notifications

### 📱 Android App Improvements
- **WebSocket support**: Real-time updates
- **Connection state monitoring**: Know when you're connected
- **Auto-retry**: Exponential backoff for failed requests
- **Better error messages**: User-friendly error handling

### 🔧 DevOps
- **Deployment script**: One-command deployment
- **Health checks**: All services have health endpoints
- **Logging**: Structured logging with request IDs
- **Graceful shutdown**: Proper cleanup on exit

---

## Troubleshooting

### Can't connect from Android

1. **Check Tailscale on both devices:**
   ```bash
   # On server
   tailscale status
   
   # On Android - check Tailscale app is connected
   ```

2. **Verify API is listening:**
   ```bash
   curl http://100.83.120.32:4000/health
   ```

3. **Check firewall:**
   ```bash
   # On server
   sudo ufw status
   sudo ufw allow 4000/tcp
   ```

4. **Check Docker ports:**
   ```bash
   docker compose ps
   ```

### CORS errors

Update `ALLOWED_ORIGINS` in `.env`:

```bash
ALLOWED_ORIGINS=http://localhost:3210,http://100.83.120.32:4000,http://100.83.120.32:3210,http://your-android-ip:port
```

### WebSocket not connecting

1. Check WebSocket URL in Android settings
2. Verify nginx WebSocket configuration:
   ```bash
   docker compose logs nginx
   ```
3. Check API WebSocket endpoint:
   ```bash
   wscat -c ws://100.83.120.32:4000/ws
   ```

---

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `TAILSCALE_IP` | `100.83.120.32` | Your Tailscale IP address |
| `EXTERNAL_PORT` | `4000` | External port for Tailscale access |
| `ALLOWED_ORIGINS` | - | Comma-separated CORS origins |
| `MAX_API_KEY` | - | API authentication key |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max requests per window |

---

## Testing

```bash
# Health check
curl http://100.83.120.32:4000/health

# Status check
curl http://100.83.120.32:4000/status

# API test (with key)
curl -H "x-api-key: your-key" http://100.83.120.32:4000/api/jobs

# WebSocket test
wscat -c ws://100.83.120.32:4000/ws
```
