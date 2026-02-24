# 🔨 Max — AI Field Assistant

> **AI coding agent guidance for the Max project**
>
> Max is a voice-activated job walk recorder + AI summarizer + chat-powered field intelligence system for CTL Plumbing LLC.

---

## Project Overview

**Max** consists of two main components:

1. **Server (Node.js + Docker)** — Handles transcription, AI summarization, RAG chat, and data persistence
2. **Android App (Kotlin + Jetpack Compose)** — Field recording interface with wake word detection and upload queue

### What Max Does

- Records job walk conversations between CTL Plumbing and builders/GCs
- Transcribes audio locally using faster-whisper
- Generates structured summaries using Ollama (llama3.1:8b)
- Cross-references conversations with uploaded PDF plans
- Sends email summaries
- Provides RAG-powered chat to query any past job walk
- Tracks action items and job intelligence over time
- **NEW**: Real-time notifications via WebSocket
- **NEW**: Accessible via Tailscale VPN

---

## Repository Structure

```
/home/djscrew/MAX/
├── api/                    # Node.js REST API (backend) - PRIMARY
│   ├── src/
│   │   ├── index.js        # Express app entry point (WebSocket + middleware)
│   │   ├── config.js       # Environment configuration (Tailscale support)
│   │   ├── db/
│   │   │   ├── schema.sql  # PostgreSQL schema
│   │   │   └── index.js    # Database connection pool
│   │   ├── middlewares/    # Express middlewares
│   │   │   ├── asyncHandler.js
│   │   │   └── errorHandler.js
│   │   ├── routes/         # API route handlers
│   │   │   ├── upload.js   # Audio/file upload endpoints (improved validation)
│   │   │   ├── chat.js     # RAG chat endpoint
│   │   │   ├── jobs.js     # Job management endpoints
│   │   │   ├── notifications.js  # Push notification API (enhanced)
│   │   │   └── search.js   # Vector + text search
│   │   ├── services/       # Business logic
│   │   │   ├── pipeline.js # Main processing pipeline
│   │   │   ├── transcription.js
│   │   │   ├── summarizer.js
│   │   │   ├── embeddings.js
│   │   │   ├── notifications.js  # WebSocket broadcasting
│   │   │   └── ...
│   │   └── prompts/
│   │       └── construction-summary.md
│   ├── package.json        # Dependencies (helmet, rate-limit, ws, etc.)
│   └── Dockerfile
├── app/                    # Android application
│   ├── src/main/java/com/ctlplumbing/max/
│   │   ├── MainActivity.kt
│   │   ├── MaxApplication.kt
│   │   ├── data/
│   │   │   ├── api/
│   │   │   │   └── MaxApiClient.kt    # WebSocket + enhanced error handling
│   │   │   ├── models/
│   │   │   │   └── Models.kt          # Updated models with notifications
│   │   │   └── repository/
│   │   │       └── SettingsRepository.kt  # WebSocket URL support
│   │   ├── service/
│   │   │   ├── RecordingService.kt
│   │   │   ├── UploadManager.kt
│   │   │   └── NotificationPoller.kt
│   │   └── ui/
│   │       ├── screens/
│   │       ├── navigation/
│   │       └── theme/
│   └── build.gradle.kts    # Pre-configured for Tailscale IP
├── nginx/                  # NEW: Nginx reverse proxy config
│   └── nginx.conf          # SSL, CORS, WebSocket support
├── max/                    # COPY of server (sync with api/)
├── docker-compose.yml      # Updated with Tailscale networking
├── deploy.sh               # NEW: One-command deployment script
├── TAILSCALE_SETUP.md      # NEW: Tailscale configuration guide
├── .env.example            # Updated with Tailscale vars
└── README.md / README1.md
```

**Note:** The `max/` subdirectory is a copy of the server component and should be kept in sync with `api/`. Use `api/` for active development.

---

## Technology Stack

### Backend
| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js | 20 (Alpine) |
| Web Framework | Express | 4.21.0 |
| Security | Helmet | 7.1.0 |
| Rate Limiting | express-rate-limit | 7.1.0 |
| Compression | compression | 1.7.4 |
| WebSocket | ws | 8.14.0 |
| Database | PostgreSQL | 16 + pgvector |
| Transcription | faster-whisper | CPU (base.en) |
| AI/LLM | Ollama | llama3.1:8b, nomic-embed-text |
| File Upload | multer | 1.4.5-lts.1 |
| Email | nodemailer | 6.9.0 |
| Reverse Proxy | Nginx | Alpine |
| Deployment | Docker Compose | - |

### Android App
| Component | Technology | Version |
|-----------|------------|---------|
| Language | Kotlin | 1.9.22 |
| UI Framework | Jetpack Compose | BOM 2024.01.00 |
| Build System | Gradle | 8.2.2 |
| Min/Target SDK | Android | 26 / 34 |
| Networking | OkHttp | 4.12.0 |
| WebSocket | OkHttp WebSocket | 4.12.0 |
| Wake Word | Picovoice Porcupine | 3.0.2 |
| Settings | DataStore | 1.0.0 |
| Coroutines | kotlinx-coroutines | 1.7.3 |

