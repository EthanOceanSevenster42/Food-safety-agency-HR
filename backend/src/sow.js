// Builds the E-Click Statement of Work .docx from the structured form data
// submitted by the frontend. Mirrors the section layout of the original
// "E-Click SOW Template" — see the project README for the source structure.

import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel,
  ImageRun, LevelFormat, NumberFormat,
  PageNumber, PageOrientation, Packer, Paragraph, ShadingType,
  StyleLevel,
  Table, TableCell, TableOfContents, TableRow, TextRun, WidthType,
} from 'docx';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageSize } from 'image-size';
import { UPLOAD_DIR } from './upload.js';

const BRAND = '2E6F81';
const INK   = '0F1A1F';
const MUTED = '6B7B82';
const HAIRLINE = 'D6DDE0';

// A4 dimensions in pixels @ 96 DPI
//   Portrait  = 21.0 cm × 29.7 cm → 794 × 1123
//   Landscape = 29.7 cm × 21.0 cm → 1123 × 794
// Body margins (1 inch = 1440 twips) — headers/footers overflow these via
// negative paragraph indents to reach the page edges.
const PAGE_WIDTH_PX_PORTRAIT  = 794;
const PAGE_WIDTH_PX_LANDSCAPE = 1123;
const BODY_MARGIN_TWIPS = 1440;

// Default order/titles used to migrate older saves that stored sections as
// a fixed object keyed by camel-case names. The current shape is an editable
// array (see normaliseSections below), so users can add / remove / rename.
export const SECTION_KEYS = [
  { key: 'executiveSummary',     title: 'Executive Summary' },
  { key: 'background',           title: 'Background and Current Environment' },
  { key: 'objectives',           title: 'Objectives of the Engagement' },
  { key: 'scopeOfWork',          title: 'Scope of Work' },
  { key: 'milestonePlan',        title: 'Milestone Plan and Timeline' },
  { key: 'rolesAndResponsibilities', title: 'Roles and Responsibilities' },
  { key: 'takeoverAndSupport',   title: 'Takeover, Stabilisation and Support Approach' },
  { key: 'slaPrinciple',         title: 'Service Level Agreement Principle' },
  { key: 'assumptions',          title: 'Assumptions, Dependencies and Constraints' },
  { key: 'commercials',          title: 'Commercials and Payment Structure' },
  { key: 'acceptance',           title: 'Acceptance and Sign-Off' },
  { key: 'confidentiality',      title: 'Confidentiality and NDA Reference' },
  { key: 'disputeResolution',    title: 'Dispute Resolution' },
];

// Convert whatever shape arrived in data.sections into a plain array of
// { title, body, subsections } in render order. Each sub-section may carry
// an optional subsubsections array (Heading 3 entries).
function resolveSectionList(input) {
  const normaliseSub = (sub) => ({
    title: typeof sub?.title === 'string' ? sub.title : '',
    body:  typeof sub?.body  === 'string' ? sub.body  : '',
    subsubsections: Array.isArray(sub?.subsubsections)
      ? sub.subsubsections.map((ss) => ({
          title: typeof ss?.title === 'string' ? ss.title : '',
          body:  typeof ss?.body  === 'string' ? ss.body  : '',
        }))
      : [],
  });

  if (Array.isArray(input)) {
    return input.map((s, i) => ({
      title: (typeof s?.title === 'string' && s.title.trim()) || (SECTION_KEYS[i]?.title || `Section ${i + 1}`),
      body: typeof s === 'string' ? s : (typeof s?.body === 'string' ? s.body : ''),
      subsections: Array.isArray(s?.subsections) ? s.subsections.map(normaliseSub) : [],
    }));
  }
  if (input && typeof input === 'object') {
    // Legacy object — walk the canonical key order
    return SECTION_KEYS.map((sk) => {
      const raw = input[sk.key];
      const body = typeof raw === 'string' ? raw : (typeof raw?.body === 'string' ? raw.body : '');
      const subsections = Array.isArray(raw?.subsections) ? raw.subsections.map(normaliseSub) : [];
      return { title: sk.title, body, subsections };
    });
  }
  return SECTION_KEYS.map((sk) => ({ title: sk.title, body: '', subsections: [] }));
}

