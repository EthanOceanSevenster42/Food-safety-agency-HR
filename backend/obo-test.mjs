import 'dotenv/config';
import { ConfidentialClientApplication } from '@azure/msal-node';

const tenantId = process.env.GRAPH_TENANT_ID;
const clientId = process.env.GRAPH_CLIENT_ID;
const clientSecret = process.env.GRAPH_CLIENT_SECRET;
const ANTHONY = 'Anthony.Penzes@moc-pty.com';
const LANCORP = 'lancorp@moc-pty.com';

const cca = new ConfidentialClientApplication({
  auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret },
});
const { accessToken } = await cca.acquireTokenByClientCredential({
  scopes: ['https://graph.microsoft.com/.default'],
});

async function trySend(label, principal, message) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(principal)}/sendMail`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  let detail = '';
  if (res.status !== 202) { try { detail = await res.text(); } catch {} }
  console.log(`[${label}] → ${res.status} ${res.statusText} ${detail}`);
}

const base = {
  subject: 'LANCorp OBO test',
  body: { contentType: 'Text', content: 'send-on-behalf shape test' },
  toRecipients: [{ emailAddress: { address: ANTHONY } }],
};

// Shape 1: send THROUGH Anthony's mailbox, on behalf of LANCorp
await trySend('shape1 principal=Anthony, from=LANCorp, sender=Anthony', ANTHONY, {
  ...base,
  from: { emailAddress: { address: LANCORP } },
  sender: { emailAddress: { address: ANTHONY } },
});

// Shape 2: send from LANCorp mailbox, sender=Anthony
await trySend('shape2 principal=LANCorp, from=LANCorp, sender=Anthony', LANCORP, {
  ...base,
  from: { emailAddress: { address: LANCORP } },
  sender: { emailAddress: { address: ANTHONY } },
});
