import 'dotenv/config';
import { renderRepairEmail } from '../src/email-templates.js';
import { sendMail } from '../src/email.js';

const company = { Name: 'MOC Pty Ltd', BrandColor: '#2E6F81', LogoFile: null };
const asset = {
  Name: 'Dell Latitude 5440',
  SerialNumber: 'DL5440-X1Y2Z3',
  AssetTag: 'MOC-LT-0042',
  RepairProblem: 'Screen flickers under load and battery drains within 90 minutes.',
  RepairSupplier: 'Dell Service Centre Sandton',
};
const owner = { Name: 'Anthony Penzes', Title: 'Operations Manager', Email: process.env.GRAPH_SEND_AS };

const intents = ['booked', 'stage_changed', 'note', 'returned'];

for (const intent of intents) {
  const tpl = renderRepairEmail({
    company, asset, owner,
    currentStage: intent === 'booked' ? 'booked_in'
                : intent === 'returned' ? 'returned'
                : intent === 'note' ? 'at_supplier'
                : 'out_for_dispatch',
    intent,
    fromStage: intent === 'stage_changed' ? 'booked_in' : undefined,
    note: intent === 'note' ? 'Supplier confirmed receipt and is awaiting parts. ETA 5 working days.' : undefined,
    author: 'louislewies@gmail.com',
    reference: 'REP-2026-000042',
  });
  console.log('---', intent, '---');
  console.log('Subject:', tpl.subject);
  console.log('Attachments:', tpl.attachments.length);
}

if (process.argv.includes('--send')) {
  const target = process.argv[process.argv.indexOf('--send') + 1] || process.env.GRAPH_SEND_AS;
  for (const intent of intents) {
    const tpl = renderRepairEmail({
      company, asset, owner,
      currentStage: intent === 'booked' ? 'booked_in'
                  : intent === 'returned' ? 'returned'
                  : intent === 'note' ? 'at_supplier'
                  : 'out_for_dispatch',
      intent,
      fromStage: intent === 'stage_changed' ? 'booked_in' : undefined,
      note: intent === 'note' ? 'Supplier confirmed receipt and is awaiting parts. ETA 5 working days.' : undefined,
      author: 'louislewies@gmail.com',
      reference: 'REP-2026-000042',
    });
    const result = await sendMail({
      to: target,
      subject: '[TEST] ' + tpl.subject,
      text: tpl.text,
      html: tpl.html,
      attachments: tpl.attachments,
    });
    console.log(intent, '→', result);
  }
}