// ---------- Tiny HTML → docx run/paragraph converter ----------
// The frontend sends section bodies as HTML using a constrained subset:
//   <b>/<strong>, <i>/<em>, <u>, <br>, <p>, <ul>, <ol>, <li>
// Anything outside that subset is rendered as plain text.

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Walk inline HTML inside a block, emitting docx TextRuns with formatting flags
function inlineRuns(html, { bold = false, italic = false, underline = false } = {}) {
  const runs = [];
  let i = 0;
  let buffer = '';
  const flush = () => {
    if (buffer) {
      runs.push(new TextRun({
        text: decodeEntities(buffer),
        bold: bold || undefined,
        italics: italic || undefined,
        underline: underline ? { type: 'single' } : undefined,
      }));
      buffer = '';
    }
  };
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) break;
      const tag = html.slice(i + 1, close).trim();
      const nameMatch = tag.match(/^\/?([a-zA-Z][a-zA-Z0-9]*)/);
      const tagName = nameMatch ? nameMatch[1].toLowerCase() : '';
      const isClose = tag.startsWith('/');
      const selfClose = tag.endsWith('/');

      if (tagName === 'br') {
        // Treat stray <br> as a soft break — browsers emit these when content
        // is pasted from PDFs/Word/websites, and honouring them as hard line
        // breaks produces awkward single-word lines mid-paragraph. We collapse
        // to a single space instead.
        if (buffer && !/\s$/.test(buffer)) buffer += ' ';
      } else if (['b', 'strong', 'i', 'em', 'u'].includes(tagName) && !selfClose) {
        flush();
        // Find matching close
        const closeTag = `</${tagName}>`;
        const closeIdx = html.toLowerCase().indexOf(closeTag, close + 1);
        const inner = closeIdx === -1 ? html.slice(close + 1) : html.slice(close + 1, closeIdx);
        const nested = inlineRuns(inner, {
          bold: bold || tagName === 'b' || tagName === 'strong',
          italic: italic || tagName === 'i' || tagName === 'em',
          underline: underline || tagName === 'u',
        });
        for (const r of nested) runs.push(r);
        i = closeIdx === -1 ? html.length : closeIdx + closeTag.length;
        continue;
      }
      // skip unknown tags
      i = close + 1;
      continue;
    }
    buffer += ch;
    i++;
  }
  flush();
  return runs;
}

