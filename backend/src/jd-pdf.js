// Job Description PDF builder. Reuses the SOW pipeline's branded font
// resolution + banner loader (re-exported from sow-pdf.js) so JDs match
// the same letterhead / typography stack the SOWs use. Document content
// is much simpler than a SOW — no cover, no TOC, no appendices.

import pdfmake from 'pdfmake';
import path from 'node:path';
import { resolveFont, readBanner } from './sow-pdf.js';
import { UPLOAD_DIR } from './upload.js';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function formatWorkMode(mode, days) {
  if (mode === 'office') return 'Office-based';
  if (mode === 'remote') return 'Fully remote';
  if (mode === 'hybrid') {
    const ds = Array.isArray(days) ? days : [];
    const ordered = DAY_LABELS.filter((d) => ds.includes(d));
    return ordered.length ? `Hybrid (in office: ${ordered.join(', ')})` : 'Hybrid';
  }
  return '';
}

// Flatten the linked KPA payload into a "Key Responsibilities" list.
// Each KPA renders as a header line; its KPIs become a bulleted sub-
// list. Empty KPIs are skipped so a half-filled KPA task doesn't add
// empty bullets to the JD.
function buildResponsibilitiesContent(kpaProcess, { bodySize, h2 }) {
  const kpas = Array.isArray(kpaProcess?.kpas) ? kpaProcess.kpas : [];
  if (kpas.length === 0) return null;
  const blocks = [];
  for (const kpa of kpas) {
    const area = (kpa?.name || kpa?.department || '').trim();
    const kpis = Array.isArray(kpa?.kpis) ? kpa.kpis : (
      kpa?.kpi ? [{ description: kpa.kpi, measures: kpa.measures }] : []
    );
    if (!area && kpis.length === 0) continue;
    if (area) {
      blocks.push({
        text: area,
        bold: true,
        fontSize: bodySize,
        margin: [0, 6, 0, 2],
      });
    }
    const items = [];
    for (const kpi of kpis) {
      const desc = (kpi?.description || '').trim();
      if (!desc) continue;
      items.push(desc);
    }
    if (items.length) {
      blocks.push({ ul: items, fontSize: bodySize, margin: [12, 0, 0, 4] });
    }
  }
  return blocks.length ? blocks : null;
}

