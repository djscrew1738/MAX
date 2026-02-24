const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { processSession } = require('../services/pipeline');

const router = express.Router();

// --- File Filter ---
function fileFilter(allowedTypes) {
  return (req, file, cb) => {
    // Check MIME type
    if (allowedTypes.includes(file.mimetype)) {
      return cb(null, true);
    }
    
    // Also check extension as fallback
    const ext = path.extname(file.originalname).toLowerCase();
    const audioExts = ['.ogg', '.mp3', '.wav', '.webm', '.m4a', '.mp4'];
    const imageExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic'];
    
    if (allowedTypes.includes('audio/*') && audioExts.includes(ext)) {
      return cb(null, true);
    }
    if (allowedTypes.includes('image/*') && imageExts.includes(ext)) {
      return cb(null, true);
    }
    
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  };
}

// --- Multer config ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `${timestamp}-${uuidv4().substring(0, 8)}${ext}`);
  },
});

const uploadAudio = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: fileFilter(config.allowedFileTypes.audio),
});

const uploadAttachment = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: fileFilter(config.allowedFileTypes.attachment),
});

// --- Cleanup on error ---
function cleanupOnError(req, res, next) {
  const originalSend = res.send;
  res.send = function(data) {
    if (res.statusCode >= 400 && req.file) {
      // Delete uploaded file on error
      const fs = require('fs');
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('[Upload] Failed to cleanup file:', err);
      });
    }
    originalSend.call(this, data);
  };
  next();
}

/**
 * POST /api/upload/audio
 * Upload a recording and kick off the processing pipeline
 * 
 * Body (multipart):
 *  - audio: the audio file (ogg, mp3, wav, webm, m4a, mp4)
 *  - job_id (optional): link to existing job
 *  - builder (optional): builder name
 *  - subdivision (optional)
 *  - lot (optional)
 *  - phase (optional): underground, rough-in, top-out, trim, final
 *  - recorded_at (optional): ISO timestamp when recording started
 *  - title (optional): custom title for the session
 */
router.post('/audio', uploadAudio.single('audio'), cleanupOnError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No audio file provided',
        allowedTypes: config.allowedFileTypes.audio,
        maxSize: config.maxFileSize,
      });
    }

    const sizeMB = (req.file.size / 1024 / 1024).toFixed(2);
    console.log(`[Upload] 📁 Audio: ${req.file.originalname} (${sizeMB}MB) from ${req.ip}`);

    // Validate metadata
    const validPhases = ['underground', 'rough-in', 'top-out', 'trim', 'final'];
    const phase = req.body.phase?.toLowerCase();
    if (phase && !validPhases.includes(phase)) {
      return res.status(400).json({ 
        error: 'Invalid phase',
        allowedPhases: validPhases,
      });
    }

    // Create session record
    const { rows: [session] } = await db.query(
      `INSERT INTO sessions (job_id, title, phase, audio_path, status, recorded_at)
       VALUES ($1, $2, $3, $4, 'uploaded', $5)
       RETURNING id, created_at`,
      [
        req.body.job_id || null,
        req.body.title || `Walk ${new Date().toLocaleDateString()}`,
        phase || null,
        req.file.path,
        req.body.recorded_at || new Date().toISOString(),
      ]
    );

    console.log(`[Upload] ✅ Created session #${session.id}`);

    // Broadcast upload notification via WebSocket
    try {
      const { broadcast } = require('../index');
      broadcast({
        type: 'upload_complete',
        sessionId: session.id,
        filename: req.file.originalname,
        size: req.file.size,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      // WebSocket not critical
    }

    // Process async (don't block the response)
    setImmediate(() => {
      processSession(session.id).catch(err => {
        console.error(`[Upload] ❌ Background processing failed for session ${session.id}:`, err);
      });
    });

    res.json({
      success: true,
      session_id: session.id,
      status: 'uploaded',
      message: 'Audio uploaded successfully. Max is processing your recording...',
      estimated_time: '1-3 minutes',
    });

  } catch (err) {
    console.error('[Upload] ❌ Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/upload/attachment
 * Upload a PDF/photo to attach to a session or job
 * 
 * Body (multipart):
 *  - file: the file (PDF, JPG, PNG, WEBP)
 *  - session_id (optional): active session to attach to
 *  - job_id (optional): job to link to
 */
router.post('/attachment', uploadAttachment.single('file'), cleanupOnError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file provided',
        allowedTypes: config.allowedFileTypes.attachment,
        maxSize: config.maxFileSize,
      });
    }

    const sessionId = req.body.session_id || null;
    const jobId = req.body.job_id || null;

    if (!sessionId && !jobId) {
      return res.status(400).json({ 
        error: 'Either session_id or job_id is required' 
      });
    }

    // Determine file type
    const ext = path.extname(req.file.originalname).toLowerCase();
    let fileType = 'document';
    if (['.pdf'].includes(ext)) fileType = 'pdf';
    else if (['.jpg', '.jpeg', '.png', '.webp', '.heic'].includes(ext)) fileType = 'image';

    console.log(`[Upload] 📎 Attachment: ${req.file.originalname} (${fileType}, ${(req.file.size/1024).toFixed(1)}KB)`);

    const { rows: [attachment] } = await db.query(
      `INSERT INTO attachments (session_id, job_id, file_type, file_name, file_path, file_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [sessionId, jobId, fileType, req.file.originalname, req.file.path, req.file.size]
    );

    // Trigger plan analysis for PDFs in background
    if (fileType === 'pdf') {
      const { analyzePlan } = require('../services/plans');
      setImmediate(() => {
        analyzePlan(attachment.id).catch(err => {
          console.error(`[Upload] Plan analysis failed for attachment ${attachment.id}:`, err.message);
        });
      });
    }

    res.json({
      success: true,
      attachment_id: attachment.id,
      file_type: fileType,
      file_name: req.file.originalname,
      message: fileType === 'pdf' 
        ? 'Plans uploaded and being analyzed...' 
        : 'Photo attached successfully.',
    });

  } catch (err) {
    console.error('[Upload] ❌ Attachment error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/upload/status/:sessionId
 * Check processing status of an upload
 */
router.get('/status/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const { rows: [session] } = await db.query(
      `SELECT id, status, transcript, summary, error_message, 
              created_at, processed_at, duration_secs
       FROM sessions WHERE id = $1`,
      [sessionId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({
      session_id: session.id,
      status: session.status,
      has_transcript: !!session.transcript,
      has_summary: !!session.summary,
      duration_secs: session.duration_secs,
      error: session.error_message,
      created_at: session.created_at,
      processed_at: session.processed_at,
    });
    
  } catch (err) {
    console.error('[Upload] Status error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
