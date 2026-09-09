import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './upload.js';

const STAGES = [
  { key: 'booked_in',        label: 'Booked In',        subtitle: 'At repair department' },
  { key: 'out_for_dispatch', label: 'Out for Dispatch', subtitle: 'Paperwork complete' },
  { key: 'at_supplier',      label: 'At Supplier',      subtitle: 'Awaiting feedback' },
  { key: 'received_back',    label: 'Received Back',    subtitle: 'Back at department' },
];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

const DEFAULT_BRAND = '#088298';
const GREY_BAR = '#E0E5EA';
const GREY_TEXT = '#8B96A0';
const DARK_TEXT = '#1F3138';
const MUTED_TEXT = '#566570';
const CARD_BG = '#F7F9FA';
const CARD_BORDER = '#E0E5EA';

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function ensureBrand(c) {
  if (typeof c !== 'string') return DEFAULT_BRAND;
  return /^#?[0-9a-fA-F]{6}$/.test(c.replace('#', '')) ? (c.startsWith('#') ? c : '#' + c) : DEFAULT_BRAND;
}

function fmtStageDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  // Compact display: "6 May, 14:35"
  const day = dt.getDate();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[dt.getMonth()];
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${day} ${month}, ${hh}:${mm}`;
}

function renderProgressBar(currentStage, brand, stageHistory = []) {
  const isReturned = currentStage === 'returned';
  const currentIdx = isReturned ? STAGES.length : (STAGE_INDEX[currentStage] ?? 0);

  // Map stage key → first entry timestamp (in case a stage was entered more than once, take earliest)
  const stampByStage = new Map();
  for (const h of stageHistory || []) {
    if (!stampByStage.has(h.stage)) stampByStage.set(h.stage, h.enteredAt);
  }

  const markers = STAGES.map((stage, i) => {
    const isDone = isReturned || i < currentIdx;
    const isCurrent = !isReturned && i === currentIdx;
    const bg = isDone || isCurrent ? brand : GREY_BAR;
    const fg = isDone || isCurrent ? '#FFFFFF' : GREY_TEXT;
    const content = isDone ? '&#10003;' : String(i + 1);
    return `
      <td align="center" width="25%" style="padding:0;">
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
          <tr>
            <td width="36" height="36" align="center" valign="middle" bgcolor="${bg}"
                style="background-color:${bg};color:${fg};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;border-radius:18px;line-height:36px;mso-line-height-rule:exactly;">
              ${content}
            </td>
          </tr>
        </table>
      </td>`;
  }).join('');

  const segments = STAGES.map((_, i) => {
    const filled = isReturned || i <= currentIdx;
    const color = filled ? brand : GREY_BAR;
    return `<td width="25%" height="4" bgcolor="${color}" style="background-color:${color};font-size:0;line-height:0;mso-line-height-rule:exactly;height:4px;">&nbsp;</td>`;
  }).join('');

  const labels = STAGES.map((stage, i) => {
    const isDone = isReturned || i < currentIdx;
    const isCurrent = !isReturned && i === currentIdx;
    const color = isCurrent ? brand : (isDone ? DARK_TEXT : GREY_TEXT);
    const weight = isCurrent ? 'bold' : 'normal';
    const stamp = fmtStageDate(stampByStage.get(stage.key));
    const stampHtml = stamp
      ? `<br><span style="font-weight:normal;color:${isDone || isCurrent ? brand : GREY_TEXT};font-size:11px;">${escape(stamp)}</span>`
      : '';
    return `
      <td align="center" width="25%" style="padding:10px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${color};font-weight:${weight};line-height:16px;">
        ${escape(stage.label)}<br>
        <span style="font-weight:normal;color:${GREY_TEXT};font-size:11px;">${escape(stage.subtitle)}</span>${stampHtml}
      </td>`;
  }).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px;">
      <tr>${markers}</tr>
      <tr>
        <td colspan="4" style="padding-top:10px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>${segments}</tr>
          </table>
        </td>
      </tr>
      <tr>${labels}</tr>
    </table>`;
}

function renderDetailsTable(rows) {
  const html = rows
    .filter((r) => r && r.value != null && r.value !== '')
    .map((r) => `
      <tr>
        <td style="padding:8px 16px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED_TEXT};white-space:nowrap;vertical-align:top;width:130px;">${escape(r.label)}</td>
        <td style="padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${DARK_TEXT};vertical-align:top;">${r.html ? r.html : escape(r.value)}</td>
      </tr>`)
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0">${html}</table>`;
}

