const express = require('express');
const db = require('../db');
const os = require('os');

const router = express.Router();

// Simple metrics storage (in production, use Prometheus client)
const metrics = {
  requests: new Map(),
  uploads: { total: 0, success: 0, failed: 0 },
  processing: { total: 0, success: 0, failed: 0, duration: [] },
  sessions: new Map(),
};

/**
 * Record request metrics
 */
function recordRequest(method, path, statusCode, duration) {
  const key = `${method}:${path}`;
  if (!metrics.requests.has(key)) {
    metrics.requests.set(key, { count: 0, errors: 0, totalDuration: 0 });
  }
  const metric = metrics.requests.get(key);
  metric.count++;
  metric.totalDuration += duration;
  if (statusCode >= 400) metric.errors++;
}

/**
 * Record upload metrics
 */
function recordUpload(success) {
  metrics.uploads.total++;
  if (success) metrics.uploads.success++;
  else metrics.uploads.failed++;
}

/**
 * Record processing metrics
 */
function recordProcessing(success, duration) {
  metrics.processing.total++;
  metrics.processing.duration.push(duration);
  // Keep last 1000 durations
  if (metrics.processing.duration.length > 1000) {
    metrics.processing.duration.shift();
  }
  if (success) metrics.processing.success++;
  else metrics.processing.failed++;
}

/**
 * GET /metrics - Prometheus-compatible metrics
 */
router.get('/', async (req, res) => {
  try {
    // Get database stats
    const { rows: [dbStats] } = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM sessions) as total_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'complete') as completed_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'error') as error_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status IN ('transcribing', 'summarizing')) as processing_sessions,
        (SELECT COUNT(*) FROM jobs) as total_jobs,
        (SELECT COUNT(*) FROM chunks) as total_chunks,
        (SELECT COUNT(*) FROM action_items WHERE completed = FALSE) as open_actions,
        (SELECT COUNT(*) FROM notifications WHERE read = FALSE) as unread_notifications
    `);

    // Calculate processing stats
    const durations = metrics.processing.duration;
    const avgDuration = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;

    // Build Prometheus format
    const output = [];
    
    // System metrics
    output.push(`# HELP max_uptime_seconds System uptime`);
    output.push(`# TYPE max_uptime_seconds gauge`);
    output.push(`max_uptime_seconds ${process.uptime()}`);
    
    output.push(`# HELP max_memory_bytes Memory usage`);
    output.push(`# TYPE max_memory_bytes gauge`);
    const memUsage = process.memoryUsage();
    output.push(`max_memory_bytes{type="rss"} ${memUsage.rss}`);
    output.push(`max_memory_bytes{type="heapUsed"} ${memUsage.heapUsed}`);
    output.push(`max_memory_bytes{type="heapTotal"} ${memUsage.heapTotal}`);
    output.push(`max_memory_bytes{type="external"} ${memUsage.external}`);
    
    output.push(`# HELP max_cpu_load CPU load average`);
    output.push(`# TYPE max_cpu_load gauge`);
    const loadAvg = os.loadavg();
    output.push(`max_cpu_load{interval="1m"} ${loadAvg[0]}`);
    output.push(`max_cpu_load{interval="5m"} ${loadAvg[1]}`);
    output.push(`max_cpu_load{interval="15m"} ${loadAvg[2]}`);

    // Database metrics
    output.push(`# HELP max_db_sessions_total Total sessions`);
    output.push(`# TYPE max_db_sessions_total gauge`);
    output.push(`max_db_sessions_total ${dbStats.total_sessions}`);
    
    output.push(`# HELP max_db_sessions Sessions by status`);
    output.push(`# TYPE max_db_sessions gauge`);
    output.push(`max_db_sessions{status="complete"} ${dbStats.completed_sessions}`);
    output.push(`max_db_sessions{status="error"} ${dbStats.error_sessions}`);
    output.push(`max_db_sessions{status="processing"} ${dbStats.processing_sessions}`);
    
    output.push(`# HELP max_db_jobs_total Total jobs`);
    output.push(`# TYPE max_db_jobs_total gauge`);
    output.push(`max_db_jobs_total ${dbStats.total_jobs}`);
    
    output.push(`# HELP max_db_chunks_total Total chunks`);
    output.push(`# TYPE max_db_chunks_total gauge`);
    output.push(`max_db_chunks_total ${dbStats.total_chunks}`);
    
    output.push(`# HELP max_db_open_actions Open action items`);
    output.push(`# TYPE max_db_open_actions gauge`);
    output.push(`max_db_open_actions ${dbStats.open_actions}`);

    // Upload metrics
    output.push(`# HELP max_uploads_total Total uploads`);
    output.push(`# TYPE max_uploads_total counter`);
    output.push(`max_uploads_total ${metrics.uploads.total}`);
    
    output.push(`# HELP max_uploads Uploads by status`);
    output.push(`# TYPE max_uploads counter`);
    output.push(`max_uploads{status="success"} ${metrics.uploads.success}`);
    output.push(`max_uploads{status="failed"} ${metrics.uploads.failed}`);

    // Processing metrics
    output.push(`# HELP max_processing_total Total processing jobs`);
    output.push(`# TYPE max_processing_total counter`);
    output.push(`max_processing_total ${metrics.processing.total}`);
    
    output.push(`# HELP max_processing_duration_seconds Processing duration`);
    output.push(`# TYPE max_processing_duration_seconds summary`);
    output.push(`max_processing_duration_seconds_sum ${durations.reduce((a, b) => a + b, 0)}`);
    output.push(`max_processing_duration_seconds_count ${durations.length}`);
    output.push(`max_processing_duration_seconds_avg ${avgDuration.toFixed(2)}`);

    // Request metrics
    output.push(`# HELP max_requests_total Total requests`);
    output.push(`# TYPE max_requests_total counter`);
    for (const [key, metric] of metrics.requests) {
      const [method, path] = key.split(':');
      output.push(`max_requests_total{method="${method}",path="${path}"} ${metric.count}`);
    }

    res.set('Content-Type', 'text/plain');
    res.send(output.join('\n'));
  } catch (err) {
    res.status(500).send(`# Error: ${err.message}`);
  }
});