---

## Build and Run Commands

### Server (Docker + Tailscale)

```bash
# Prerequisites: Docker & Docker Compose installed
# Ollama must be running on the host with required models

# 1. Pull Ollama models
ollama pull llama3.1:8b
ollama pull nomic-embed-text

# 2. Configure environment
cp .env.example .env
# Edit .env with your Tailscale IP and API credentials

# 3. Deploy (one command)
./deploy.sh

# Or manually:
docker compose up -d

# 4. Verify Tailscale access
curl http://100.83.120.32:4000/health
curl http://100.83.120.32:4000/status

# 5. View logs
docker compose logs -f api
docker compose logs -f nginx
```

### Android App

```bash
# Prerequisites: Android Studio Hedgehog+, Android SDK 34

# The app is pre-configured for Tailscale:
# API_BASE_URL = "http://100.83.120.32:4000"
# WS_URL = "ws://100.83.120.32:4000/ws"

# Build debug APK
./gradlew assembleDebug

# Install on device
adb install app/build/outputs/apk/debug/app-debug.apk

# Or open in Android Studio and run directly
```

---

## API Endpoints

All `/api/*` endpoints require `x-api-key` header (configured in `.env`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload/audio` | Upload audio file (200MB max, validated types) |
| GET | `/api/upload/status/:id` | Check upload/processing status |
| POST | `/api/upload/attachment` | Upload PDF/image attachment |
| POST | `/api/chat` | RAG-powered chat query |
| GET | `/api/search` | Vector + full-text search |
| GET | `/api/notifications` | Get notifications (unread or all) |
| GET | `/api/notifications/counts` | Get notification counts |
| POST | `/api/notifications/read` | Mark notifications as read |
| POST | `/api/notifications/read-all` | Mark all as read |
| GET | `/api/jobs` | List all jobs with counts |
| GET | `/api/jobs/:id` | Job detail with sessions/attachments |
| GET | `/api/jobs/:id/intel` | Rolling intelligence summary |
| GET | `/api/jobs/sessions/:id` | Session detail |
| PATCH | `/api/jobs/actions/:id` | Toggle action item completion |
| GET | `/health` | Health check (no auth) |
| GET | `/status` | DB stats (no auth) |
| WS | `/ws` | WebSocket for real-time updates |

---

## WebSocket Protocol

Connect to `ws://100.83.120.32:4000/ws` for real-time updates.

### Client → Server Messages

```json
{"type": "ping"}
{"type": "subscribe", "jobIds": [1, 2, 3]}
```

### Server → Client Messages

```json
{"type": "connected", "clientId": "abc123", "timestamp": "..."}
{"type": "notification", "notification": {...}}
{"type": "session_complete", "sessionId": 123, "summary": {...}}
{"type": "discrepancies", "sessionId": 123, "discrepancies": {...}}
{"type": "error", "message": "..."}
```

---

## Processing Pipeline

The `pipeline.js` service orchestrates the complete audio processing flow:

```
Audio Upload
    ↓
faster-whisper (transcription)
    ↓
Strip "Max" voice commands  ← Commands: "Hey Max", "Max, new room", "Max, flag that"
    ↓
Ollama (structured summary) ← Prompt: construction-summary.md
    ↓
Cross-reference with plans (if PDF attached)
    ↓
PostgreSQL + pgvector (store + embed)
    ↓
Email summary
    ↓
WebSocket notification → Android app
    ↓
Ready for RAG chat
```

### Session Status Flow

```
uploaded → transcribing → summarizing → complete
                              ↓
                           error (if failure)
```

---

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `builders` | Builder/GC contact info |
| `jobs` | Job sites (subdivision + lot) |
| `sessions` | Individual recordings |
| `attachments` | PDFs and photos linked to sessions |
| `chunks` | Vector-embedded text for RAG (768-dim) |
| `action_items` | Extracted todos from transcripts |
| `chat_messages` | Conversation history |
| `notifications` | Push notification queue for Android |

### Key Features
- **pgvector** for similarity search on embeddings
- **Full-text search** indexes on transcripts and summaries
- **JSONB** columns for flexible structured data (summaries, discrepancies)

---

## Voice Commands

The app and server recognize these voice commands during recordings:

| Command | Action |
|---------|--------|
| "Hey Max" | Start recording |
| "Max, here are the plans" | Trigger plan attachment |
| "Max, take a photo" | Trigger photo capture |
| "Max, new room — [name]" | Mark room section |
| "Max, flag that" | Bookmark moment (last 30 sec) |
| "Max, this is [builder/job/lot]" | Tag session metadata |
| "Max, stop" | End recording + upload |

Commands are stripped from transcripts before summarization.

---

## Code Style Guidelines

### JavaScript (Node.js)
- Use async/await for asynchronous operations
- Console logs use prefixes: `[ServiceName] message`
- Error handling: log full error, return user-friendly message
- Database queries use parameterized statements (`$1`, `$2`)
- Middleware pattern for reusable logic

### Kotlin (Android)
- Follow standard Kotlin conventions (camelCase, PascalCase for classes)
- Use coroutines (`suspend` functions) for network calls
- StateFlow for reactive UI state
- Jetpack Compose UI with Material3 components
- Dark theme colors optimized for outdoor visibility

### SQL
- Lowercase keywords (`create table`, `select`)
- Snake_case for identifiers
- Always include `IF NOT EXISTS` for CREATE statements
- Use `pgvector` vector type for embeddings (768 dimensions)

---

## Testing

### Server Tests

```bash
# Health and status checks
curl http://100.83.120.32:4000/health
curl http://100.83.120.32:4000/status

# Test with real audio file
./test.sh /path/to/recording.ogg

# Manual curl tests
curl -H "x-api-key: your-key" http://100.83.120.32:4000/api/jobs
curl -H "x-api-key: your-key" -X POST http://100.83.120.32:4000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What jobs do we have?"}'

# WebSocket test
wscat -c ws://100.83.120.32:4000/ws
```

### Android Tests

```bash
# Build verification
./gradlew build

# Install and run
adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## Configuration

### Environment Variables (.env)

```bash
# --- Database ---
POSTGRES_DB=max
POSTGRES_USER=max
POSTGRES_PASSWORD=changeme

# --- API Configuration ---
NODE_ENV=production
API_PORT=3210

# --- Tailscale / External Access ---
TAILSCALE_IP=100.83.120.32
EXTERNAL_PORT=4000
ALLOWED_ORIGINS=http://localhost:3210,http://100.83.120.32:4000

# --- Ollama ---
OLLAMA_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_EMBED_MODEL=nomic-embed-text

# --- Email ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_TO=burro@ctlplumbing.com
EMAIL_FROM=max@ctlplumbing.com

# --- API Security ---
MAX_API_KEY=max-secret-key-change-me

# --- Rate Limiting ---
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### Ports

| Service | Internal | External | Purpose |
|---------|----------|----------|---------|
| Max API | 3210 | 3210, 4000 | Main API (4000 for Tailscale) |
| PostgreSQL | 5432 | 5433 | Database |
| Whisper | 8000 | 8100 | Transcription |
| Nginx | 80/443 | 80/443 | Reverse proxy (optional) |
| Ollama | 11434 | Host only | AI/LLM |

---

## Security Considerations

1. **API Key**: All `/api/*` endpoints require `x-api-key` header
2. **Rate Limiting**: Configurable per-route limits (default: 100 req/min)
3. **Helmet.js**: Security headers (CSP, HSTS, etc.)
4. **CORS**: Restricted to allowed origins only
5. **File Uploads**: Limited to 200MB, type validation
6. **Network**: Use Tailscale for secure remote access
7. **Database**: Credentials via environment variables only
8. **Ollama**: Assumed to run on trusted host (not exposed externally)

---

## Tailscale Deployment

### Network Setup

1. Install Tailscale on your server:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

2. Install Tailscale on your Android device (from Play Store)

3. Verify connectivity:
   ```bash
   ping 100.83.120.32
   curl http://100.83.120.32:4000/health
   ```

### Deployment Checklist

- [ ] Docker and Docker Compose installed
- [ ] Ollama running with required models
- [ ] `.env` file configured with Tailscale IP
- [ ] Run `./deploy.sh`
- [ ] Verify health endpoint responds
- [ ] Install Android app
- [ ] Test upload from Android device

See `TAILSCALE_SETUP.md` for detailed instructions.

---

## Common Development Tasks

### Adding a New API Endpoint

1. Create route handler in `api/src/routes/`
2. Register in `api/src/index.js`
3. Update Android `MaxApiClient.kt` if needed
4. Add WebSocket broadcast if real-time updates needed

### Modifying the Processing Pipeline

1. Edit `api/src/services/pipeline.js`
2. Add any new services to `api/src/services/`
3. Update database schema in `api/src/db/schema.sql` if needed
4. Update notification broadcasting

### Adding New Voice Commands

1. Add regex pattern in `api/src/services/transcription.js` (`stripMaxCommands`)
2. Add to Android `CommandParser.kt` for client-side detection
3. Update command parsing in `parseCommands()` function
4. Document in `construction-summary.md` if relevant

### Modifying AI Prompts

1. Edit `api/src/prompts/construction-summary.md`
2. Test with real transcripts to verify JSON output format
3. Ensure output matches expected structure in `summarizer.js`

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Ollama connection failed | Verify Ollama running on host, `host.docker.internal` resolves |
| Whisper timeout | Check whisper container logs, verify model downloaded |
| Upload fails | Check disk space, verify `uploads/` directory writable |
| Transcript empty | Verify audio file not corrupted, check whisper logs |
| Summary malformed | Check Ollama response, verify prompt produces valid JSON |
| Android can't connect | Verify Tailscale connected, check network config |
| CORS errors | Update `ALLOWED_ORIGINS` in `.env` |
| WebSocket fails | Check nginx WebSocket config, verify URL correct |
| Wake word not working | Check Picovoice access key, verify microphone permission |

---

## License

Private — CTL Plumbing LLC