// Convert a block of HTML into an array of docx Paragraph objects.
// Handles <p>, <ul>/<ol>/<li>, and bare inline content.
export function htmlToParagraphs(html, { baseStyle = {} } = {}) {
  if (!html || typeof html !== 'string') return [];
  const paragraphs = [];

  // Normalise: ensure ULs and OLs are visible at the top level. Use a streaming
  // regex pull approach.
  const remaining = html.replace(/\r\n/g, '\n').trim();
  if (!remaining) return [];

  // Split into top-level chunks: paragraphs, lists, or plain text
  // We use a very simple state machine over the string.
  let cursor = 0;
  const lower = remaining.toLowerCase();

  function pushPlainBlock(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Drop blocks whose only content is <br>, empty tags, &nbsp; or whitespace.
    // contentEditable produces stray ones when the user clicks in and out
    // without typing anything, and they'd otherwise render as visible blank
    // paragraphs in Word.
    const stripped = trimmed.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, '').trim();
    if (!stripped) return;
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 160 },
      ...baseStyle,
      children: inlineRuns(trimmed),
    }));
  }

  while (cursor < remaining.length) {
    // Find next block-level tag opening
    const m = lower.slice(cursor).search(/<(p|ul|ol)\b/);
    if (m === -1) {
      pushPlainBlock(remaining.slice(cursor));
      break;
    }
    const blockStart = cursor + m;
    if (blockStart > cursor) {
      pushPlainBlock(remaining.slice(cursor, blockStart));
    }
    const tagOpenClose = remaining.indexOf('>', blockStart);
    if (tagOpenClose === -1) break;
    const tagOpen = lower.slice(blockStart + 1, tagOpenClose).trim();
    const tag = tagOpen.match(/^([a-z]+)/)[1];

    if (tag === 'p') {
      const closeIdx = lower.indexOf('</p>', tagOpenClose);
      const inner = closeIdx === -1
        ? remaining.slice(tagOpenClose + 1)
        : remaining.slice(tagOpenClose + 1, closeIdx);
      // Skip paragraphs whose only content is HTML tags / whitespace / nbsp —
      // i.e. contentEditable leftovers like <p><br></p> or <p class=""><br/></p>.
      const stripped = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, '').trim();
      if (stripped) {
        paragraphs.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 160 },
          ...baseStyle,
          children: inlineRuns(inner),
        }));
      }
      cursor = closeIdx === -1 ? remaining.length : closeIdx + 4;
    } else if (tag === 'ul' || tag === 'ol') {
      const closeTag = `</${tag}>`;
      const closeIdx = lower.indexOf(closeTag, tagOpenClose);
      const inner = closeIdx === -1
        ? remaining.slice(tagOpenClose + 1)
        : remaining.slice(tagOpenClose + 1, closeIdx);
      // Walk LI items (left-aligned — bullets/numbers look odd justified)
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(inner)) !== null) {
        paragraphs.push(new Paragraph({
          ...baseStyle,
          numbering: tag === 'ul'
            ? { reference: 'bullets', level: 0 }
            : { reference: 'numbers', level: 0 },
          children: inlineRuns(liMatch[1]),
        }));
      }
      cursor = closeIdx === -1 ? remaining.length : closeIdx + closeTag.length;
    } else {
      cursor = tagOpenClose + 1;
    }
  }

  return paragraphs;
}

// ---------- Helpers for the cover/signature/appendix tables ----------

function coverParagraph(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text, ...opts })],
  });
}

function headerCell(text, { width = 50 } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text, bold: true, color: '000000', size: 22 })],
    })],
  });
}

function plainCell(text, { width = 50, bold = false, align = AlignmentType.LEFT } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    children: [new Paragraph({
      alignment: align,
      spacing: { before: 30, after: 30 },
      children: [new TextRun({ text: String(text ?? ''), bold, size: 22 })],
    })],
  });
}

function blackBorder() {
  return {
    top:              { style: BorderStyle.SINGLE, size: 6, color: '000000' },
    bottom:           { style: BorderStyle.SINGLE, size: 6, color: '000000' },
    left:             { style: BorderStyle.SINGLE, size: 6, color: '000000' },
    right:            { style: BorderStyle.SINGLE, size: 6, color: '000000' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
    insideVertical:   { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  };
}

// Build a docx Table from a 2D array of strings. First row treated as header
// (bold, centred). Body rows have plain black-bordered cells, left-aligned.
function tableFromGrid(grid) {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  const colCount = grid.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
  if (colCount === 0) return null;
  const colWidth = Math.floor(100 / colCount);
  const rows = grid.map((row, i) => {
    const cells = [];
    for (let c = 0; c < colCount; c++) {
      const text = Array.isArray(row) ? (row[c] ?? '') : '';
      cells.push(i === 0
        ? headerCell(text, { width: colWidth })
        : plainCell(text, { width: colWidth }));
    }
    return new TableRow({ children: cells });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
    borders: blackBorder(),
  });
}

// Build a docx Paragraph that contains the banner image, sized to the full
// page width and given negative left/right indents so it overflows the body
// margins and reaches the page edges. Returns null if the file can't be read.
function buildBannerParagraph(filePath, { pageWidthPx = PAGE_WIDTH_PX_PORTRAIT } = {}) {
  if (!filePath) return null;
  let buf;
  let dims;
  try {
    buf = fs.readFileSync(filePath);
    dims = imageSize(buf);
  } catch (err) {
    console.error('[sow] could not read banner image:', filePath, err.message);
    return null;
  }
  if (!dims?.width || !dims?.height) return null;

  const targetWidth = pageWidthPx;
  const targetHeight = Math.round((dims.height / dims.width) * targetWidth);

  const mimeMap = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'png', gif: 'gif', svg: 'svg' };
  const type = mimeMap[(dims.type || '').toLowerCase()] || 'png';

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
    indent: { left: -BODY_MARGIN_TWIPS, right: -BODY_MARGIN_TWIPS },
    children: [
      new ImageRun({
        data: buf,
        transformation: { width: targetWidth, height: targetHeight },
        type,
      }),
    ],
  });
}

