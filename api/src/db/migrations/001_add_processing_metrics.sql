-- Migration: Add processing metrics columns
-- Created: 2024-01-01

-- Add processing time tracking to sessions
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS processing_duration_secs INTEGER;

-- Add index for processing time queries
CREATE INDEX IF NOT EXISTS idx_sessions_processing_duration 
ON sessions(processing_duration_secs) 
WHERE processing_duration_secs IS NOT NULL;

-- Add file size tracking
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

-- Add transcription quality metrics
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS transcript_confidence FLOAT;
