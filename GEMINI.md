# 🔨 Max Project Context

This file provides critical context for Gemini to understand the Max project, a voice-activated AI field assistant for CTL Plumbing LLC.

## Project Overview

**Max** is a system designed to record, transcribe, summarize, and analyze job walk conversations between plumbing contractors and builders. It consists of a mobile field client and a robust backend processing pipeline.

- **Purpose:** Automate job documentation, track action items, and provide RAG-powered intelligence for field work.
- **Key Features:**
    - Voice-activated recording ("Hey Max").
    - Local transcription using `faster-whisper`.
    - Structured summary generation using `Ollama` (llama3.1:8b).
    - RAG (Retrieval-Augmented Generation) chat over job history.
    - PDF plan analysis and cross-referencing.
    - Automated email delivery of summaries.

## Architecture

The project is structured as a mono-repo with two primary components:

### 1. Backend (API) - `/api`
- **Stack:** Node.js (Express), PostgreSQL + `pgvector`, Docker.
- **AI Services:** Ollama (LLM & Embeddings), `faster-whisper` (Transcription).
- **Key Services:**
    - `pipeline.js`: Orchestrates the flow from audio upload to vector storage.
    - `transcription.js`: Interfaces with Whisper and strips voice commands.
    - `summarizer.js`: Generates structured JSON summaries via Ollama.
    - `embeddings.js`: Handles vectorization for RAG.

### 2. Android App - `/app`
- **Stack:** Kotlin, Jetpack Compose, Material3.
- **Key Components:**
    - `RecordingService.kt`: Handles background audio recording.
    - `UploadManager.kt`: Manages the upload queue with retries.
    - `MaxApiClient.kt`: OkHttp client for server communication.
    - `Porcupine`: Used for wake-word detection ("Hey Max").

## Repository Structure

- `api/`: Primary Node.js backend source code.
- `app/`: Android application source code (Kotlin).
- `docker-compose.yml`: Root configuration for launching the backend services.
- `AGENTS.md`: Detailed technical guidance for AI agents (Reference this for logic details).
- `README.md`: High-level overview and quick start.

## Development Workflows

### Building and Running

#### Backend (Docker)
```bash
# Pull AI models
ollama pull llama3.1:8b
ollama pull nomic-embed-text

# Setup environment
cp .env.example .env

# Launch services
docker compose up -d

# Verify
./test.sh
```

#### Android App
```bash
# Update API config in app/build.gradle.kts
# buildConfigField("String", "API_BASE_URL", "\"http://<IP>:3210\"")

# Build debug APK
./gradlew assembleDebug
```

### Development Conventions

- **Node.js:**
    - Use `async/await` for all asynchronous logic.
    - Prefix logs: `[Service] Message`.
    - Business logic belongs in `/services`, route handling in `/routes`.
    - **Database Migrations:** Schema changes are managed in `api/src/db/migrations/` and applied automatically on server startup.
- **Android:**
    - UI is built entirely with Jetpack Compose.
    - Use Kotlin Coroutines and StateFlow for reactive state.
    - Optimized for outdoor/high-glare visibility (Dark theme focus).
- **Database:**
    - Use `pgvector` for similarity searches.
    - Embeddings are 768-dimensional (nomic-embed-text).

## Key Files for AI Guidance

- `api/src/services/pipeline.js`: Central logic for audio processing.
- `api/src/db/migrations/`: Database schema and migration history.
- `api/src/prompts/construction-summary.md`: The system prompt used for LLM summarization.
- `app/src/main/java/com/ctlplumbing/max/data/api/MaxApiClient.kt`: API interface definition.

## Testing Strategy

- Use `test.sh` in the root for end-to-end backend verification.
- Backend routes can be tested via `curl` with the `x-api-key` header.
- Android builds should be verified with `./gradlew build`.
