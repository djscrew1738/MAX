# Backend Revamp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replatform the Max backend to a Go chi monolith + worker with Postgres queues, S3/MinIO storage, improved RAG, and WebSocket notifications, deployable on Kubernetes with breaking v1 API.

**Architecture:** One Go binary with modes `serve` (HTTP/WS), `worker` (pipeline + queues), `migrate` (DB migrations). Postgres for data + queues, pgvector for embeddings, S3/MinIO for blobs, local Ollama/Whisper services. API v1 on chi with API-key auth; WebSocket for real-time events. Observability via zap logs, Prometheus metrics, OpenTelemetry traces.

**Tech Stack:** Go 1.22, chi, pgx/pgxpool, go-chi/httprate, aws-sdk-go-v2 (S3), jose for auth tokens (future), goose for migrations (embedded), pgvector, zap/logging, otel, testify, k6 for load tests.

---

### Task 1: Create Go module scaffold
**Files:**
- Create: `api-go/go.mod`, `api-go/go.sum`
- Create: `api-go/Makefile`
- Create: `api-go/README.md`

**Steps:**
1. Initialize module `github.com/ctlplumbing/max/api-go` with Go 1.22; add required deps (chi, pgxpool, aws-sdk-go-v2, zap, otel, httprate, cors, envconfig/cleanenv, goose cli as tool).
2. Makefile targets: `lint`, `test`, `build`, `run-serve`, `run-worker`, `migrate-up`, `migrate-down`.
3. README: how to run locally with env vars and Ollama/Whisper expectations.

### Task 2: Configuration package
**Files:**
- Create: `api-go/internal/config/config.go`
- Create: `api-go/internal/config/example.env`

**Steps:**
1. Define Config struct: server (port, addr, cors origins), db (url), ollama (url/model/embed_model), whisper (url), email (smtp host/port/user/pass/from/to), s3 (endpoint, region, bucket, access/secret, usePathStyle, presignTTL), auth (apiKey), rateLimit (rps/burst), logging (level).
2. Load from env using `cleanenv`; validate required fields; provide defaults.
3. Expose helper `MustLoad()` and `HTTPAddress()`.

### Task 3: Logging & observability wiring
**Files:**
- Create: `api-go/internal/observability/logger.go`
- Create: `api-go/internal/observability/metrics.go`

**Steps:**
1. Configure zap logger with env level and request-scoped fields.
2. Set up Prometheus registry + middleware exporter for chi.
3. Stub OTEL tracer provider with OTLP endpoint env; allow no-op when unset.

### Task 4: Postgres + migrations
**Files:**
- Create: `api-go/internal/db/db.go`
- Create: `api-go/migrations/0001_init.sql` (translated core schema)
- Create: `api-go/migrations/0002_queues.sql` (job queue tables + dlq)
- Create: `api-go/migrations/0003_uploads.sql` (uploads table + s3 keys)

**Steps:**
1. Implement `Connect(ctx, cfg)` returning pgxpool with health check.
2. Embed migrations using `go:embed` and goose lib; add `migrate up/down` functions used by `cmd/migrate`.
3. Translate existing schema (builders, jobs, sessions, attachments, chunks, action_items, chat_messages, notifications) with pgvector extension.
4. Add queue tables (`jobs_ingest`, `jobs_embed`, `jobs_email`, `jobs_dlq`) with visibility timeout columns, attempt counters.
5. Add uploads table with sha256, s3_key, size, mime, kind, links to session/job.

### Task 5: S3 storage client
**Files:**
- Create: `api-go/internal/storage/s3.go`

**Steps:**
1. Initialize AWS SDK v2 client with custom endpoint/region/path-style; support MinIO.
2. Functions: `PutObject(ctx, key, reader, size, contentType)`, `GeneratePresignedGet(ctx, key, ttl)`, `DeleteObject(ctx, key)`.
3. Key builder helper: `audio/<session-id>/<uuid>.ogg`, `attachments/<session-id>/<uuid>.<ext>`.

### Task 6: HTTP server & middleware
**Files:**
- Create: `api-go/internal/http/server.go`
- Create: `api-go/internal/http/middleware.go`

**Steps:**
1. chi router with middlewares: request ID, recoverer, cors (origins from cfg), rate limit (httprate), logging, metrics, API key auth for `/v1/*` except health/status.
2. Mount subrouters: health, status, upload, chat, search, jobs, notifications, ws.
3. Graceful shutdown with context cancel.

### Task 7: Health & status endpoints
**Files:**
- Create: `api-go/internal/http/handlers/health.go`
- Create: `api-go/internal/http/handlers/status.go`

**Steps:**
1. `/health` returns name/version/timestamp.
2. `/status` queries db for counts + queue depth + worker heartbeat; include embeddings latency placeholder.

### Task 8: Auth middleware
**Files:**
- Create: `api-go/internal/http/auth.go`

**Steps:**
1. Middleware checks `X-Api-Key` against config; 401 on mismatch; skip for health/status.
2. Attach auth context values for logging.

### Task 9: Upload APIs (audio & attachments)
**Files:**
- Create: `api-go/internal/http/handlers/upload.go`
- Create: `api-go/internal/services/uploads.go`

