const nodemailer = require('nodemailer');
const config = require('../config');
const { logger } = require('../utils/logger');

let transporter = null;
function getTransporter() {
  if (!transporter && config.email.user) {
    transporter = nodemailer.createTransport({
      host: config.email.host, port: config.email.port,
      secure: config.email.port === 465,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }
  return transporter;
}

async function sendDigestEmail(digestText, stats) {
  if (!getTransporter() || !config.email.to) return false;

  const startDate = new Date(stats.periodStart).toLocaleDateString();
  const endDate = new Date(stats.periodEnd).toLocaleDateString();

  // Convert markdown-ish text to HTML paragraphs
  const htmlBody = digestText
    .split('\n')
    .map(line => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return `<h2 style="color:#00d4ff;font-size:16px;margin:20px 0 8px;border-bottom:1px solid #30363d;padding-bottom:8px">${line.replace(/\*\*/g, '')}</h2>`;
      }
      if (line.startsWith('## ')) {
        return `<h2 style="color:#00d4ff;font-size:16px;margin:20px 0 8px;border-bottom:1px solid #30363d;padding-bottom:8px">${line.replace('## ', '')}</h2>`;
      }
      if (line.startsWith('- ') || line.startsWith('• ')) {
        return `<div style="margin:4px 0 4px 16px;color:#e6edf3">• ${line.substring(2)}</div>`;
      }
      if (line.trim() === '') return '<br>';
      return `<p style="margin:6px 0;color:#e6edf3">${line}</p>`;
    })
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:650px;margin:0 auto;padding:20px;background:#f8f9fa">
  
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:22px">📊 MAX — Weekly Intelligence Digest</h1>
    <p style="margin:8px 0 0;opacity:0.8;font-size:14px">${startDate} — ${endDate}</p>
  </div>

  <div style="background:#0d1117;padding:4px 20px">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="padding:16px;text-align:center;border-right:1px solid #30363d">
          <div style="color:#00d4ff;font-size:28px;font-weight:bold">${stats.walks}</div>
          <div style="color:#8b949e;font-size:11px;text-transform:uppercase">Walks</div>
        </td>
        <td style="padding:16px;text-align:center;border-right:1px solid #30363d">
          <div style="color:#00ff88;font-size:28px;font-weight:bold">${stats.minutes}m</div>
          <div style="color:#8b949e;font-size:11px;text-transform:uppercase">Recorded</div>
        </td>
        <td style="padding:16px;text-align:center;border-right:1px solid #30363d">
          <div style="color:#ff9500;font-size:28px;font-weight:bold">${stats.activeJobs}</div>
          <div style="color:#8b949e;font-size:11px;text-transform:uppercase">Active Jobs</div>
        </td>
        <td style="padding:16px;text-align:center;border-right:1px solid #30363d">
          <div style="color:#ff4444;font-size:28px;font-weight:bold">${stats.openActions}</div>
          <div style="color:#8b949e;font-size:11px;text-transform:uppercase">Open Items</div>
        </td>
        <td style="padding:16px;text-align:center">
          <div style="color:#f1c40f;font-size:28px;font-weight:bold">${stats.discrepancies}</div>
          <div style="color:#8b949e;font-size:11px;text-transform:uppercase">Discrepancies</div>
        </td>
      </tr>
    </table>
  </div>

  <div style="background:#0d1117;padding:20px;border:1px solid #30363d;border-top:none">
    ${htmlBody}
  </div>

  <div style="background:#161b22;padding:16px 20px;border-radius:0 0 8px 8px;text-align:center;color:#6e7681;font-size:12px">
    Max — AI Field Assistant for CTL Plumbing LLC<br>
    Generated ${new Date().toLocaleString()}
  </div>
  
</body>
</html>`;

  try {
    await getTransporter().sendMail({
      from: `"Max 📊" <${config.email.from}>`,
      to: config.email.to,
      subject: `📊 Max Weekly Digest — ${stats.walks} walks, ${stats.openActions} open items`,
      text: digestText,
      html,
    });
    logger.info('[Email] Weekly digest sent');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, '[Email] Digest send failed');
    return false;
  }
}

module.exports = { sendDigestEmail };
