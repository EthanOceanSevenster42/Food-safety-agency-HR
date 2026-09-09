import nodemailer from 'nodemailer';
import { isGraphConfigured, sendViaGraph } from './graph-mail.js';

let transport = null;

function getTransport() {
  if (transport) return transport;
  if (!process.env.SMTP_HOST) return null;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

export async function sendMail({ to, subject, text, html, attachments }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
  if (recipients.length === 0) {
    console.log('[email] no recipients, skipping');
    return { sent: false, reason: 'no recipients' };
  }

  const from = process.env.SMTP_FROM || process.env.GRAPH_FROM || process.env.GRAPH_SEND_AS || '"FSA Repairs" <no-reply@foodsafetyagency.co.za>';

  // Prefer Microsoft Graph when configured
  if (isGraphConfigured()) {
    try {
      return await sendViaGraph({ to: recipients, subject, text, html, attachments });
    } catch (err) {
      console.error('[email] graph send failed:', err.message);
      return { sent: false, reason: err.message };
    }
  }

  // Fallback to SMTP
  const t = getTransport();
  if (!t) {
    console.log('━━━━━━━━━━━━━━━━ [email-stub] ━━━━━━━━━━━━━━━━');
    console.log('  from:    ', from);
    console.log('  to:      ', recipients.join(', '));
    console.log('  subject: ', subject);
    console.log('  body:');
    console.log(String(text).split('\n').map((l) => '    ' + l).join('\n'));
    if (attachments?.length) {
      console.log('  attachments:');
      for (const a of attachments) console.log('    -', a.filename, a.path ? `(${a.path})` : '');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return { sent: false, reason: 'no mail transport configured', stub: true };
  }

  try {
    const info = await t.sendMail({ from, to: recipients.join(', '), subject, text, html, attachments });
    console.log('[email] smtp sent:', info.messageId, '→', recipients.join(', '));
    return { sent: true, messageId: info.messageId, via: 'smtp' };
  } catch (err) {
    console.error('[email] smtp send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}
