# 🔨 Max — AI Field Assistant

**Voice-activated job walk recorder + AI summarizer + chat-powered field intelligence for CTL Plumbing LLC.**

Max records your conversations with builders and GCs on-site, transcribes them locally, generates structured summaries using your Ollama instance, emails you the results, and lets you chat with it later about anything that was ever said on any job.

---

## Quick Start

### Prerequisites
- Ubuntu server with Docker & Docker Compose
- Ollama running with `llama3.1:8b` and `nomic-embed-text` pulled
- (Optional) SMTP credentials for email delivery

### 1. Pull the required Ollama models

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
```

### 2. Configure environment

```bash
cd max
cp .env.example .env
nano .env  # fill in your email creds and API key
```

### 3. Launch

```bash
docker compose up -d
```

First launch will pull images and build the API container. Takes a few minutes.

### 4. Verify

```bash
# Health check
curl http://localhost:3210/health

# Full test
chmod +x test.sh
./test.sh

# With a real audio file
./test.sh /path/to/recording.ogg
```

---

## API Endpoints

All `/api/*` endpoints require `x-api-key` header.

### Upload

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload/audio` | Upload job walk recording (multipart: `audio` file + optional `job_id`, `phase`, `title`, `recorded_at`) |
| POST | `/api/upload/attachment` | Attach PDF plans or photos (multipart: `file` + `session_id` and/or `job_id`) |

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Ask Max anything (`message`, optional `job_id`, optional `history[]`) |

### Jobs & Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List all jobs with session/attachment counts |
| GET | `/api/jobs/:id` | Job detail with sessions, attachments, action items |
| GET | `/api/jobs/:id/intel` | Rolling intelligence summary for a job |
| GET | `/api/jobs/sessions/:id` | Full session detail |
| PATCH | `/api/jobs/actions/:id` | Toggle action item completion |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check (no auth) |
| GET | `/status` | DB stats (no auth) |

---

## Processing Pipeline

```
Audio Upload
    ↓
faster-whisper (transcription)
    ↓
Strip "Max" voice commands
    ↓
Ollama (structured summary)
    ↓
Cross-reference with plans (if attached)
    ↓
PostgreSQL + pgvector (store + embed)
    ↓
Email summary
    ↓
Ready for RAG chat
```

---

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│  Android APK │────▶│  Ubuntu Server (Docker)                  │
│  (Phase 2)   │     │                                          │
│              │     │  ┌─────────┐  ┌────────┐  ┌──────────┐  │
│  • Wake word │     │  │ Max API │──│Postgres│──│ pgvector │  │
│  • Record    │     │  │ :3210   │  │ :5433  │  │          │  │
│  • Upload    │     │  └────┬────┘  └────────┘  └──────────┘  │
│  • Chat      │     │       │                                  │
│              │     │  ┌────▼────┐  ┌──────────────────────┐  │
└─────────────┘     │  │ Whisper │  │ Ollama (your host)   │  │
                    │  │ :8100   │  │ :11434               │  │
                    │  └─────────┘  │ • llama3.1:8b        │  │
                    │               │ • nomic-embed-text    │  │
                    │               └──────────────────────┘  │
                    └──────────────────────────────────────────┘
```

---

## Ports

| Service | Port |
|---------|------|
| Max API | 3210 |
| PostgreSQL | 5433 |
| Whisper | 8100 |
| Ollama | 11434 (host) |

---

## Roadmap

- [x] Phase 1: Server pipeline (transcribe → summarize → email → RAG)
- [ ] Phase 2: Android APK (wake word, recording, file attach, chat)
- [ ] Phase 3: Plan analysis cross-referencing
- [ ] Phase 4: OpenSite integration
- [ ] Phase 5: Rolling job intelligence digests

---

## License

Private — CTL Plumbing LLC