// ---------- Main builder ----------

// Build the docx as an in-memory Buffer (no disk side-effect).
// Used by the inline preview endpoint.
export async function buildSowDocxBuffer(data) {
  return generateSowDocx(data, { bufferOnly: true });
}

export async function generateSowDocx(data, opts = {}) {
  const cover = data.cover || {};
  const sections = data.sections || {};
  const signatures = data.signatures || {};
  const tables = data.tables || {};
  const branding = data.branding || {};
  const issuer = data.issuer || {};
  const typography = data.typography || {};

  // Resolve typography (each value falls back to a sensible default).
  // Sizes are in points; docx-js uses half-points so we multiply by 2.
  const FONT = typography.fontFamily || 'Arial';
  const BODY_HP = (typography.bodyFontSize || 12) * 2;
  const H1_HP   = (typography.h1FontSize   || 14) * 2;
  const H2_HP   = (typography.h2FontSize   || 13) * 2;
  const H3_HP   = (typography.h3FontSize   || 12) * 2;

  // Issuing company details (the FSA tenant company whose project this SOW belongs to).
  // Company name is ALWAYS displayed in ALL CAPS on the cover.
  const issuerRawName = issuer.name || 'E-Click';
  const issuerName = issuerRawName.toUpperCase();
  const issuerNameDisplay = issuerRawName;
  const issuerRegNo = issuer.registrationNumber || '—';

  // Per-heading "all caps" flags
  const h1AllCaps = !!typography.h1AllCaps;
  const h2AllCaps = !!typography.h2AllCaps;
  const h3AllCaps = !!typography.h3AllCaps;

  // Compose the full version string: "<Company> // <Client>: V<n>"
  const clientNameForTitle = (cover.clientName || '').trim();
  const rawVersion = (cover.version || '').trim();
  const versionDisplay = rawVersion
    ? (rawVersion.includes('//') ? rawVersion : `${issuerNameDisplay} // ${clientNameForTitle || 'Client'}: V${rawVersion}`)
    : '';

  // Factories that build a fresh Header/Footer per call. docx-js can't share
  // Paragraph instances across multiple Header/Footer owners, so each section
  // needs its own copy.
  function makeHeader({ landscape = false } = {}) {
    const pageWidthPx = landscape ? PAGE_WIDTH_PX_LANDSCAPE : PAGE_WIDTH_PX_PORTRAIT;
    const path = landscape ? (branding.landscapeHeaderPath || branding.headerPath) : branding.headerPath;
    const banner = buildBannerParagraph(path, { pageWidthPx });
    return banner ? new Header({ children: [banner] }) : undefined;
  }
  function makeFooter({ withPageNumber, landscape = false } = {}) {
    const pageWidthPx = landscape ? PAGE_WIDTH_PX_LANDSCAPE : PAGE_WIDTH_PX_PORTRAIT;
    const path = landscape ? (branding.landscapeFooterPath || branding.footerPath) : branding.footerPath;
    const banner = buildBannerParagraph(path, { pageWidthPx });
    const children = [];
    if (withPageNumber) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ children: [PageNumber.CURRENT], color: '000000', size: 18 })],
      }));
    }
    if (banner) {
      children.push(banner);
    } else if (!withPageNumber) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: 'E-Click (Pty) Ltd · Statement of Work',
          color: '000000', size: 18,
        })],
      }));
    }
    return new Footer({ children });
  }

  const sharedPageProps = {
    size: { orientation: PageOrientation.PORTRAIT },
    margin: {
      top: BODY_MARGIN_TWIPS,
      bottom: BODY_MARGIN_TWIPS,
      left: BODY_MARGIN_TWIPS,
      right: BODY_MARGIN_TWIPS,
      header: 0,
      footer: 0,
    },
  };
  const landscapePageProps = {
    size: { orientation: PageOrientation.LANDSCAPE },
    margin: {
      top: BODY_MARGIN_TWIPS,
      bottom: BODY_MARGIN_TWIPS,
      left: BODY_MARGIN_TWIPS,
      right: BODY_MARGIN_TWIPS,
      header: 0,
      footer: 0,
    },
  };

  // ---- COVER PAGE ----
  // Title line: "<Issuer> / <Client>" then "Statement of Work" on its own line.
  const titleLine = clientNameForTitle ? `${issuerName} / ${clientNameForTitle}` : issuerName;

  // Cover-page customisation overrides (cover.fullPage). Each field is
  // optional and falls back to the historical default so existing SOWs render
  // unchanged. Author-typed strings are trimmed and accepted verbatim — empty
  // strings mean "use default". Kept in lockstep with sow-pdf.js so the .docx
  // and PDF outputs render identical covers.
  const fp = (cover && typeof cover.fullPage === 'object') ? cover.fullPage : {};
  const docTitle      = (typeof fp.documentTitle  === 'string' && fp.documentTitle.trim())  ? fp.documentTitle  : 'Statement of Work';
  const introText     = (typeof fp.introText      === 'string' && fp.introText.trim())      ? fp.introText      : 'Entered into by and between';
  const party1Label   = (typeof fp.party1Label    === 'string' && fp.party1Label.trim())    ? fp.party1Label    : '(hereinafter referred to as "Contractor")';
  const party2Label   = (typeof fp.party2Label    === 'string' && fp.party2Label.trim())    ? fp.party2Label    : '(hereinafter referred to as "the Client")';
  const party1Label2  = (typeof fp.party1Label2   === 'string' && fp.party1Label2.trim())   ? fp.party1Label2   : '';
  const party2Label2  = (typeof fp.party2Label2   === 'string' && fp.party2Label2.trim())   ? fp.party2Label2   : '';
  const connectorText = (typeof fp.connectorText  === 'string' && fp.connectorText.trim())  ? fp.connectorText  : 'and';
  const showRegNum       = fp.showRegistrationNumber !== false;
  const showDateVerTable = fp.showDateVersionTable   !== false;

  const coverChildren = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      // Bigger top padding so the cover content sits visually centred on the page.
      spacing: { before: 2400, after: 0 },
      children: [new TextRun({ text: titleLine, bold: true, size: 32, color: '000000' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 400 },
      children: [new TextRun({ text: docTitle, bold: true, size: 32, color: '000000' })],
    }),

    coverParagraph(introText, { size: 24, color: '000000' }),
    new Paragraph({ spacing: { before: 120, after: 0 } }),
    coverParagraph(issuerName, { bold: true, size: 26, color: '000000' }),
    ...(showRegNum
      ? [coverParagraph(`Registration number: ${issuerRegNo}`, { bold: true, size: 24, color: '000000' })]
      : []),
    coverParagraph(party1Label, { bold: true, size: 22, color: '000000' }),
    ...(party1Label2
      ? [coverParagraph(party1Label2, { bold: true, size: 22, color: '000000' })]
      : []),
    new Paragraph({ spacing: { before: 200, after: 0 } }),
    coverParagraph(connectorText, { size: 24, color: '000000' }),
    new Paragraph({ spacing: { before: 200, after: 0 } }),
    ...(clientNameForTitle
      ? [coverParagraph(clientNameForTitle, { bold: true, size: 26, color: '000000' })]
      : []),
    coverParagraph(party2Label, { bold: true, size: 22, color: '000000' }),
    ...(party2Label2
      ? [coverParagraph(party2Label2, { bold: true, size: 22, color: '000000' })]
      : []),

    new Paragraph({ spacing: { before: 600, after: 200 } }),

    // Date / Version table at the bottom of the cover (skipped when the
    // author has turned off `showDateVersionTable` via the editor).
    ...(showDateVerTable ? [new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        left:   { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        right:  { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        insideVertical:   { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'Date of submission:', bold: true, size: 24 })],
              })],
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'Version:', bold: true, size: 24 })],
              })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                // Data row values use the company font @ 11pt
                children: [new TextRun({ text: cover.dateOfSubmission || '', font: FONT, size: 22 })],
              })],
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: versionDisplay, font: FONT, size: 22 })],
              })],
            }),
          ],
        }),
      ],
    })] : []),

    new Paragraph({ children: [], pageBreakBefore: true }),
  ];

  // Resolve the user-edited section list up-front so we can build a static
  // TOC that mirrors the actual document (preview-friendly).
  const sectionList = resolveSectionList(sections);

  // ---- TABLE OF CONTENTS ----
  // Render as static paragraphs (level-indented) so docx-preview can show
  // them. Word's TOC field would only fill in after the user clicks
  // "Update fields" — too easily missed, and the preview can't render it.
  function tocEntry(text, level = 1) {
    const indentLeft = (level - 1) * 280;
    return new Paragraph({
      spacing: { line: 360, lineRule: 'auto', before: 0, after: 0 },
      indent: { left: indentLeft },
      tabStops: [{ type: 'right', position: 9000, leader: 'dot' }],
      children: [new TextRun({ text, color: '000000' })],
    });
  }
  const tocChildren = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 200 },
      children: [new TextRun({ text: 'Table of Contents', bold: true, color: '000000', size: 32 })],
    }),
  ];
  sectionList.forEach((s, i) => {
    const num = i + 1;
    tocChildren.push(tocEntry(`${num}. ${(s.title || '').trim() || `Section ${num}`}`, 1));
    (Array.isArray(s.subsections) ? s.subsections : []).forEach((sub, j) => {
      const subNum = `${num}.${j + 1}`;
      tocChildren.push(tocEntry(`${subNum} ${(sub.title || '').trim()}`, 2));
      (Array.isArray(sub.subsubsections) ? sub.subsubsections : []).forEach((ss, k) => {
        tocChildren.push(tocEntry(`${subNum}.${k + 1} ${(ss.title || '').trim()}`, 3));
      });
    });
  });
  // Signature + appendix entries
  tocChildren.push(tocEntry(`${sectionList.length + 1}. Signature Control`, 1));
  tocChildren.push(tocEntry(`${sectionList.length + 2}. Appendix A: Detailed Milestone Breakdown, Cost & Timeline Allocation`, 1));
  tocChildren.push(tocEntry(`${sectionList.length + 3}. Appendix B: SLA Monthly Fee and Service Allocation`, 1));

  // (No trailing page-break paragraph needed — the next section break already
  // forces a new page.)

  // ---- NUMBERED SECTIONS (with optional sub-sections) ----
  // The sections field can be a plain array of { title, body, subsections }
  // (current shape) OR the legacy object keyed by section name — already resolved above.
  const sectionChildren = [];
  sectionList.forEach((s, idx) => {
    const title = (s.title || '').trim() || `Section ${idx + 1}`;
    const body = s.body || '';
    const subs = Array.isArray(s.subsections) ? s.subsections : [];

    sectionChildren.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 320, after: 160 },
      // Thin grey separator above every Heading 1 except the very first one
      ...(idx > 0 ? {
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'C8CDD0', space: 16 } },
      } : {}),
      children: [new TextRun({ text: `${idx + 1}. ${title}`, bold: true, color: '000000', allCaps: h1AllCaps })],
    }));

    const bodyParas = htmlToParagraphs(body);
    if (bodyParas.length === 0 && subs.length === 0) {
      sectionChildren.push(new Paragraph({ children: [new TextRun({ text: '—', color: '000000' })] }));
    } else {
      for (const p of bodyParas) sectionChildren.push(p);
    }

    // Render sub-sections as Heading 2 with N.M numbering so they appear in the TOC
    subs.forEach((sub, subIdx) => {
      const subTitle = (sub?.title || '').trim() || 'Sub-section';
      sectionChildren.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 80 },
        children: [new TextRun({
          text: `${idx + 1}.${subIdx + 1} ${subTitle}`,
          bold: true,
          color: '000000',
          allCaps: h2AllCaps,
        })],
      }));
      const subParas = htmlToParagraphs(sub?.body || '');
      const subsubs = Array.isArray(sub?.subsubsections) ? sub.subsubsections : [];
      if (subParas.length === 0 && subsubs.length === 0) {
        sectionChildren.push(new Paragraph({ children: [new TextRun({ text: '—', color: '000000' })] }));
      } else {
        for (const p of subParas) sectionChildren.push(p);
      }

      // Heading 3 entries — N.M.O numbering, appear in TOC at level 3
      subsubs.forEach((ss, ssIdx) => {
        const ssTitle = (ss?.title || '').trim() || 'Heading 3';
        sectionChildren.push(new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 180, after: 60 },
          children: [new TextRun({
            text: `${idx + 1}.${subIdx + 1}.${ssIdx + 1} ${ssTitle}`,
            bold: true,
            color: '000000',
            allCaps: h3AllCaps,
          })],
        }));
        const ssParas = htmlToParagraphs(ss?.body || '');
        if (ssParas.length > 0) {
          for (const p of ssParas) sectionChildren.push(p);
        }
      });
    });
  });

  // The number for the Signature Control + Appendix headings shifts based on
  // how many main sections the user kept.
  const numSections = sectionList.length;
  const SIG_NUM = numSections + 1;
  const APP_A_NUM = numSections + 2;
  const APP_B_NUM = numSections + 3;

  // ---- SIGNATURE CONTROL ----
  const sigChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 320, after: 160 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'C8CDD0', space: 16 } },
      children: [new TextRun({ text: `${SIG_NUM}. Signature Control`, bold: true, color: '000000', allCaps: h1AllCaps })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Client', bold: true, color: '000000', allCaps: h2AllCaps })],
    }),
    new Paragraph({ children: [new TextRun({ text: signatures.clientCompany || cover.clientName || '' })] }),
    new Paragraph({ children: [new TextRun({ text: 'Who warrants that he/she is authorised to do so', italics: true, color: '000000' })] }),
    sigRow('Name & Surname', signatures.clientName),
    sigRow('Post Designation', signatures.clientDesignation),
    sigRow('Signature', ''),
    sigRow('Date', signatures.clientDate),
    sigRow('Location', signatures.clientLocation),
    new Paragraph({ spacing: { before: 240 }, children: [] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `Service Provider: ${issuerNameDisplay}`, bold: true, color: '000000', allCaps: h2AllCaps })],
    }),
    new Paragraph({ children: [new TextRun({ text: 'Who warrants that he/she is authorised to do so', italics: true, color: '000000' })] }),
    sigRow('Name & Surname', signatures.providerName),
    sigRow('Post Designation', signatures.providerDesignation),
    sigRow('Signature', ''),
    sigRow('Date', signatures.providerDate),
    sigRow('Location', signatures.providerLocation),
  ];

  function sigRow(label, value) {
    return new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: `${label}: `, bold: true }),
        new TextRun({ text: value || '___________________________' }),
      ],
    });
  }

  // ---- APPENDICES ----
  const appendixA = tableFromGrid(tables.appendixA) || new Paragraph({
    children: [new TextRun({ text: 'No detailed milestone breakdown provided.', color: '000000', italics: true })],
  });
  const appendixB = tableFromGrid(tables.monthlyServiceAllocation) || new Paragraph({
    children: [new TextRun({ text: 'No monthly service allocation provided.', color: '000000', italics: true })],
  });

  // Appendix A lives in its own LANDSCAPE section so the wide milestone table
  // has room to breathe. No `pageBreakBefore` is needed — the section break
  // already forces a new page.
  const appendixAChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text: `${APP_A_NUM}. Appendix A: Detailed Milestone Breakdown, Cost & Timeline Allocation`, bold: true, color: '000000', allCaps: h1AllCaps })],
    }),
    appendixA,
  ];

  // Appendix B stays in portrait.
  const appendixBChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 120 },
      children: [new TextRun({ text: `${APP_B_NUM}. Appendix B: SLA Monthly Fee and Service Allocation`, bold: true, color: '000000', allCaps: h1AllCaps })],
    }),
    new Paragraph({ children: [new TextRun({ text: 'SLA Monthly Fee and Service Allocation Summary:', bold: true })] }),
    appendixB,
  ];

  // ---- DOCUMENT ASSEMBLY ----
  const doc = new Document({
    creator: 'FSA HR Portal',
    title: `E-Click SOW — ${cover.clientName || ''}`,
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{
            level: 0, format: LevelFormat.BULLET, text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 220 } } },
          }],
        },
        {
          reference: 'numbers',
          levels: [{
            level: 0, format: LevelFormat.DECIMAL, text: '%1.',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 260 } } },
          }],
        },
      ],
    },
    styles: {
      default: {
        // Body text — font family + size driven by company typography settings
        document: { run: { font: FONT, size: BODY_HP } },
      },
      paragraphStyles: [
        {
          // Heading 1 — bold, black, size from company settings
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: H1_HP, bold: true, color: '000000' },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          // Heading 2 — bold, black
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: H2_HP, bold: true, color: '000000' },
          paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 1 },
        },
        {
          // Heading 3 — bold, black
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: H3_HP, bold: true, color: '000000' },
          paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 2 },
        },
        // TOC entry styles — Word populates the table of contents using these.
        // line: 360 + lineRule: auto = 1.5 line spacing (240 = single, 480 = double).
        {
          id: 'TOC1', name: 'toc 1', basedOn: 'Normal', next: 'Normal',
          run: { font: FONT, size: BODY_HP },
          paragraph: { spacing: { line: 360, lineRule: 'auto', before: 0, after: 0 } },
        },
        {
          id: 'TOC2', name: 'toc 2', basedOn: 'Normal', next: 'Normal',
          run: { font: FONT, size: BODY_HP },
          paragraph: { spacing: { line: 360, lineRule: 'auto', before: 0, after: 0 }, indent: { left: 220 } },
        },
        {
          id: 'TOC3', name: 'toc 3', basedOn: 'Normal', next: 'Normal',
          run: { font: FONT, size: BODY_HP },
          paragraph: { spacing: { line: 360, lineRule: 'auto', before: 0, after: 0 }, indent: { left: 440 } },
        },
      ],
    },
    sections: [
      // ── Section 1 — cover page + Table of Contents (portrait, no page numbers)
      {
        properties: { page: sharedPageProps },
        headers: { default: makeHeader() },
        footers: { default: makeFooter({ withPageNumber: false }) },
        children: [...coverChildren, ...tocChildren],
      },
      // ── Section 2 — numbered body sections + signature control (portrait)
      // Page numbering restarts at 1 on this section's first page (bottom-centre).
      {
        properties: {
          page: {
            ...sharedPageProps,
            pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
          },
        },
        headers: { default: makeHeader() },
        footers: { default: makeFooter({ withPageNumber: true }) },
        children: [...sectionChildren, ...sigChildren],
      },
      // ── Section 3 — Appendix A (LANDSCAPE) for the wide milestone breakdown
      {
        properties: { page: landscapePageProps },
        headers: { default: makeHeader({ landscape: true }) },
        footers: { default: makeFooter({ withPageNumber: true, landscape: true }) },
        children: appendixAChildren,
      },
      // ── Section 4 — Appendix B (portrait again)
      {
        properties: { page: sharedPageProps },
        headers: { default: makeHeader() },
        footers: { default: makeFooter({ withPageNumber: true }) },
        children: appendixBChildren,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  if (opts.bufferOnly) return buf;

  // Persist to /uploads with a sortable filename
  const safeClient = (cover.clientName || 'client').replace(/[^\w\-]+/g, '_').slice(0, 32);
  const filename = `sow-${safeClient}-${crypto.randomBytes(4).toString('hex')}.docx`;
  const filepath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filepath, buf);
  return filename;
}
