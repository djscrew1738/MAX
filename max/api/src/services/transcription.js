const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');
const config = require('../config');

/**
 * Transcribe audio file using faster-whisper server (OpenAI-compatible API)
 */
async function transcribe(audioFilePath) {
  console.log(`[Whisper] Transcribing: ${audioFilePath}`);
  
  const form = new FormData();
  form.append('file', fs.createReadStream(audioFilePath));
  form.append('model', 'base.en');
  form.append('response_format', 'verbose_json');
  form.append('language', 'en');

  const response = await fetch(`${config.whisper.url}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

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
  
  console.log(`[Whisper] Transcribed ${segments.length} segments, ${fullText.length} chars`);
  
  return {
    text: fullText,
    segments,
    duration: result.duration || 0,
  };
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