function renderCallout({ brand, title, body }) {
  if (!body) return '';
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;">
      <tr>
        <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border-left:4px solid ${brand};padding:14px 16px;font-family:Arial,Helvetica,sans-serif;">
          ${title ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:${MUTED_TEXT};margin-bottom:6px;">${escape(title)}</div>` : ''}
          <div style="font-size:14px;color:${DARK_TEXT};line-height:1.5;white-space:pre-wrap;">${escape(body)}</div>
        </td>
      </tr>
    </table>`;
}

function renderHeader({ company, brand, logoCid }) {
  const logoBlock = logoCid
    ? `<img src="cid:${logoCid}" alt="${escape(company.Name)}" height="40" style="display:block;max-height:40px;border:0;outline:none;">`
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:${brand};">${escape(company.Name)}</div>`;

  return `
    <tr><td height="6" bgcolor="${brand}" style="background-color:${brand};font-size:0;line-height:0;height:6px;">&nbsp;</td></tr>
    <tr>
      <td style="padding:24px 32px 8px;background-color:#FFFFFF;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="middle">${logoBlock}</td>
            <td valign="middle" align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${GREY_TEXT};text-transform:uppercase;letter-spacing:1px;">
              Food Safety Agency · Repair Tracking
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderFooter() {
  return `
    <tr>
      <td style="padding:8px 32px 28px;background-color:#FFFFFF;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td height="1" bgcolor="${CARD_BORDER}" style="background-color:${CARD_BORDER};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
          <tr>
            <td style="padding-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${GREY_TEXT};line-height:1.5;">
              You are receiving this email because you are listed as a notification recipient for this repair.
              <br>This message was generated automatically by FSA HR Portal.
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function statusBadgeFor(intent, brand) {
  const map = {
    booked:        { label: 'Repair booked',     bg: brand },
    stage_changed: { label: 'Status update',     bg: brand },
    note:          { label: 'New update',        bg: brand },
    returned:      { label: 'Repair complete',   bg: '#2F8F4F' },
  };
  return map[intent] || { label: 'Repair update', bg: brand };
}

function logoAttachmentFor(company) {
  if (!company?.LogoFile) return null;
  const filePath = path.join(UPLOAD_DIR, company.LogoFile);
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(company.LogoFile).toLowerCase().replace('.', '') || 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
             : ext === 'svg' ? 'image/svg+xml'
             : ext === 'gif' ? 'image/gif'
             : ext === 'webp' ? 'image/webp'
             : 'image/png';
  return {
    filename: company.LogoFile,
    path: filePath,
    cid: 'company-logo',
    contentType: mime,
  };
}

/**
 * Render a repair-tracking email.
 * @param {object} opts
 * @param {object} opts.company  - { Name, BrandColor, LogoFile }
 * @param {object} opts.asset    - asset row (Name, SerialNumber, AssetTag, RepairProblem, RepairSupplier)
 * @param {object|null} opts.owner - { Name, Title, Email } | null
 * @param {string} opts.currentStage - one of stage keys, or 'returned'
 * @param {'booked'|'stage_changed'|'note'|'returned'} opts.intent
 * @param {string} [opts.fromStage]   - previous stage key (for stage_changed)
 * @param {string} [opts.note]        - note message (for intent=note)
 * @param {string} [opts.author]      - actor for stage/note changes
 * @param {string} [opts.reference]   - repair reference number
 * @returns {{ html: string, text: string, attachments: Array, subject: string }}
 */
export function renderRepairEmail(opts) {
  const {
    company, asset, owner, currentStage,
    intent, fromStage, note, author, reference,
    stageHistory,
  } = opts;

  const brand = ensureBrand(company?.BrandColor);
  const logoAtt = logoAttachmentFor(company);
  const logoCid = logoAtt ? 'company-logo' : null;
  const badge = statusBadgeFor(intent, brand);

  const stageLabelMap = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
  const currentLabel = currentStage === 'returned' ? 'Returned to owner' : (stageLabelMap[currentStage] || 'In Repairs');
  const fromLabel = fromStage ? (stageLabelMap[fromStage] || fromStage) : null;

  let headline;
  let lede;
  if (intent === 'booked') {
    headline = `${asset.Name} has been booked in for repair`;
    lede = `The item is now at the repair department and will be dispatched to ${asset.RepairSupplier || 'the supplier'} once paperwork is complete.`;
  } else if (intent === 'stage_changed') {
    headline = `${asset.Name} is now: ${currentLabel}`;
    lede = fromLabel ? `Status moved from ${fromLabel} to ${currentLabel}.` : `Status updated to ${currentLabel}.`;
  } else if (intent === 'returned') {
    const returnTo = owner ? owner.Name : 'storage';
    headline = `${asset.Name} repair complete`;
    lede = `The repair is finished and the item is being returned to ${returnTo}.`;
  } else if (intent === 'note') {
    headline = `New update on ${asset.Name}`;
    lede = `A new note has been added to this repair.`;
  } else {
    headline = `Repair update: ${asset.Name}`;
    lede = '';
  }

  const ownerLine = owner
    ? `${escape(owner.Name)}${owner.Title ? ` <span style="color:${GREY_TEXT};">· ${escape(owner.Title)}</span>` : ''}`
    : null;

  const detailsRows = [
    { label: 'Asset',     value: asset.Name },
    { label: 'Company',   value: company.Name },
    owner ? { label: 'Owner', value: owner.Name, html: ownerLine } : null,
    asset.RepairSupplier ? { label: 'Supplier',  value: asset.RepairSupplier } : null,
    asset.SerialNumber   ? { label: 'Serial No.', value: asset.SerialNumber } : null,
    asset.AssetTag       ? { label: 'Asset Tag',  value: asset.AssetTag } : null,
    reference            ? { label: 'Reference',  value: reference, html: `<span style="font-family:Consolas,Menlo,monospace;font-size:13px;">${escape(reference)}</span>` } : null,
    author               ? { label: 'Updated by', value: author } : null,
  ].filter(Boolean);

  let calloutHtml = '';
  if (intent === 'booked' && asset.RepairProblem) {
    calloutHtml = renderCallout({ brand, title: 'Problem reported', body: asset.RepairProblem });
  } else if (intent === 'note' && note) {
    calloutHtml = renderCallout({ brand, title: `Note from ${author || 'team'}`, body: note });
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(headline)}</title>
</head>
<body style="margin:0;padding:0;background-color:#EFF2F4;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EFF2F4" style="background-color:#EFF2F4;">
    <tr><td align="center" style="padding:24px 12px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF;max-width:600px;border-radius:6px;overflow:hidden;">
        ${renderHeader({ company, brand, logoCid })}
        <tr>
          <td style="padding:8px 32px 0;background-color:#FFFFFF;">
            <span style="display:inline-block;background-color:${badge.bg};color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.8px;text-transform:uppercase;padding:5px 10px;border-radius:3px;">${escape(badge.label)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 32px 4px;background-color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:${DARK_TEXT};line-height:1.3;">
            ${escape(headline)}
          </td>
        </tr>
        ${lede ? `<tr><td style="padding:0 32px 8px;background-color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED_TEXT};line-height:1.5;">${escape(lede)}</td></tr>` : ''}
        <tr>
          <td style="padding:16px 32px 0;background-color:#FFFFFF;">
            ${renderProgressBar(currentStage, brand, stageHistory)}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 0;background-color:#FFFFFF;">
            ${renderDetailsTable(detailsRows)}
          </td>
        </tr>
        ${calloutHtml ? `<tr><td style="padding:8px 32px 8px;background-color:#FFFFFF;">${calloutHtml}</td></tr>` : ''}
        ${renderFooter()}
      </table>
    </td></tr>
  </table>
</body></html>`;

  // Plaintext fallback
  const stampMap = new Map();
  for (const h of stageHistory || []) {
    if (!stampMap.has(h.stage)) stampMap.set(h.stage, h.enteredAt);
  }
  const stageLine = STAGES.map((s, i) => {
    const isReturned = currentStage === 'returned';
    const idx = isReturned ? STAGES.length : STAGE_INDEX[currentStage] ?? 0;
    const stamp = fmtStageDate(stampMap.get(s.key));
    const suffix = stamp ? `  (${stamp})` : '';
    if (isReturned || i < idx) return `[x] ${s.label}${suffix}`;
    if (i === idx) return `[>] ${s.label}${suffix}  <-- now`;
    return `[ ] ${s.label}`;
  }).join('\n  ');

  const textLines = [
    headline,
    '',
    lede,
    '',
    'Progress:',
    '  ' + stageLine,
    '',
    'Details:',
    `  Asset:    ${asset.Name}`,
    `  Company:  ${company.Name}`,
    owner ? `  Owner:    ${owner.Name}${owner.Title ? ' · ' + owner.Title : ''}` : null,
    asset.RepairSupplier ? `  Supplier: ${asset.RepairSupplier}` : null,
    asset.SerialNumber ? `  Serial:   ${asset.SerialNumber}` : null,
    asset.AssetTag ? `  Tag:      ${asset.AssetTag}` : null,
    reference ? `  Ref:      ${reference}` : null,
    author ? `  Updated by: ${author}` : null,
    '',
    intent === 'booked' && asset.RepairProblem ? `Problem reported:\n  ${asset.RepairProblem}` : null,
    intent === 'note' && note ? `Note from ${author || 'team'}:\n  ${note}` : null,
    '',
    '--',
    'FSA HR Portal',
  ].filter((l) => l !== null).join('\n');

  const subject = (() => {
    if (intent === 'booked')        return `[FSA Repairs] ${asset.Name} sent for repair`;
    if (intent === 'returned')      return `[FSA Repairs] ${asset.Name} repair complete`;
    if (intent === 'note')          return `[FSA Repairs] Update on ${asset.Name}`;
    if (intent === 'stage_changed') return `[FSA Repairs] ${asset.Name}: ${currentLabel}`;
    return `[FSA Repairs] ${asset.Name}`;
  })();

  const attachments = logoAtt ? [logoAtt] : [];

  return { html, text: textLines, attachments, subject };
}

// KPI review workflow emails. `kind` selects the copy:
//   employee_start   → tell the employee a review is ready to complete
//   manager_ready    → tell the manager the employee has submitted
//   employee_locked  → tell the employee the joint session is ready but
//                      password-locked (manager shares the password)
// Returns { subject, text, html } for sendMail().
export function renderKpiReviewEmail({
  kind = 'employee_start',
  employeeName = '',
  managerName = '',
  periodLabel = '',
  kpiCount = 0,
  link = '',
  brandColor,
} = {}) {
  const brand = ensureBrand(brandColor);
  const COPY = {
    employee_start: {
      subject: `Action needed: complete your KPI review${periodLabel ? ' — ' + periodLabel : ''}`,
      heading: 'Your KPI review is ready',
      lead: `Hi ${employeeName || 'there'}, it's time to complete your self-assessment for the ${periodLabel || 'current'} review period. Please rate each of your ${kpiCount} KPI${kpiCount === 1 ? '' : 's'} and add any comments.`,
      cta: 'Complete my KPI review',
    },
    manager_ready: {
      subject: `KPI review ready for your input${employeeName ? ' — ' + employeeName : ''}`,
      heading: 'A KPI review needs your assessment',
      lead: `Hi ${managerName || 'there'}, ${employeeName || 'your report'} has submitted their self-assessment for ${periodLabel || 'the current period'}. You can now review their answers and add your own ratings.`,
      cta: 'Review now',
    },
    employee_locked: {
      subject: `Your KPI review session is ready${periodLabel ? ' — ' + periodLabel : ''}`,
      heading: 'Your KPI review is ready to discuss',
      lead: `Hi ${employeeName || 'there'}, your manager ${managerName ? '(' + managerName + ') ' : ''}has completed their assessment. The combined review is password-protected — your manager will give you the password during your meeting.`,
      cta: 'Open the review session',
    },
    completed: {
      subject: `KPI review completed${periodLabel ? ' — ' + periodLabel : ''}`,
      heading: 'KPI review completed',
      lead: `The ${periodLabel || 'current'} KPI review for ${employeeName || 'the employee'} has been finalised. You can view the outcome any time.`,
      cta: 'View the review',
    },
  };
  const c = COPY[kind] || COPY.employee_start;
  const safeLink = escape(link);
  const text = `${c.heading}\n\n${c.lead}\n\n${c.cta}: ${link}\n\n--\nFSA`;
  const html = `<!doctype html><html><body style="margin:0;background:${CARD_BG};font-family:Segoe UI,Arial,sans-serif;color:${DARK_TEXT}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};padding:24px 0">
      <tr><td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ${CARD_BORDER};border-radius:10px;overflow:hidden">
          <tr><td style="background:${brand};height:6px;font-size:0;line-height:0">&nbsp;</td></tr>
          <tr><td style="padding:28px 32px">
            <h1 style="margin:0 0 12px;font-size:20px;color:${DARK_TEXT}">${escape(c.heading)}</h1>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${MUTED_TEXT}">${escape(c.lead)}</p>
            <a href="${safeLink}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px">${escape(c.cta)}</a>
            <p style="margin:22px 0 0;font-size:12px;color:${GREY_TEXT}">If the button doesn't work, copy this link into your browser:<br>${safeLink}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
  return { subject: c.subject, text, html };
}