**Steps:**
1. `POST /v1/upload/audio` multipart: stream to temp file, compute sha256, send to S3, create `uploads` + `sessions` rows, enqueue ingest job; respond session_id, upload_id.
2. `POST /v1/upload/attachment` multipart: detect mime, store in S3, create attachment row, enqueue plan analysis job.
3. `GET /v1/upload/status/{sessionId}` returns session status + error.
4. Enforce size limit (200MB) and mime whitelist.

### Task 10: Queue + worker plumbing
**Files:**
- Create: `api-go/internal/queue/queue.go`
- Create: `api-go/internal/worker/worker.go`

**Steps:**
1. Implement generic Postgres queue helpers: lease (FOR UPDATE SKIP LOCKED), extend, complete, fail -> DLQ.
2. Worker loop with visibility timeout/backoff; metrics on attempts and duration.
3. Job types: ingest (transcribe/summarize), embed, email, notification.

### Task 11: Pipeline stubs
**Files:**
- Create: `api-go/internal/pipeline/pipeline.go`
- Create: `api-go/internal/pipeline/transcribe.go`
- Create: `api-go/internal/pipeline/summarize.go`
- Create: `api-go/internal/pipeline/embed.go`
- Create: `api-go/internal/pipeline/email.go`

**Steps:**
1. Wire external calls to Whisper (transcribe) and Ollama (summarize/embeddings) with timeouts.
2. Strip commands, parse metadata, resolve/create job, save transcript/summary, discrepancies stub.
3. Embed transcript/summary, write chunks, update job_intel stub.
4. Email via SMTP client stub; failures retried.
5. Add notification hook to queue notifications job.

### Task 12: Search + Chat endpoints
**Files:**
- Create: `api-go/internal/http/handlers/search.go`
- Create: `api-go/internal/http/handlers/chat.go`
- Create: `api-go/internal/services/rag.go`

**Steps:**
1. Hybrid retrieval (pgvector + tsquery) with job scope and recency boost; return sources.
2. Chat handler builds messages, calls Ollama chat endpoint, saves chat_messages with context.
3. Limit top-k and size; guard on low similarity.

### Task 13: Notifications + WebSocket
**Files:**
- Create: `api-go/internal/http/handlers/notifications.go`
- Create: `api-go/internal/ws/hub.go`
- Create: `api-go/internal/ws/client.go`

**Steps:**
1. HTTP: list notifications, mark read, counts.
2. WS hub supports subscribe with jobIds; broadcast session_complete, discrepancies, errors; heartbeat/ping support; backpressure handling.

### Task 14: Android client updates (critical path)
**Files:**
- Modify: `app/src/main/java/com/ctlplumbing/max/data/api/MaxApiClient.kt`
- Modify: `app/src/main/java/com/ctlplumbing/max/service/UploadManager.kt`
- Modify: `app/src/main/java/com/ctlplumbing/max/service/NotificationPoller.kt` (add WS client)

**Steps:**
1. Switch base paths to `/v1/...`; update request/response models for new upload/chat/search/notifications schemas.
2. Add exponential backoff for uploads; expose progress/errors to UI; ensure attachments upload after audio ACK.
3. Implement WS client with reconnect/backoff; keep polling fallback.

### Task 15: Deployment (k8s)
**Files:**
- Create: `deploy/k8s/api-deployment.yaml`, `deploy/k8s/worker-deployment.yaml`, `deploy/k8s/ollama.yaml`, `deploy/k8s/whisper.yaml`, `deploy/k8s/ingress.yaml`, `deploy/k8s/configmap.yaml`, `deploy/k8s/secret.yaml`
- Update: `docker-compose.yml` (optional dev service entries for Go API)

**Steps:**
1. Containerize Go service with multi-stage Dockerfile (alpine distroless runtime).
2. Define deployments with resource requests (api 0.5 CPU/512Mi, worker 1.5 CPU/1.5Gi), HPAs, PDBs, services, ingress with TLS, env wiring for S3/DB.
3. Add ConfigMap/Secret; mount CA bundle if MinIO self-signed.

### Task 16: Testing & verification
**Files:**
- Create: `api-go/internal/.../*_test.go` for units (chunker, queue lease, parser)
- Create: `api-go/testdata/fixture.wav`, `api-go/testdata/sample.txt`
- Create: `api-go/load/k6-upload.js`

**Steps:**
1. Unit tests for queue lease/backoff, command parsing, chunker.
2. Integration test hitting `/health`, `/status`, upload -> queue record (mock S3 and Ollama/Whisper via httptest).
3. k6 scenario for 20 concurrent uploads + chat; capture p95.

### Task 17: Cutover checklist
**Files:**
- Create: `docs/runbooks/cutover-2026-xx-xx.md`

**Steps:**
1. Document freeze, migrate, deploy, smoke tests, ingress flip, rollback commands.

---

**Execution Note:** After approval, run superpowers:executing-plans to implement tasks sequentially; prefer subagent-driven development for parallelizable pieces (API vs worker vs Android changes). Keep Node app intact during migration; do not revert existing files.
