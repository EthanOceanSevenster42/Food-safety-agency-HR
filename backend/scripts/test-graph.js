import 'dotenv/config';
import { sendViaGraph, isGraphConfigured } from '../src/graph-mail.js';

if (!isGraphConfigured()) {
  console.error('Graph not fully configured. Need GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SEND_AS in .env');
  process.exit(1);
}

const target = process.argv[2] || process.env.GRAPH_SEND_AS;
console.log('Sending test email from', process.env.GRAPH_SEND_AS, '→', target);

try {
  const result = await sendViaGraph({
    to: target,
    subject: 'LANCorp Graph test',
    text: 'If you can see this in your inbox, Microsoft Graph send is working end-to-end.\n\n— LANCorp backend',
  });
  console.log('Result:', result);
} catch (err) {
  console.error('FAILED:', err.message);
  process.exit(1);
}
