const fs = require('fs');
const path = require('path');
const config = require('../config');
const { logger } = require('../utils/logger');

/**
 * Transcribe audio file using faster-whisper server (OpenAI-compatible API)
 * Includes timeout handling
 */
async function transcribe(audioFilePath) {
  logger.info({ file: audioFilePath }, '[Whisper] Transcribing');
  
  // Read file into a Blob so native FormData can attach it with a filename
  const fileBuffer = await fs.promises.readFile(audioFilePath);
  const blob = new Blob([fileBuffer]);
  const form = new FormData();
  form.append('file', blob, path.basename(audioFilePath));
  form.append('model', 'base.en');
  form.append('response_format', 'verbose_json');
  form.append('language', 'en');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.whisper.timeout);

  try {
    const response = await fetch(`${config.whisper.url}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Whisper transcription failed (${response.status}): ${errText}`);
    }

    const result = await response.json();
    
    // Extract segments with timestamps for chunking
    const segments = (result.segments || []).map(seg => ({
      text: seg.text.trim(),
      start: seg.start,
      end: seg.end,
    }));

    const fullText = result.text || segments.map(s => s.text).join(' ');
    
    logger.info({ 
      segments: segments.length, 
      chars: fullText.length,
      duration: result.duration 
    }, '[Whisper] Transcription complete');
    
    return {
      text: fullText,
      segments,
      duration: result.duration || 0,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Whisper transcription timed out after ${config.whisper.timeout}ms`);
    }
    throw err;
  }
}

/**
 * Strip Max voice commands from transcript
 * Returns cleaned transcript + extracted commands
 */
function stripMaxCommands(text, segments) {
  const commandPatterns = [
    /\b(?:hey\s+)?max[,.]?\s*here\s+are\s+the\s+plans?\b/gi,
    /\b(?:hey\s+)?max[,.]?\s*take\s+a\s+photo\b/gi,
    /\b(?:hey\s+)?max[,.]?\s*new\s+room\s*[-–—]?\s*(\w[\w\s]*)/gi,
    /\b(?:hey\s+)?max[,.]?\s*flag\s+that\b/gi,
    /\b(?:hey\s+)?max[,.]?\s*this\s+is\s+(.*?)(?:\.|$)/gi,
    /\b(?:hey\s+)?max[,.]?\s*stop\b/gi,
    /\b(?:hey\s+)?max[,.]?\s*what'?s?\s+on\s+the\s+plans?\b/gi,
    /\bgot\s+it\s+max\b/gi,
    /\bhey\s+max\b/gi,
  ];

  const commands = [];
  let cleaned = text;

  for (const pattern of commandPatterns) {
    let match;
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      commands.push({
        raw: match[0],
        capture: match[1] || null,
        index: match.index,
      });
    }
    cleaned = cleaned.replace(pattern, ' ');
  }

  // Clean up extra whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  return { cleaned, commands };
}

/**
 * Parse extracted commands into structured metadata
 */
function parseCommands(commands) {
  const metadata = {
    roomMarkers: [],
    flags: [],
    jobTag: null,
    planAttachRequested: false,
    photoRequested: false,
  };

  for (const cmd of commands) {
    const raw = cmd.raw.toLowerCase();
    
    if (raw.includes('new room')) {
      metadata.roomMarkers.push(cmd.capture?.trim() || 'unnamed');
    } else if (raw.includes('flag that')) {
      metadata.flags.push(cmd.index);
    } else if (raw.includes('this is')) {
      metadata.jobTag = cmd.capture?.trim() || null;
    } else if (raw.includes('here are the plan')) {
      metadata.planAttachRequested = true;
    } else if (raw.includes('take a photo')) {
      metadata.photoRequested = true;
    }
  }

  return metadata;
}

module.exports = { transcribe, stripMaxCommands, parseCommands };
