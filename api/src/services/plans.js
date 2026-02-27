const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../config');
const db = require('../db');
const { logger } = require('../utils/logger');
const { embedPlanAnalysis } = require('./embeddings');

/**
 * Analyze a PDF plan/blueprint using Ollama
 * Extracts: fixture counts, room layouts, specs, measurements
 */
async function analyzePlan(attachmentId) {
  const planLogger = logger.child({ attachmentId });
  planLogger.info('[Plans] Analyzing attachment');

  const { rows: [attachment] } = await db.query(
    'SELECT * FROM attachments WHERE id = $1 AND deleted_at IS NULL', [attachmentId]
  );
  if (!attachment) throw new Error(`Attachment ${attachmentId} not found`);

  const filePath = attachment.file_path;
  const fileType = attachment.file_type;

  let analysisText = '';
  let analysisJson = {};

  if (fileType === 'pdf') {
    analysisText = await extractPdfText(filePath);
    analysisJson = await analyzeWithOllama(analysisText, 'pdf');
  } else if (fileType === 'image') {
    // For images, we'll describe them through Ollama vision if available
    // For now, store as-is and flag for manual review
    analysisJson = { type: 'image', status: 'stored', needs_review: true };
    analysisText = `Photo attachment: ${attachment.file_name}`;
  }

  // Save analysis to attachment
  await db.query(
    `UPDATE attachments SET analysis = $1, analysis_text = $2 WHERE id = $3`,
    [JSON.stringify(analysisJson), analysisText, attachmentId]
  );

  // Embed for RAG
  if (analysisText && attachment.session_id) {
    await embedPlanAnalysis(
      attachment.session_id,
      attachment.job_id,
      `Plan Analysis for ${attachment.file_name}:\n${analysisText}\n\nExtracted Data:\n${JSON.stringify(analysisJson, null, 2)}`
    );
  }

  planLogger.info('[Plans] Analysis complete');
  return analysisJson;
}

/**
 * Extract text from PDF using pdftotext (poppler-utils)
 */
async function extractPdfText(filePath) {
  try {
    // Try pdftotext first (best for text-based PDFs)
    const outputPath = filePath.replace(/\.pdf$/i, '.txt');
    // Use execFileSync with an args array — never interpolate paths into a shell string
    execFileSync('pdftotext', ['-layout', filePath, outputPath], { timeout: 30000 });
    
    if (fs.existsSync(outputPath)) {
      const text = fs.readFileSync(outputPath, 'utf-8');
      fs.unlinkSync(outputPath); // cleanup
      if (text.trim().length > 50) {
        logger.info({ chars: text.length }, '[Plans] Extracted text via pdftotext');
        return text;
      }
    }
  } catch (err) {
    logger.info('[Plans] pdftotext failed, trying OCR approach');
  }

  // Fallback: convert to images and OCR
  try {
    return await ocrPdf(filePath);
  } catch (err) {
    logger.error({ err: err.message }, '[Plans] OCR also failed');
    return `[PDF could not be read: ${path.basename(filePath)}]`;
  }
}

/**
 * OCR a PDF by converting pages to images
 * Uses pdftoppm + basic text extraction through Ollama
 */
