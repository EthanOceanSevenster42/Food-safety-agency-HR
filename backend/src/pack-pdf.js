// Role / KPI / EDP Pack PDF builder.
//
// Renders ONE combined PDF that stitches the project's Job Description,
// KPI Document, and EDP Alignment Notes together with a shared cover
// page and consistent branding.
//
// The Pack task itself stores no data — it's a render-time composition.
// Every payload (jd / kpidoc / edp / kpa) is pulled from the sibling
// processes in the project by the route caller and handed in here.
//
// Rendering strategy: instead of reimplementing each document's layout,
// we IMPORT the content-block builders from jd-pdf.js / kpidoc-pdf.js /
// edp-pdf.js and splice them into per-orientation pdfmake documents.
//
// Why THREE documents merged with pdf-lib (not one pdfmake doc):
//   pdfmake page margins are DOCUMENT-GLOBAL — there is no per-page
//   override. But the two orientations want different margins:
//     - Portrait pages need a tall top margin to seat the letterhead
//       header banner on EVERY page.
//     - Landscape KPI-review pages must have a SMALL top margin so the
//       wide table fills the page (no reserved header band).
//   One document can't satisfy both, so we render:
//     Segment A (portrait)  : cover + JD + KPI intro/legend
//     Segment B (landscape) : KPI review tables + signatures
//     Segment C (portrait)  : EDP
//   then concatenate them with pdf-lib and stamp continuous page numbers
//   across the merged whole.
//
// Header / footer policy:
//   - Header letterhead banner: drawn by pdfmake's per-page callback on
//     EVERY portrait page (segments A + C). Landscape pages get NO header
//     so the review table sits snug at the top.
//   - Footer banner: drawn on EVERY page of every segment (portrait and
//     landscape).
//   - Page number ("n / total"): stamped by pdf-lib after merge so the
//     count is continuous across all three segments. It sits in a small
//     gutter left below the footer banner.

import pdfmake from 'pdfmake';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { resolveFont, readBanner } from './sow-pdf.js';
import { buildJdContentBlocks }     from './jd-pdf.js';
import { buildKpidocContentBlocks } from './kpidoc-pdf.js';
import { buildEdpContentBlocks }    from './edp-pdf.js';

const A4_PORTRAIT_WIDTH  = 595;
const A4_LANDSCAPE_WIDTH = 842;
const PAGE_MARGIN_LR     = 56;
// Gutter reserved at the very bottom of every page for the stamped page
// number, sitting just below the footer banner.
const FOOTER_NUM_GUTTER  = 22;

// The pack's name reflects which parts are actually included:
// Role (Job Description), KPI (KPI Document), EDP (Alignment Notes).
// e.g. "Role, KPI & EDP Pack", "Role & KPI Pack", "KPI Pack".
export function buildPackName({ haveJd, haveKpiDoc, haveEdp } = {}) {
  const parts = [];
  if (haveJd)     parts.push('Role');
  if (haveKpiDoc) parts.push('KPI');
  if (haveEdp)    parts.push('EDP');
  const joined = parts.length === 0 ? 'Document'
    : parts.length === 1 ? parts[0]
    : parts.length === 2 ? parts.join(' & ')
    : parts.slice(0, -1).join(', ') + ' & ' + parts[parts.length - 1];
  return `${joined} Pack`;
}

// Full descriptive title, used for the PDF /Title metadata AND the download
// filename: "<name> — <employee> · <company>".
export function packDocTitle({ employeeName = '', issuerName = '', ...flags } = {}) {
  const name = buildPackName(flags);
  const emp = (employeeName || '').trim();
  const iss = (issuerName || '').trim();
  return `${name}${emp ? ' — ' + emp : ''}${iss ? ' · ' + iss : ''}`;
}

// Section divider — a small uppercase eyebrow + thin rule that labels
// each part. `pageBreak` defaults to 'before'; pass `pageBreak: null`
// for the first node of a segment (a leading page-break would emit a
// blank page).
function partDivider(label, BODY, options = {}) {
  const { pageBreak = 'before', color = '#888' } = options;
  const node = {
    stack: [
      {
        text: label,
        bold: true,
        fontSize: Math.max(8, BODY - 2),
        color,
        characterSpacing: 2,
        margin: [0, 0, 0, 4],
      },
      {
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 480, y2: 0, lineWidth: 0.75, lineColor: '#cccccc' },
        ],
        margin: [0, 0, 0, 14],
      },
    ],
  };
  if (pageBreak) node.pageBreak = pageBreak;
  return node;
}

