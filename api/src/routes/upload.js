const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const NodeClam = require('clamscan');
const db = require('../db');
const config = require('../config');
const { logger } = require('../utils/logger');
const { validateFileType } = require('../middlewares/security');
const { processSession } = require('../services/pipeline');

const router = express.Router();

// ClamAV scanner state — retried every 5 minutes on failure
let clamScanner = null;
let clamLastError = null;
let clamLastAttempt = 0;
const CLAM_RETRY_MS = 5 * 60 * 1000; // retry init every 5 minutes

async function getClamScanner() {
  if (!config.clamav.enabled) {
    return null;
  }

  if (clamScanner) {
    return clamScanner;
  }

  // Back-off: don't hammer ClamAV if it keeps failing
  const now = Date.now();
  if (clamLastError && now - clamLastAttempt < CLAM_RETRY_MS) {
    throw new Error(`ClamAV unavailable (last error: ${clamLastError})`);
  }

  clamLastAttempt = now;
  try {
    clamScanner = await new NodeClam().init({
      clamdscan: {
        host: config.clamav.host,
        port: config.clamav.port,
        timeout: 60000,
      },
      preference: 'clamdscan',
    });
    clamLastError = null;
    logger.info('[ClamAV] Scanner initialized');
    return clamScanner;
  } catch (err) {
    clamLastError = err.message;
    clamScanner = null; // allow retry next window
    logger.error({ err }, '[ClamAV] Failed to initialize scanner');
    throw err; // propagate so scanFile can fail closed
  }
}

// --- Multer config ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.ogg';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxSize },
});

/**
 * Scan file for viruses
 */
async function scanFile(filePath) {
  let scanner;
  try {
    scanner = await getClamScanner();
  } catch (err) {
    // ClamAV enabled but unavailable — fail closed (reject file)
    logger.error({ err, filePath }, '[ClamAV] Scanner unavailable, rejecting file');
    return { clean: false, error: err.message };
  }

  if (!scanner) {
    // ClamAV explicitly disabled — allow through
    return { clean: true, skipped: true };
  }

  try {
    const { isInfected, viruses } = await scanner.isInfected(filePath);
    if (isInfected) {
      logger.warn({ viruses, filePath }, '[ClamAV] Virus detected');
      return { clean: false, viruses };
    }
    return { clean: true };
  } catch (err) {
    // Runtime scan error — fail closed
    clamScanner = null; // force re-init on next request
    logger.error({ err, filePath }, '[ClamAV] Scan error, rejecting file');
    return { clean: false, error: err.message };
  }
}

/**
 * POST /api/upload/audio
 * Upload a recording and kick off the processing pipeline
 * 
 * Body (multipart):
 *  - audio: the audio file
 *  - job_id (optional): link to existing job
 *  - builder (optional): builder name
 *  - subdivision (optional)
 *  - lot (optional)
 *  - phase (optional)
 *  - recorded_at (optional): ISO timestamp when recording started
 */
router.post('/audio', 
  upload.single('audio'),
  validateFileType(config.upload.allowedAudioTypes),
  async (req, res) => {
    const reqLogger = logger.child({ reqId: req.id });
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      reqLogger.info({
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      }, '[Upload] Received audio file');

      // Scan for viruses
      const scanResult = await scanFile(req.file.path);
      if (!scanResult.clean) {
        // Delete infected file
        const fs = require('fs');
        fs.unlinkSync(req.file.path);
        
        return res.status(400).json({ 
          error: 'File rejected',
          reason: scanResult.viruses ? 'Virus detected' : 'Scan failed',
          viruses: scanResult.viruses,
        });
      }

      // Create session record
      const { rows: [session] } = await db.query(
        `INSERT INTO sessions (job_id, title, phase, audio_path, status, recorded_at)
         VALUES ($1, $2, $3, $4, 'uploaded', $5)
         RETURNING id`,
        [
          req.body.job_id || null,
          req.body.title || `Walk ${new Date().toLocaleDateString()}`,
          req.body.phase || null,
          req.file.path,
          req.body.recorded_at || new Date().toISOString(),
        ]
      );

      reqLogger.info({ sessionId: session.id }, '[Upload] Created session');

      // Process async (don't block the response)
      processSession(session.id).catch(err => {
        reqLogger.error({ sessionId: session.id, err }, '[Upload] Background processing failed');
      });

      res.json({
        success: true,
        session_id: session.id,
        message: 'Audio uploaded. Max is processing your recording...',
      });

    } catch (err) {
      reqLogger.error({ err }, '[Upload] Error handling audio upload');
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/upload/attachment
 * Upload a PDF/photo to attach to a session
 * 
 * Body (multipart):
 *  - file: the file (PDF, image)
 *  - session_id: active session to attach to
 *  - job_id (optional): job to link to
 */
router.post('/attachment', 
  upload.single('file'),
  validateFileType([...config.upload.allowedImageTypes, ...config.upload.allowedDocumentTypes]),
  async (req, res) => {
    const reqLogger = logger.child({ reqId: req.id });
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const sessionId = req.body.session_id || null;
      const jobId = req.body.job_id || null;

      if (!sessionId && !jobId) {
        return res.status(400).json({ error: 'session_id or job_id required' });
      }

      // Scan for viruses
      const scanResult = await scanFile(req.file.path);
      if (!scanResult.clean) {
        const fs = require('fs');
        fs.unlinkSync(req.file.path);
        
        return res.status(400).json({ 
          error: 'File rejected',
          reason: scanResult.viruses ? 'Virus detected' : 'Scan failed',
          viruses: scanResult.viruses,
        });
      }

      // Determine file type
      const ext = path.extname(req.file.originalname).toLowerCase();
      let fileType = 'document';
      if (['.pdf'].includes(ext)) fileType = 'pdf';
      if (['.jpg', '.jpeg', '.png', '.webp', '.heic'].includes(ext)) fileType = 'image';

      reqLogger.info({
        filename: req.file.originalname,
        fileType,
        size: req.file.size,
      }, '[Upload] Attachment received');

      const { rows: [attachment] } = await db.query(
        `INSERT INTO attachments (session_id, job_id, file_type, file_name, file_path, file_size)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [sessionId, jobId, fileType, req.file.originalname, req.file.path, req.file.size]
      );

      // Trigger plan analysis for PDFs in background
      if (fileType === 'pdf') {
        const { analyzePlan } = require('../services/plans');
        analyzePlan(attachment.id).catch(err => {
          reqLogger.error({ attachmentId: attachment.id, err }, '[Upload] Plan analysis failed');
        });
      }

      res.json({
        success: true,
        attachment_id: attachment.id,
        file_type: fileType,
        message: `Got it! ${fileType === 'pdf' ? 'Plans' : 'Photo'} attached.`,
      });

    } catch (err) {
      reqLogger.error({ err }, '[Upload] Attachment error');
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