async function ocrPdf(filePath) {
  const tmpDir = path.join(path.dirname(filePath), `ocr_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Convert PDF pages to images (args as array — no shell injection)
    execFileSync(
      'pdftoppm',
      ['-jpeg', '-r', '200', '-l', '5', filePath, path.join(tmpDir, 'page')],
      { timeout: 60000 }
    );

    const pages = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith('.jpg'))
      .sort();

    if (pages.length === 0) {
      return '[No pages could be extracted from PDF]';
    }

    let fullText = '';
    
    for (const page of pages) {
      const pagePath = path.join(tmpDir, page);
      const pageText = await describeImageWithOllama(pagePath);
      fullText += `\n--- Page ${page} ---\n${pageText}\n`;
    }

    logger.info({ pages: pages.length }, '[Plans] OCR extracted text');
    return fullText;
  } finally {
    // Cleanup temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Use Ollama to describe/OCR an image
 * Works with llava or other vision models
 */
async function describeImageWithOllama(imagePath) {
  const imageBase64 = fs.readFileSync(imagePath).toString('base64');

  // Try vision model first (llava), fall back to text description
  const visionModel = config.ollama.visionModel;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.ollama.timeout);

  try {
    const response = await fetch(`${config.ollama.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: visionModel,
        prompt: `You are analyzing a construction plumbing plan/blueprint image. Extract ALL text, fixture symbols, room labels, pipe routing, and measurements you can see. Focus on:
- Room names and dimensions
- Plumbing fixture symbols and their locations (toilets, sinks, tubs, showers, hose bibs, water heaters)
- Pipe sizes and routing
- Any notes, specifications, or callouts
- Fixture counts per room

Be thorough and specific. List everything you can identify.`,
        images: [imageBase64],
        stream: false,
        options: { temperature: 0.1, num_predict: 2048 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json();
      return result.response || '';
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.warn('[Plans] Vision model request timed out');
    } else {
      logger.info(`[Plans] Vision model (${visionModel}) not available: ${err.message}`);
    }
  }

  return '[Image - vision model not available for analysis]';
}

/**
 * Analyze extracted text with Ollama to produce structured plan data
 */
async function analyzeWithOllama(text, sourceType = 'pdf') {
  if (!text || text.length < 20) {
    return { error: 'Insufficient text extracted', raw_length: text?.length || 0 };
  }

  const prompt = `You are analyzing a construction plumbing plan document. The text below was extracted from a ${sourceType} file.

Analyze it and extract ALL plumbing-related information. Respond ONLY with valid JSON:

{
  "document_type": "floor_plan|plumbing_plan|mechanical_plan|spec_sheet|other",
  "rooms": [
    {
      "name": "Master Bathroom",
      "fixtures": [
        {"type": "toilet", "count": 1, "specs": "elongated"},
        {"type": "lavatory_sink", "count": 2, "specs": "double vanity"},
        {"type": "shower", "count": 1, "specs": "walk-in"}
      ]
    }
  ],
  "total_fixtures": {
    "toilets": 0,
    "lavatory_sinks": 0,
    "kitchen_sinks": 0,
    "tubs": 0,
    "showers": 0,
    "hose_bibs": 0,
    "water_heaters": 0,
    "dishwashers": 0,
    "washing_machines": 0,
    "ice_makers": 0,
    "gas_lines": 0,
    "floor_drains": 0,
    "cleanouts": 0,
    "total": 0
  },
  "pipe_specs": ["any pipe sizes, materials, or routing noted"],
  "special_notes": ["any callouts, exceptions, or special requirements"],
  "water_heater": {
    "type": "tank|tankless|null",
    "location": "location if noted",
    "specs": "any specs"
  },
  "confidence": "high|medium|low"
}

Here is the extracted text:

${text.substring(0, 8000)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.ollama.timeout);

  try {
    const response = await fetch(`${config.ollama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.2, num_predict: 2048 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Ollama failed: ${response.status}`);

    const result = await response.json();
    const content = result.message?.content || '';
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    return JSON.parse(cleaned);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.error('[Plans] Ollama analysis timed out');
      return { error: 'Analysis timed out', raw_text_length: text.length };
    }
    logger.error({ err: err.message }, '[Plans] Ollama analysis failed');
    return { error: err.message, raw_text_length: text.length };
  }
}

/**
 * Compare plan analysis with session transcript summary
 * Returns discrepancy report
 */
async function crossReference(planAnalysis, sessionSummary) {
  if (!planAnalysis || !sessionSummary) return null;
  if (planAnalysis.error) return null;

  const prompt = `You are cross-referencing a plumbing plan analysis with notes from a job walk conversation.

PLAN DATA:
${JSON.stringify(planAnalysis, null, 2)}

JOB WALK SUMMARY:
${JSON.stringify(sessionSummary, null, 2)}

Compare these two sources and identify ALL discrepancies. Focus on:
1. Fixture counts: Do the numbers match?
2. Fixture types: Are the same fixtures in both sources?
3. Locations: Are fixtures in the same rooms?
4. Specs: Do upgrade/downgrade mentions match the plans?
5. Missing items: Anything in one source but not the other?

Respond ONLY with valid JSON:
{
  "match_score": 0-100,
  "discrepancies": [
    {
      "category": "fixture_count|fixture_type|location|spec|missing",
      "plan_says": "what the plans show",
      "conversation_says": "what was discussed",
      "severity": "low|medium|high|critical",
      "recommendation": "what to verify or do"
    }
  ],
  "matches": ["things that align correctly"],
  "overall_recommendation": "one sentence summary of what needs attention"
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.ollama.timeout);

  try {
    const response = await fetch(`${config.ollama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.2, num_predict: 2048 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;
    
    const result = await response.json();
    const content = result.message?.content || '';
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    return JSON.parse(cleaned);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.error('[Plans] Cross-reference timed out');
    } else {
      logger.error({ err: err.message }, '[Plans] Cross-reference failed');
    }
    return null;
  }
}

module.exports = { analyzePlan, extractPdfText, analyzeWithOllama, crossReference };
