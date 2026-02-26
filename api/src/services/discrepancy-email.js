const nodemailer = require('nodemailer');
const config = require('../config');
const { logger } = require('../utils/logger');

let transporter = null;

function getTransporter() {
  if (!transporter && config.email.user) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }
  return transporter;
}

/**
 * Send discrepancy alert email
 */
async function sendDiscrepancyAlert(discrepancies, sessionInfo = {}) {
  if (!getTransporter() || !config.email.to) return false;

  const jobLabel = [sessionInfo.builder, sessionInfo.subdivision, sessionInfo.lot]
    .filter(Boolean).join(' — ') || 'Unknown Job';

  const highItems = (discrepancies.items || []).filter(d => 
    d.severity === 'high' || d.severity === 'critical'
  );
  const medItems = (discrepancies.items || []).filter(d => d.severity === 'medium');
  const lowItems = (discrepancies.items || []).filter(d => d.severity === 'low');

  const discrepancyRows = (discrepancies.items || []).map(d => {
    const color = d.severity === 'critical' ? '#e74c3c' : 
                  d.severity === 'high' ? '#e67e22' :
                  d.severity === 'medium' ? '#f1c40f' : '#95a5a6';
    const icon = d.severity === 'critical' ? '🔴' : 
                 d.severity === 'high' ? '🟠' : 
                 d.severity === 'medium' ? '🟡' : '⚪';

    return `
      <tr style="border-bottom:1px solid #30363d">
        <td style="padding:12px 8px;vertical-align:top">${icon}</td>
        <td style="padding:12px 8px">
          <div style="font-weight:600;color:#e6edf3">${d.description}</div>
          ${d.plan_says ? `<div style="color:#8b949e;font-size:13px;margin-top:4px">📄 Plans: ${d.plan_says}</div>` : ''}
          ${d.conversation_says ? `<div style="color:#8b949e;font-size:13px">🎙️ Discussed: ${d.conversation_says}</div>` : ''}
          ${d.recommendation ? `<div style="color:#00d4ff;font-size:13px;margin-top:4px">→ ${d.recommendation}</div>` : ''}
        </td>
        <td style="padding:12px 8px;color:${color};font-weight:600;text-transform:uppercase;font-size:12px">${d.severity}</td>
      </tr>`;
  }).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8f9fa">
  
  <div style="background:#c0392b;color:#fff;padding:20px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">⚠️ MAX — Plan Discrepancies Found</h1>
    <p style="margin:8px 0 0;opacity:0.9">${jobLabel}</p>
  </div>
  
  <div style="background:#0d1117;padding:20px;border:1px solid #30363d">
    <div style="display:flex;gap:16px;margin-bottom:20px">
      <div style="background:#1c2333;padding:12px 16px;border-radius:8px;flex:1;text-align:center">
        <div style="color:#e74c3c;font-size:24px;font-weight:bold">${highItems.length}</div>
        <div style="color:#8b949e;font-size:12px">HIGH</div>
      </div>
      <div style="background:#1c2333;padding:12px 16px;border-radius:8px;flex:1;text-align:center">
        <div style="color:#f1c40f;font-size:24px;font-weight:bold">${medItems.length}</div>
        <div style="color:#8b949e;font-size:12px">MEDIUM</div>
      </div>
      <div style="background:#1c2333;padding:12px 16px;border-radius:8px;flex:1;text-align:center">
        <div style="color:#95a5a6;font-size:24px;font-weight:bold">${lowItems.length}</div>
        <div style="color:#8b949e;font-size:12px">LOW</div>
      </div>
    </div>

    ${discrepancies.overall_recommendation ? `
    <div style="background:#1c2333;border-left:3px solid #00d4ff;padding:12px 16px;margin-bottom:20px;border-radius:0 8px 8px 0">
      <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:4px">RECOMMENDATION</div>
      <div style="color:#e6edf3">${discrepancies.overall_recommendation}</div>
    </div>
    ` : ''}

    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:2px solid #30363d">
          <th style="padding:8px;text-align:left;color:#8b949e;font-size:12px;width:30px"></th>
          <th style="padding:8px;text-align:left;color:#8b949e;font-size:12px">DISCREPANCY</th>
          <th style="padding:8px;text-align:left;color:#8b949e;font-size:12px;width:80px">SEVERITY</th>
        </tr>
      </thead>
      <tbody>
        ${discrepancyRows}
      </tbody>
    </table>

    ${(discrepancies.matches || []).length > 0 ? `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #30363d">
      <div style="color:#00ff88;font-size:12px;font-weight:600;margin-bottom:8px">✅ MATCHES</div>
      ${discrepancies.matches.map(m => `<div style="color:#8b949e;font-size:13px;margin-bottom:4px">• ${m}</div>`).join('')}
    </div>
    ` : ''}
  </div>
  
  <div style="background:#161b22;padding:12px 20px;border-radius:0 0 8px 8px;text-align:center;color:#6e7681;font-size:12px">
    Max — AI Field Assistant for CTL Plumbing LLC<br>
    Match Score: ${discrepancies.match_score || '—'}/100
  </div>
  
</body>
</html>`;

  try {
    await getTransporter().sendMail({
      from: `"Max ⚠️" <${config.email.from}>`,
      to: config.email.to,
      subject: `⚠️ Max — ${highItems.length} discrepancies found — ${jobLabel}`,
      text: `Discrepancies found for ${jobLabel}:\n\n${(discrepancies.items || []).map(d => `[${d.severity}] ${d.description}`).join('\n')}`,
      html,
    });
    logger.info('[Email] Discrepancy alert sent');
    return true;
  } catch (err) {
    logger.error({ err }, '[Email] Discrepancy alert failed');
    return false;
  }
}

module.exports = { sendDiscrepancyAlert };
