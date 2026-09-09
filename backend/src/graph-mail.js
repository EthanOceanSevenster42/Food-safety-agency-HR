import { ConfidentialClientApplication } from '@azure/msal-node';
import fs from 'node:fs';
import path from 'node:path';

let msalClient = null;

function getClient() {
  if (msalClient) return msalClient;
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;
  msalClient = new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  });
  return msalClient;
}

async function getAccessToken() {
  const client = getClient();
  if (!client) throw new Error('Graph client not configured');
  const result = await client.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  if (!result?.accessToken) throw new Error('Graph token acquisition returned no accessToken');
  return result.accessToken;
}

function fileToAttachment(att) {
  // nodemailer-style attachment → Graph fileAttachment shape
  let contentBytes;
  let name = att.filename || 'attachment';
  if (att.path) {
    const buf = fs.readFileSync(att.path);
    contentBytes = buf.toString('base64');
    if (!att.filename) name = path.basename(att.path);
  } else if (att.content) {
    const buf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
    contentBytes = buf.toString('base64');
  } else {
    return null;
  }
  const out = {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name,
    contentBytes,
    contentType: att.contentType || 'application/octet-stream',
  };
  if (att.cid) {
    out.contentId = att.cid;
    out.isInline = true;
  }
  return out;
}

export function isGraphConfigured() {
  return !!(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET && process.env.GRAPH_SEND_AS);
}

export async function sendViaGraph({ to, subject, text, html, attachments }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: 'no recipients' };

  // The mailbox that actually performs the send (and owns the Sent Items copy).
  const sender = process.env.GRAPH_SEND_AS;
  // The visible From address. Defaults to the sending mailbox, but can be a
  // shared inbox the sending mailbox has "Send As" rights on (e.g. fsa@...).
  const fromAddress = process.env.GRAPH_FROM || sender;
  const token = await getAccessToken();

  const message = {
    subject: subject || '(no subject)',
    body: {
      contentType: html ? 'HTML' : 'Text',
      content: html || text || '',
    },
    from: { emailAddress: { address: fromAddress } },
    toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
  };

  if (attachments?.length) {
    const mapped = attachments.map(fileToAttachment).filter(Boolean);
    if (mapped.length) message.attachments = mapped;
  }

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (res.status === 202) {
    console.log('[email] graph sent →', recipients.join(', '));
    return { sent: true, via: 'graph' };
  }

  let detail = '';
  try { detail = await res.text(); } catch {}
  const err = new Error(`Graph sendMail failed: ${res.status} ${res.statusText} ${detail}`);
  err.status = res.status;
  throw err;
}
