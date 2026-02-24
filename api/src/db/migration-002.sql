-- ============================================
-- MAX - Phase 3 Migration
-- Run after initial schema.sql
-- ============================================

-- Notifications table (for push to Android)
CREATE TABLE IF NOT EXISTS notifications (
    id              SERIAL PRIMARY KEY,
    type            VARCHAR(50) NOT NULL,   -- session_complete, discrepancy, error, info
    title           VARCHAR(500) NOT NULL,
    body            TEXT,
    data            JSONB,
    read            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- Add analysis columns if missing
DO $$ BEGIN
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS analysis_text TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Full-text search on transcripts
CREATE INDEX IF NOT EXISTS idx_sessions_transcript_search 
    ON sessions USING gin(to_tsvector('english', COALESCE(transcript, '')));

-- Full-text search on summaries  
CREATE INDEX IF NOT EXISTS idx_sessions_summary_search 
    ON sessions USING gin(to_tsvector('english', COALESCE(summary, '')));

-- Composite index for job + phase lookups
CREATE INDEX IF NOT EXISTS idx_sessions_job_phase ON sessions(job_id, phase);

-- Index for finding sessions by date range
CREATE INDEX IF NOT EXISTS idx_sessions_recorded ON sessions(recorded_at DESC);
