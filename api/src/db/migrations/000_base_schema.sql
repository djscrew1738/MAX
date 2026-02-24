-- ============================================
-- MAX - Database Schema
-- ============================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -------------------------------------------
-- Builders / GCs
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS builders (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    company         VARCHAR(255),
    phone           VARCHAR(50),
    email           VARCHAR(255),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------
-- Jobs (a specific lot/project)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id              SERIAL PRIMARY KEY,
    builder_id      INTEGER REFERENCES builders(id),
    builder_name    VARCHAR(255),
    subdivision     VARCHAR(255),
    lot_number      VARCHAR(50),
    address         VARCHAR(500),
    phase           VARCHAR(50),  -- Underground, Rough-In, Top-Out, Trim, Final
    status          VARCHAR(50) DEFAULT 'active',
    fixture_count   INTEGER,
    notes           TEXT,
    job_intel       TEXT,  -- rolling intelligence summary
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_builder ON jobs(builder_id);
CREATE INDEX idx_jobs_status ON jobs(status);

-- -------------------------------------------
-- Sessions (a single job walk recording)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id              SERIAL PRIMARY KEY,
    job_id          INTEGER REFERENCES jobs(id),
    title           VARCHAR(500),
    phase           VARCHAR(50),
    duration_secs   INTEGER,
    audio_path      VARCHAR(1000),
    transcript      TEXT,
    summary         TEXT,
    summary_json    JSONB,  -- structured: decisions, fixtures, action_items, flags
    discrepancies   JSONB,  -- plan vs conversation mismatches
    status          VARCHAR(50) DEFAULT 'uploading',  -- uploading, transcribing, summarizing, complete, error
    error_message   TEXT,
    recorded_at     TIMESTAMPTZ,
    processed_at    TIMESTAMPTZ,
    emailed_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_job ON sessions(job_id);
CREATE INDEX idx_sessions_status ON sessions(status);

-- -------------------------------------------
-- Attachments (PDFs, photos per session)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
    id              SERIAL PRIMARY KEY,
    session_id      INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    job_id          INTEGER REFERENCES jobs(id),
    file_type       VARCHAR(50),  -- pdf, image, document
    file_name       VARCHAR(500),
    file_path       VARCHAR(1000),
    file_size       INTEGER,
    analysis        JSONB,  -- extracted data from plans/images
    analysis_text   TEXT,   -- text summary of analysis for RAG
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attachments_session ON attachments(session_id);

-- -------------------------------------------
-- Transcript Chunks (for RAG / vector search)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS chunks (
    id              SERIAL PRIMARY KEY,
    session_id      INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    job_id          INTEGER REFERENCES jobs(id),
    chunk_type      VARCHAR(50) DEFAULT 'transcript',  -- transcript, summary, plan_analysis, action_item
    content         TEXT NOT NULL,
    section_label   VARCHAR(255),  -- room name from "Max, new room" commands
    is_flagged      BOOLEAN DEFAULT FALSE,  -- from "Max, flag that"
    timestamp_start FLOAT,  -- audio timestamp in seconds
    timestamp_end   FLOAT,
    embedding       vector(768),  -- nomic-embed-text dimension
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_session ON chunks(session_id);
CREATE INDEX idx_chunks_job ON chunks(job_id);
CREATE INDEX idx_chunks_type ON chunks(chunk_type);
CREATE INDEX idx_chunks_flagged ON chunks(is_flagged) WHERE is_flagged = TRUE;

-- Vector similarity search index
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- -------------------------------------------
-- Action Items (extracted from sessions)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS action_items (
    id              SERIAL PRIMARY KEY,
    session_id      INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    job_id          INTEGER REFERENCES jobs(id),
    description     TEXT NOT NULL,
    priority        VARCHAR(20) DEFAULT 'normal',  -- low, normal, high, critical
    due_date        DATE,
    completed       BOOLEAN DEFAULT FALSE,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_action_items_job ON action_items(job_id);
CREATE INDEX idx_action_items_open ON action_items(completed) WHERE completed = FALSE;

-- -------------------------------------------
-- Chat History (for conversational memory)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    role            VARCHAR(20) NOT NULL,  -- user, assistant
    content         TEXT NOT NULL,
    context_used    JSONB,  -- which chunks/sessions were pulled for RAG
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------
-- Notifications (push to Android app)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id              SERIAL PRIMARY KEY,
    type            VARCHAR(50) NOT NULL,   -- session_complete, discrepancy, error, info
    title           VARCHAR(500) NOT NULL,
    body            TEXT,
    data            JSONB,
    read            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_unread ON notifications(read) WHERE read = FALSE;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- -------------------------------------------
-- Full-text search indexes
-- -------------------------------------------
CREATE INDEX idx_sessions_transcript_search 
    ON sessions USING gin(to_tsvector('english', COALESCE(transcript, '')));

CREATE INDEX idx_sessions_summary_search 
    ON sessions USING gin(to_tsvector('english', COALESCE(summary, '')));

-- -------------------------------------------
-- Helper function: update timestamp
-- -------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jobs_updated     BEFORE UPDATE ON jobs     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_builders_updated BEFORE UPDATE ON builders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