// Build the JD's body content as an array of pdfmake nodes. NO banner,
// NO header/footer callbacks — those wrap the buffer-producing entry
// point below. Exposed so the Pack builder can splice the JD's exact
// rendering into a combined PDF without duplicating the layout logic.
export function buildJdContentBlocks(input, options = {}) {
  const {
    data = {},
    kpaProcess = null,
    issuer = {},
    typography = {},
    reportToName = '',
  } = input || {};
  const { startOnNewPage = false, startOrientation = null } = options;

  const BODY = typography.bodyFontSize || 12;
  const H1   = typography.h1FontSize   || 18;
  const H2   = typography.h2FontSize   || 14;
  const h1Caps = !!typography.h1AllCaps;
  const h2Caps = !!typography.h2AllCaps;
  const applyAllCaps = (text, flag) => flag ? String(text || '').toUpperCase() : String(text || '');

  const issuerName = (issuer.name || '').trim();
  const titleText  = (data.title || '').trim() || 'Job Description';

  // Two-column meta — left = static labels, right = value (or em-dash).
  const metaRow = (label, value) => [
    { text: label, bold: true, fontSize: BODY, color: '#333', margin: [0, 4, 0, 4] },
    { text: value && String(value).trim() ? String(value) : '—', fontSize: BODY, color: '#000', margin: [0, 4, 0, 4] },
  ];
  const hoursWeekText = (data.hoursPerWeek != null && data.hoursPerWeek !== '' && !Number.isNaN(Number(data.hoursPerWeek)))
    ? `${Number(data.hoursPerWeek)} hours per week`
    : '';
  const hoursCombined = [data.hoursDescription, hoursWeekText].filter(Boolean).join(' · ');
  const metaTable = {
    table: {
      widths: [120, '*'],
      body: [
        metaRow('Location',     data.location),
        metaRow('Hours',        hoursCombined),
        metaRow('Work mode',    formatWorkMode(data.workMode, data.hybridDays)),
        metaRow('Reports to',   reportToName),
        metaRow('Compensation', data.compensation),
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft:   () => 0,
      paddingRight:  () => 8,
      paddingTop:    () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 4, 0, 16],
  };

  // Section helper — heading then content (or placeholder if empty).
  function section(title, body) {
    const heading = {
      text: applyAllCaps(title, h2Caps),
      bold: true,
      fontSize: H2,
      color: '#000',
      margin: [0, 14, 0, 6],
    };
    if (body == null || (Array.isArray(body) && body.length === 0)) {
      return [heading, { text: '—', fontSize: BODY, color: '#999', margin: [0, 0, 0, 4] }];
    }
    return [heading, body];
  }

  function paragraph(text) {
    if (!text || !String(text).trim()) return null;
    return { text: String(text), fontSize: BODY, color: '#000', margin: [0, 0, 0, 4] };
  }

  const responsibilitiesBlocks = buildResponsibilitiesContent(kpaProcess, { bodySize: BODY, h2: H2 });
  const qualifications = Array.isArray(data.qualifications)
    ? data.qualifications.map((q) => String(q || '').trim()).filter(Boolean)
    : [];

  const content = [];

  // ---- Title block ----
  const titleNode = {
    text: applyAllCaps(titleText, h1Caps),
    fontSize: H1,
    bold: true,
    color: '#000',
    margin: [0, 0, 0, 4],
  };
  if (startOnNewPage) {
    titleNode.pageBreak = 'before';
    if (startOrientation) titleNode.pageOrientation = startOrientation;
  }
  content.push(titleNode);
  if (issuerName) {
    content.push({
      text: issuerName,
      fontSize: BODY,
      color: '#666',
      margin: [0, 0, 0, 12],
    });
  }

  // ---- Meta ----
  content.push(metaTable);

  // ---- Sections ----
  content.push(...section('About the company', paragraph(data.aboutCompany)));
  content.push(...section('Job overview',       paragraph(data.jobOverview)));
  content.push(...section('Key responsibilities', responsibilitiesBlocks));
  content.push(...section(
    'Qualifications & skills',
    qualifications.length ? { ul: qualifications, fontSize: BODY, margin: [12, 0, 0, 4] } : null,
  ));
  content.push(...section('Why join us?',  paragraph(data.whyJoinUs)));
  content.push(...section('How to apply',  paragraph(data.howToApply)));

  return content;
}

// Build the final pdfmake doc definition. Layout:
//   - Header banner (portrait) on every page
//   - Title block (job title + company name)
//   - Two-column meta block (Location, Hours, Work mode, Compensation, Reports to)
//   - About the company / Job overview / Key responsibilities / Qualifications /
//     Why join us / How to apply — each as a heading + body section
//   - Footer banner + page number
export async function buildJdPdfBuffer(input) {
  const {
    data = {},
    branding = {},
    issuer = {},
    typography = {},
  } = input || {};

  const FONT = resolveFont(typography.fontFamily);
  const BODY = typography.bodyFontSize || 12;

  const portraitHeader = readBanner(branding.headerPath, { pageWidthMm: 210 });
  const portraitFooter = readBanner(branding.footerPath, { pageWidthMm: 210 });

  const A4_PORTRAIT_WIDTH = 595;
  const portraitHeaderHeight = portraitHeader
    ? (portraitHeader._origHeight / portraitHeader._origWidth) * A4_PORTRAIT_WIDTH
    : 0;
  const PAGE_MARGIN_TOP    = Math.max(90, portraitHeaderHeight + 18);
  const PAGE_MARGIN_BOTTOM = 80;
  const PAGE_MARGIN_LR     = 56;

  const issuerName = (issuer.name || '').trim();
  const titleText  = (data.title || '').trim() || 'Job Description';

  const content = buildJdContentBlocks(input);

  // ---- Header / footer callbacks ----
  function header(currentPage, pageCount, pageSize) {
    if (!portraitHeader) return null;
    const widthPt = pageSize?.width || A4_PORTRAIT_WIDTH;
    const insetLR = branding.headerSideMargin ? PAGE_MARGIN_LR : 0;
    return [{
      image: portraitHeader.image,
      width: widthPt - (insetLR * 2),
      margin: [insetLR, 0, insetLR, 0],
    }];
  }
  function footer(currentPage, pageCount, pageSize) {
    const widthPt = pageSize?.width || A4_PORTRAIT_WIDTH;
    const insetLR = branding.footerSideMargin ? PAGE_MARGIN_LR : 0;
    const stack = [];
    if (portraitFooter) {
      stack.push({
        image: portraitFooter.image,
        width: widthPt - (insetLR * 2),
        margin: [insetLR, 0, insetLR, 0],
      });
    }
    stack.push({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'center',
      fontSize: Math.max(8, BODY - 3),
      color: '#666',
      margin: [0, 4, 0, 0],
    });
    return stack;
  }

  const docDef = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [PAGE_MARGIN_LR, PAGE_MARGIN_TOP, PAGE_MARGIN_LR, PAGE_MARGIN_BOTTOM],
    defaultStyle: { font: FONT, fontSize: BODY, color: '#000' },
    info: {
      title: titleText + (issuerName ? ` — ${issuerName}` : ''),
      author: issuerName || undefined,
    },
    header,
    footer,
    content,
  };

  return await pdfmake.createPdf(docDef).getBuffer();
}

// Eagerly silence the unused-import linter — keeps path + UPLOAD_DIR
// available if a future caller wants to write the PDF to disk like the
// SOW generator does.
void path; void UPLOAD_DIR;
