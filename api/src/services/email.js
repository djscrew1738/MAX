const nodemailer = require('nodemailer');
const config = require('../config');
const { logger } = require('../utils/logger');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });
  }
  return transporter;
}

/**
 * Send job walk summary email
 */
async function sendSummaryEmail(summaryText, summaryJson, session = {}) {
  if (!config.email.user || !config.email.to) {
    logger.info('[Email] Skipping — no email configured');
    return false;
  }

  const subject = buildSubject(summaryJson, session);
  const html = buildHtmlEmail(summaryText, summaryJson, session);

  try {
    const info = await getTransporter().sendMail({
      from: `"Max 🔨" <${config.email.from}>`,
      to: config.email.to,
      subject,
      text: summaryText,
      html,
    });

    logger.info({ messageId: info.messageId }, '[Email] Summary sent');
    return true;
  } catch (err) {
    logger.error({ err }, '[Email] Failed to send');
    return false;
  }
}

function buildSubject(json, session) {
  const parts = ['Max'];
  if (json.builder_name) parts.push(json.builder_name);
  if (json.subdivision) parts.push(json.subdivision);
  if (json.lot_number) parts.push(`Lot ${json.lot_number}`);
  if (json.phase) parts.push(json.phase);
  if (parts.length === 1) parts.push('Job Walk Summary');
  return `🔨 ${parts.join(' — ')}`;
}

function buildHtmlEmail(summaryText, json, session) {
  const actionItems = (json.action_items || [])
    .map(item => {
      const icon = item.priority === 'critical' ? '🔴' : item.priority === 'high' ? '🟡' : '⬜';
      const due = item.due ? ` <span style="color:#888">(by ${item.due})</span>` : '';
      return `<tr><td style="padding:4px 8px">${icon}</td><td style="padding:4px 8px">${item.description}${due}</td></tr>`;
    })
    .join('');

  const decisions = (json.key_decisions || [])
    .map(d => `<li style="margin-bottom:6px">${d}</li>`)
    .join('');

  const flags = (json.flags || [])
    .map(f => `<li style="margin-bottom:6px;color:#c0392b">⚠️ ${f}</li>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8f9fa">
  
  <div style="background:#1a1a2e;color:#fff;padding:20px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">🔨 MAX — Job Walk Summary</h1>
  </div>
  
  <div style="background:#fff;padding:20px;border:1px solid #e0e0e0">
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      ${json.builder_name ? `<tr><td style="padding:4px 0;color:#666;width:110px">Builder</td><td style="padding:4px 0;font-weight:600">${json.builder_name}</td></tr>` : ''}
      ${json.subdivision ? `<tr><td style="padding:4px 0;color:#666">Subdivision</td><td style="padding:4px 0;font-weight:600">${json.subdivision}</td></tr>` : ''}
      ${json.lot_number ? `<tr><td style="padding:4px 0;color:#666">Lot</td><td style="padding:4px 0;font-weight:600">${json.lot_number}</td></tr>` : ''}
      ${json.phase ? `<tr><td style="padding:4px 0;color:#666">Phase</td><td style="padding:4px 0;font-weight:600">${json.phase}</td></tr>` : ''}
      ${session.recorded_at ? `<tr><td style="padding:4px 0;color:#666">Date</td><td style="padding:4px 0">${new Date(session.recorded_at).toLocaleDateString()}</td></tr>` : ''}
      ${session.duration_secs ? `<tr><td style="padding:4px 0;color:#666">Duration</td><td style="padding:4px 0">${Math.round(session.duration_secs / 60)} min</td></tr>` : ''}
    </table>

    ${decisions ? `
    <h2 style="font-size:16px;color:#1a1a2e;border-bottom:2px solid #f0f0f0;padding-bottom:8px">Key Decisions</h2>
    <ul style="padding-left:20px">${decisions}</ul>
    ` : ''}

    ${json.fixture_changes ? `
    <h2 style="font-size:16px;color:#1a1a2e;border-bottom:2px solid #f0f0f0;padding-bottom:8px">Fixture Changes</h2>
    ${json.fixture_changes.mentioned_count ? `<p><strong>Count mentioned:</strong> ${json.fixture_changes.mentioned_count}</p>` : ''}
    <ul style="padding-left:20px">
      ${(json.fixture_changes.details || []).map(d => `<li style="margin-bottom:4px">${d}</li>`).join('')}
    </ul>
    ` : ''}

    ${actionItems ? `
    <h2 style="font-size:16px;color:#1a1a2e;border-bottom:2px solid #f0f0f0;padding-bottom:8px">Action Items</h2>
    <table style="width:100%">${actionItems}</table>
    ` : ''}

    ${flags ? `
    <h2 style="font-size:16px;color:#c0392b;border-bottom:2px solid #f0f0f0;padding-bottom:8px">⚠️ Flags</h2>
    <ul style="padding-left:20px">${flags}</ul>
    ` : ''}

    ${json.notes ? `
    <h2 style="font-size:16px;color:#1a1a2e;border-bottom:2px solid #f0f0f0;padding-bottom:8px">Notes</h2>
    <p style="color:#444">${json.notes}</p>
    ` : ''}
  </div>
  
  <div style="background:#f0f0f0;padding:12px 20px;border-radius:0 0 8px 8px;text-align:center;color:#888;font-size:12px">
    Max — AI Field Assistant for CTL Plumbing LLC
  </div>
  
</body>
</html>`;
}

module.exports = { sendSummaryEmail };