export async function buildPackPdfBuffer(input) {
  const {
    jdData = null,
    kpidocData = null,
    edpData = null,
    kpaProcess = null,
    employeeName = '',
    employeeTitle = '',
    jdTitle = '',
    reportToName = '',
    branding = {},
    issuer = {},
    typography = {},
  } = input || {};

  const FONT = resolveFont(typography.fontFamily);
  const BODY = typography.bodyFontSize || 10;
  const H1   = typography.h1FontSize   || 18;
  const H2   = typography.h2FontSize   || 13;

  const portraitHeader = readBanner(branding.headerPath, { pageWidthMm: 210 });
  const portraitFooter = readBanner(branding.footerPath, { pageWidthMm: 210 });

  const headerInset = branding.headerSideMargin ? PAGE_MARGIN_LR : 0;
  const footerInset = branding.footerSideMargin ? PAGE_MARGIN_LR : 0;

  // Rendered banner heights depend on the page width they're drawn at.
  const bannerHeight = (banner, pageWidth, inset) =>
    banner ? (banner._origHeight / banner._origWidth) * (pageWidth - inset * 2) : 0;

  const portraitHeaderH = bannerHeight(portraitHeader, A4_PORTRAIT_WIDTH,  headerInset);
  const portraitFooterH = bannerHeight(portraitFooter, A4_PORTRAIT_WIDTH,  footerInset);
  const landscapeFooterH = bannerHeight(portraitFooter, A4_LANDSCAPE_WIDTH, footerInset);

  const issuerName = (issuer.name || '').trim();
  const coverTitle = (jdTitle || employeeTitle || '').trim();
  const haveJd     = !!jdData;
  const haveKpiDoc = !!(kpaProcess && Array.isArray(kpaProcess.kpas) && kpaProcess.kpas.length);
  const haveEdp    = !!edpData;
  const packName   = buildPackName({ haveJd, haveKpiDoc, haveEdp });

  // ---------- Per-segment pdfmake renderer ----------
  // withHeader → draws the letterhead banner on every page (portrait
  // segments). Every segment draws the footer banner on every page. The
  // page number is NOT drawn here — pdf-lib stamps it after merge so the
  // count spans all segments.
  async function renderSegment({ content, orientation }) {
    const isLandscape = orientation === 'landscape';
    const pageWidth   = isLandscape ? A4_LANDSCAPE_WIDTH : A4_PORTRAIT_WIDTH;
    // Header only on portrait pages.
    const withHeader  = !isLandscape && !!portraitHeader;
    const footerH     = isLandscape ? landscapeFooterH : portraitFooterH;

    const marginTop = withHeader
      ? portraitHeaderH + 16
      : (isLandscape ? 24 : 56);
    const marginBottom = (footerH > 0 ? footerH : 0) + FOOTER_NUM_GUTTER;

    function header() {
      if (!withHeader) return null;
      return {
        image: portraitHeader.image,
        width: pageWidth - headerInset * 2,
        margin: [headerInset, 0, headerInset, 0],
      };
    }
    function footer() {
      if (!portraitFooter) return null;
      // Banner sits at the top of the bottom-margin band; the
      // FOOTER_NUM_GUTTER below it is left clear for the stamped number.
      return {
        image: portraitFooter.image,
        width: pageWidth - footerInset * 2,
        margin: [footerInset, 0, footerInset, 0],
      };
    }

    const docDef = {
      pageSize: 'A4',
      pageOrientation: orientation,
      pageMargins: [PAGE_MARGIN_LR, marginTop, PAGE_MARGIN_LR, marginBottom],
      defaultStyle: { font: FONT, fontSize: BODY },
      header: withHeader ? header : undefined,
      footer: portraitFooter ? footer : undefined,
      content,
    };
    return await pdfmake.createPdf(docDef).getBuffer();
  }

  // ===================================================================
  // Segment A (portrait): cover + JD + KPI intro/legend
  // ===================================================================
  const segA = [];

  // ----- Cover page -----
  // The header/footer banners come from the per-page callbacks, so the
  // cover just carries its title block below the letterhead.
  segA.push({
    text: 'DOCUMENT PACK',
    fontSize: 9,
    color: '#888',
    characterSpacing: 4,
    alignment: 'center',
    margin: [0, 36, 0, 8],
  });

  // Main title with an underline that stretches EXACTLY the width of the
  // title text: the title sits in a shrink-to-fit table (width 'auto')
  // and we draw only that table's bottom border. Flanking '*' spacer
  // columns keep it centred.
  const titleFontSize = Math.max(24, H1 + 6);
  segA.push({
    columns: [
      { width: '*', text: '' },
      {
        width: 'auto',
        table: {
          widths: ['auto'],
          body: [[{
            text: packName,
            fontSize: titleFontSize,
            bold: true,
            alignment: 'center',
            margin: [0, 0, 0, 6],
          }]],
        },
        layout: {
          hLineWidth: (i) => (i === 1 ? 1 : 0),  // bottom border only
          vLineWidth: () => 0,
          hLineColor: () => '#000',
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      },
      { width: '*', text: '' },
    ],
    margin: [0, 0, 0, 22],
  });

  if (coverTitle) {
    segA.push({ text: coverTitle, fontSize: H2 + 2, bold: true, alignment: 'center', margin: [0, 0, 0, 4] });
  }
  if (employeeName) {
    segA.push({ text: employeeName, fontSize: H2, alignment: 'center', color: '#444', margin: [0, 0, 0, 4] });
  }
  if (issuerName) {
    segA.push({ text: issuerName, fontSize: BODY, alignment: 'center', color: '#666', margin: [0, 4, 0, 0] });
  }

  // Contents box.
  segA.push({
    table: {
      widths: ['*'],
      body: [
        [{
          stack: [
            { text: 'CONTENTS', fontSize: 10, bold: true, color: '#666', characterSpacing: 3, margin: [0, 0, 0, 10] },
            ...[
              { label: 'Part 1 — Job Description',            present: haveJd },
              { label: 'Part 2 — Key Performance Indicators', present: haveKpiDoc },
              { label: 'Part 3 — EDP Alignment Notes',        present: haveEdp },
            ].map((c, i) => ({
              columns: [
                { text: String(i + 1).padStart(2, '0'), width: 28, color: '#999', fontSize: BODY },
                { text: c.label, fontSize: BODY, color: c.present ? '#000' : '#aaa', italics: !c.present },
                {
                  text: c.present ? '✓ Included' : 'Not available',
                  width: 110, alignment: 'right', fontSize: Math.max(8, BODY - 2),
                  color: c.present ? '#2a7a2a' : '#aaa',
                },
              ],
              margin: [0, 4, 0, 4],
            })),
          ],
          margin: [16, 14, 16, 14],
        }],
      ],
    },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0.5,
      hLineColor: () => '#ddd', vLineColor: () => '#ddd',
    },
    margin: [20, 60, 20, 0],
  });

  // ----- Part 1: Job Description -----
  segA.push(partDivider('PART 1 — JOB DESCRIPTION', BODY));
  if (haveJd) {
    segA.push(...buildJdContentBlocks({ data: jdData, kpaProcess, issuer, typography, reportToName }));
  } else {
    segA.push({ text: 'Job Description data not found for this project.', italics: true, color: '#999', fontSize: BODY, margin: [0, 12, 0, 12] });
  }

  // ----- Part 2: KPI intro/legend (portrait part only) -----
  segA.push(partDivider('PART 2 — KEY PERFORMANCE INDICATORS', BODY));
  const kpiTypography = { ...typography, bodyFontSize: 9, h1FontSize: 14, h2FontSize: 11 };
  if (haveKpiDoc) {
    segA.push(...buildKpidocContentBlocks(
      { data: kpidocData || {}, kpaProcess, issuer, typography: kpiTypography },
      { part: 'intro' },
    ));
  } else {
    segA.push({
      text: 'KPI Document data not found for this project — run the KPA Capture task and the KPI Document task to populate this section.',
      italics: true, color: '#999', fontSize: BODY, margin: [0, 12, 0, 12],
    });
  }

  // ===================================================================
  // Segment B (landscape): KPI review tables + signatures
  // Only exists when there is KPA data.
  // ===================================================================
  const segB = haveKpiDoc
    ? buildKpidocContentBlocks(
        { data: kpidocData || {}, kpaProcess, issuer, typography: kpiTypography },
        { part: 'review', reviewStartsNewPage: false },
      )
    : null;

  // ===================================================================
  // Segment C (portrait): EDP Alignment Notes
  // ===================================================================
  const segC = [];
  // First node of the segment → no page-break (would emit a blank page).
  segC.push(partDivider('PART 3 — EDP ALIGNMENT NOTES', BODY, { pageBreak: null }));
  if (haveEdp) {
    segC.push(...buildEdpContentBlocks({ data: edpData, typography }, { startOnNewPage: false }));
  } else {
    segC.push({ text: 'EDP Alignment Notes not found for this project.', italics: true, color: '#999', fontSize: BODY, margin: [0, 12, 0, 12] });
  }

  // ---------- Render each segment ----------
  const segments = [{ content: segA, orientation: 'portrait' }];
  if (segB && segB.length) segments.push({ content: segB, orientation: 'landscape' });
  segments.push({ content: segC, orientation: 'portrait' });

  const buffers = [];
  for (const seg of segments) buffers.push(await renderSegment(seg));

  // ---------- Merge + stamp continuous page numbers ----------
  const merged  = await PDFDocument.create();
  const numFont = await merged.embedFont(StandardFonts.Helvetica);
  for (const buf of buffers) {
    const doc   = await PDFDocument.load(buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }

  const total = merged.getPageCount();
  const numSize = Math.max(7, BODY - 2);
  merged.getPages().forEach((page, i) => {
    const { width } = page.getSize();
    const label = `${i + 1} / ${total}`;
    const w = numFont.widthOfTextAtSize(label, numSize);
    page.drawText(label, {
      x: (width - w) / 2,
      y: (FOOTER_NUM_GUTTER - numSize) / 2 + 1,
      size: numSize,
      font: numFont,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  merged.setTitle(packDocTitle({ haveJd, haveKpiDoc, haveEdp, employeeName, issuerName }));
  if (issuerName) merged.setAuthor(issuerName);

  const bytes = await merged.save();
  return Buffer.from(bytes);
}