/**
 * GET /metrics/dashboard - JSON dashboard data
 */
router.get('/dashboard', async (req, res) => {
  try {
    const { rows: [stats] } = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM sessions) as total_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'complete') as completed_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status = 'error') as error_sessions,
        (SELECT COUNT(*) FROM sessions WHERE status IN ('transcribing', 'summarizing')) as processing_sessions,
        (SELECT COUNT(*) FROM jobs) as total_jobs,
        (SELECT COUNT(*) FROM chunks) as total_chunks,
        (SELECT COUNT(*) FROM action_items WHERE completed = FALSE) as open_actions,
        (SELECT COUNT(*) FROM attachments) as total_attachments,
        (SELECT COUNT(*) FROM notifications WHERE read = FALSE) as unread_notifications,
        (SELECT COUNT(*) FROM sessions WHERE created_at > NOW() - INTERVAL '24 hours') as sessions_24h,
        (SELECT COUNT(*) FROM sessions WHERE created_at > NOW() - INTERVAL '7 days') as sessions_7d
    `);

    // Get recent processing times
    const { rows: recentSessions } = await db.query(`
      SELECT 
        id, 
        status, 
        created_at, 
        processed_at,
        EXTRACT(EPOCH FROM (processed_at - created_at)) as processing_seconds
      FROM sessions 
      WHERE processed_at IS NOT NULL
      ORDER BY processed_at DESC 
      LIMIT 10
    `);

    res.json({
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: os.loadavg(),
        timestamp: new Date().toISOString(),
      },
      database: stats,
      metrics: {
        uploads: metrics.uploads,
        processing: {
          ...metrics.processing,
          avg_duration_seconds: metrics.processing.duration.length > 0 
            ? metrics.processing.duration.reduce((a, b) => a + b, 0) / metrics.processing.duration.length 
            : 0,
        },
      },
      recent_sessions: recentSessions.map(s => ({
        id: s.id,
        status: s.status,
        processing_time: Math.round(s.processing_seconds),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, recordRequest, recordUpload, recordProcessing };
