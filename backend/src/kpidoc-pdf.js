// KPI Document PDF builder. Mirrors the reference Bernadette spreadsheet
// as closely as practical for a single-document PDF: small company logo
// top-left (no full-width banner / no footer), job title + period header,
// "How we use KPIs" intro, rating-scale legend, then the main review
// section.
//
// The review section renders ONE table per KPA. Each KPA block is a
// banner row (Weight · KPA · Core Values) with a single subtle fill,
// followed by the column titles and one row per KPI. The banner + titles
// are repeating headerRows, so when a KPA has more KPIs than fit on a
// page pdfmake reprints the % + KPA name + column titles at the top of
// the next page automatically (no broken merged cells). KPI rows are
// plain white.
//
// Score / Weighted-score columns and the Total/Overall row are omitted
// — capture isn't enabled yet on the editor side.

import pdfmake from 'pdfmake';
import { resolveFont, readBanner } from './sow-pdf.js';

const RATING_SCALE = [
  { label: 'Outstanding',          meaning: 'Consistently exceeds expectations',           score: 5 },
  { label: 'Exceeds Expectations', meaning: 'Often exceeds expectations',                  score: 4 },
  { label: 'Meets Expectations',   meaning: 'Consistently meets expectations',             score: 3 },
  { label: 'Needs Improvement',    meaning: 'Occasionally meets expectations',             score: 2 },
  { label: 'Unsatisfactory',       meaning: 'Performance consistently below expectations', score: 1 },
];

const DEFAULT_INTRO =
  'Key Performance Indicators, or KPIs, are a method of driving performance. ' +
  'KPIs help guide focus and action, and ensure that performance is aligned ' +
  'and targeted towards achieving overall business success.';

const DEFAULT_DECLARATION =
  'Declaration: I was part of the process to set the KPIs and I agree with the KPIs that have been set.';

// Promote KPAs → KPI rows. Each KPI becomes its own row but we also
// preserve the group boundaries so the table can rowspan the shared
// KPA / Weight / Core-values columns.
//
// Output shape: array of groups; each group has the shared properties +
// a list of row objects (one per KPI). The pdfmake renderer flattens
// these into table cells with rowSpan on the first row of each group.
function deriveGroupsFromKpa(kpaProcess) {
  const kpas = Array.isArray(kpaProcess?.kpas) ? kpaProcess.kpas : [];
  const groups = [];
  for (const kpa of kpas) {
    const area = (kpa?.name || kpa?.department || '').toString();
    const weightDecimal = Number.isFinite(Number(kpa?.weight)) ? Number(kpa.weight) / 100 : 0;
    const coreValues = Array.isArray(kpa?.coreValues) ? kpa.coreValues.filter(Boolean) : [];
    const kpis = Array.isArray(kpa?.kpis) ? kpa.kpis : (
      kpa?.kpi ? [{ description: kpa.kpi, measures: kpa.measures }] : []
    );
    const rows = [];
    for (const kpi of kpis) {
      const desc = (kpi?.description || '').toString();
      const measures = Array.isArray(kpi?.measures) ? kpi.measures.filter(Boolean) : [];
      // Multi-measure KPIs render their measures as a newline-separated
      // block in the "How we measure" cell so the table reads vertically.
      const howWeMeasure = measures.join('\n');
      rows.push({ kpiDescription: desc, howWeMeasure });
    }
    if (rows.length === 0) continue; // KPA with no KPIs → skip entirely
    groups.push({ area, weightDecimal, coreValues, rows });
  }
  return groups;
}

// Merge editable per-row review fields keyed by global row index (the
// editor stores them flat, so we re-walk groups to map index → fields).
function attachReviewFields(groups, reviewArr) {
  const safe = Array.isArray(reviewArr) ? reviewArr : [];
  let idx = 0;
  for (const g of groups) {
    for (const r of g.rows) {
      const rev = safe[idx] || {};
      r.dataSource = (rev.dataSource || '').toString();
      r.dataResult = (rev.dataResult || '').toString();
      r.status     = (rev.status     || '').toString();
      r.comments   = (rev.comments   || '').toString();
      idx += 1;
    }
  }
  return groups;
}

// Build the KPI Document's body content as an array of pdfmake nodes.
// NO banner block, NO header/footer callbacks — those wrap the buffer-
// producing entry point below.
//
// Exposed so the Pack builder can splice the KPI Doc's exact rendering
// into a combined PDF without duplicating the layout logic. The Pack
// supplies its own cover page in lieu of the inline banner.
//
// The first block carries `pageBreak: 'before'` only when
// `options.startOnNewPage` is true — useful when this section is being
// stitched into a combined doc and needs to start on a fresh page (in
// the requested orientation).
export function buildKpidocContentBlocks(input, options = {}) {
  const {
    data = {},
    kpaProcess = null,
    issuer = {},
    typography = {},
  } = input || {};
  const {
    startOnNewPage = false,
    startOrientation = null,
    // 'all' (default) returns the portrait intro AND the landscape review
    // section in one array (standalone KPI doc). The Pack renders portrait
    // and landscape parts as SEPARATE pdfmake documents so it can give each
    // its own margins/header/footer, so it pulls 'intro' and 'review'
    // independently.
    part = 'all',
    // When false, the first KPA table does NOT force a landscape page-break
    // — used when 'review' is rendered into an already-landscape document.
    reviewStartsNewPage = true,
  } = options;

  const BODY = typography.bodyFontSize || 9;
  const H1   = typography.h1FontSize   || 14;
  const H2   = typography.h2FontSize   || 11;
  const h1Caps = !!typography.h1AllCaps;
  const applyAllCaps = (text, flag) => flag ? String(text || '').toUpperCase() : String(text || '');

  // Table-specific font sizes — INDEPENDENT of BODY so we can shrink
  // just the review-table cells without affecting the surrounding doc.
  // Tuned per user feedback: "slightly smaller" for the table only.
  const TABLE_BODY = 7;
  const TABLE_HEAD = 6;

  const employeeName  = kpaProcess?.employeeName  || data.employeeNameOverride || '';
  const employeeTitle = kpaProcess?.employeeTitle || data.jobTitle || '';
  const jobTitle      = (data.jobTitle && String(data.jobTitle).trim()) || employeeTitle || '';
  const periodLabel   = (data.periodLabel && String(data.periodLabel).trim()) || '';
  const introText     = (data.introText && String(data.introText).trim()) || DEFAULT_INTRO;
  const declaration   = (data.declarationText && String(data.declarationText).trim()) || DEFAULT_DECLARATION;
  const issuerName    = (issuer.name || '').trim();

  const groups = attachReviewFields(deriveGroupsFromKpa(kpaProcess), data.rowsReview);

  // ---- pdfmake helpers ----
  // cellHead / cellBody are used ONLY by the main review table.
  // Sizes come from the table-specific constants (TABLE_HEAD/TABLE_BODY),
  // not the doc body font, so reducing them doesn't affect the intro
  // paragraph, rating-scale legend, or declaration block.
  const cellHead = (text) => ({
    text,
    bold: true,
    alignment: 'center',
    fontSize: TABLE_HEAD,
    fillColor: '#f3f3f3',
    margin: [2, 4, 2, 4],
  });
  const cellBody = (text, opts = {}) => ({
    text: text == null ? '' : String(text),
    fontSize: TABLE_BODY,
    margin: [3, 3, 3, 3],
    ...opts,
  });

  // ---- Rating scale legend (unchanged from spreadsheet) ----
  const ratingTable = {
    table: {
      widths: [120, '*', 40],
      headerRows: 1,
      body: [
        [
          { text: 'Rating',  bold: true, fillColor: '#f3f3f3', fontSize: BODY, margin: [4, 4, 4, 4] },
          { text: 'Meaning', bold: true, fillColor: '#f3f3f3', fontSize: BODY, margin: [4, 4, 4, 4] },
          { text: 'Score',   bold: true, alignment: 'center', fillColor: '#f3f3f3', fontSize: BODY, margin: [4, 4, 4, 4] },
        ],
        ...RATING_SCALE.map((r) => [
          { text: r.label,   bold: true, fontSize: BODY, margin: [4, 3, 4, 3] },
          { text: r.meaning, fontSize: BODY, margin: [4, 3, 4, 3] },
          { text: String(r.score), alignment: 'center', fontSize: BODY, margin: [4, 3, 4, 3] },
        ]),
      ],
    },
    layout: tableLayout(),
  };

  // ---- Main KPI review section — one table per KPA ----
  // Six columns:
  //   KPI | How we measure | Data For Review | Overall KPI Score
  //   | Weighted score result | Comments
  // The Weight / KPA / Core Values that used to be merged left columns
  // now live in a full-width coloured BANNER row above each KPA's KPIs.
  // Banner + column-title rows are set as repeating headerRows, so a KPA
  // that runs past a page boundary reprints its % + name + column titles
  // at the top of the next page (pdfmake reprints headerRows on every
  // page a table spans). The four trailing columns are rendered EMPTY —
  // reviewers handwrite scores on the printed page — but the underlying
  // data keys (dataSource / dataResult / status / comments) are still
  // preserved on save in case scoring is enabled later.
  //
  // Column widths: KPI + How-we-measure stay as '*' (the copy-heavy
  // columns get the freed-up space); the four review boxes are fixed and
  // only need to fit their wrapped header label.
  const REVIEW_WIDTHS = ['*', '*', 65, 65, 80, 75];
  const REVIEW_COLS = REVIEW_WIDTHS.length;

  // Single subtle banner fill for every KPA (no alternating row tints).
  const BAND_FILL = '#dde6f1';

  const columnTitleRow = () => [
    cellHead('KPI'),
    cellHead('How we measure'),
    cellHead('Data For Review'),
    cellHead('Overall KPI Score'),
    cellHead('Weighted score result'),
    cellHead('Comments'),
  ];

  // Full-width banner cell for a KPA: "KPA   ·   Weight: 25%   ·   Core
  // Values: …". colSpan covers all six columns (followed by 5 empty
  // placeholder cells in the same row).
  function groupBannerCell(g) {
    const weightPercent = g.weightDecimal ? `${Math.round(g.weightDecimal * 100)}%` : '';
    const parts = [{ text: g.area || 'KPA', bold: true }];
    if (weightPercent) parts.push({ text: `      Weight: ${weightPercent}`, color: '#333' });
    if (g.coreValues.length) parts.push({ text: `      Core Values: ${g.coreValues.join(', ')}`, color: '#555', italics: true });
    return {
      text: parts,
      colSpan: REVIEW_COLS,
      fillColor: BAND_FILL,
      fontSize: TABLE_BODY + 1,
      margin: [5, 5, 5, 5],
    };
  }

  // Build one KPA's table. When `isFirst` AND `withLandscapeBreak`, the
  // table carries the page-break + landscape orientation switch that opens
  // the wide review section (used inside the combined standalone doc). In
  // the Pack the review section is its own already-landscape document, so
  // withLandscapeBreak is false and no page-break is emitted.
  function buildGroupTable(g, isFirst, withLandscapeBreak = true) {
    const body = [
      [groupBannerCell(g), {}, {}, {}, {}, {}],
      columnTitleRow(),
    ];
    for (const r of g.rows) {
      body.push([
        cellBody(r.kpiDescription),
        cellBody(r.howWeMeasure),
        cellBody(''),
        cellBody(''),
        cellBody(''),
        cellBody(''),
      ]);
    }
    const node = {
      table: {
        widths: REVIEW_WIDTHS,
        headerRows: 2,          // banner + column titles reprint per page
        dontBreakRows: true,
        keepWithHeaderRows: 1,  // never orphan the banner from its first KPI
        body,
      },
      layout: tableLayout(),
      margin: [0, isFirst ? 0 : 8, 0, 0],
    };
    if (isFirst && withLandscapeBreak) {
      node.pageBreak = 'before';
      node.pageOrientation = 'landscape';
    }
    return node;
  }

  // ---- Signature block ----
  // Declaration paragraph above TWO grouped signing rows:
  //   Employee  →  Name | Signature | Date
  //   Manager   →  Name | Signature | Date
  // Each field reserves vertical space for a hand-written entry, then
  // a thin underline (the signing line) with the field label underneath
  // — so the page reads like a printed form ready to sign.
  const SIG = { name: 200, sig: 220, date: 110 };
  const signingField = (label, lineLength) => ({
    stack: [
      // Empty space for the hand-written entry.
      { text: ' ', fontSize: BODY, margin: [0, 18, 0, 0] },
      // The signing line — drawn via canvas so its width can be
      // controlled independently of the cell, and so it appears as a
      // crisp single-stroke line at print resolution.
      {
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: lineLength, y2: 0, lineWidth: 0.75, lineColor: '#000' },
        ],
      },
      // Label under the line, muted so it reads as a caption.
      {
        text: label,
        fontSize: Math.max(7, BODY - 1),
        color: '#666',
        margin: [0, 4, 0, 0],
      },
    ],
    width: lineLength,
  });

  // One signing row = group label + three fields side by side, spaced
  // by 20pt gaps. A trailing '*' spacer pushes the row to fill the
  // page width while keeping the fields left-aligned at fixed sizes.
  const signingRow = (groupLabel) => ({
    stack: [
      {
        text: groupLabel,
        bold: true,
        fontSize: BODY,
        margin: [0, 0, 0, 4],
      },
      {
        columns: [
          signingField('Name',      SIG.name),
          { text: '', width: 20 },
          signingField('Signature', SIG.sig),
          { text: '', width: 20 },
          signingField('Date',      SIG.date),
          { text: '', width: '*' },
        ],
      },
    ],
    margin: [0, 0, 0, 24],
  });

  // The declaration + both signing rows must never be split across a page
  // boundary. Wrapping them in a single-row table with `dontBreakRows`
  // keeps the whole block together — if it doesn't fit in the remaining
  // space on the current page it moves, intact, to the next one. The
  // borderless/zero-padding layout makes the wrapper invisible so it looks
  // exactly like the plain stack it replaces.
  const signatureBlock = {
    table: {
      widths: ['*'],
      dontBreakRows: true,
      body: [[
        {
          stack: [
            { text: declaration, fontSize: BODY, margin: [0, 16, 0, 24] },
            signingRow('Employee'),
            signingRow('Manager'),
          ],
        },
      ]],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 16, 0, 0],
  };

  // ---- Content composition ----
  // Split into the PORTRAIT intro block (title + intro + rating legend)
  // and the LANDSCAPE review block (KPA tables + signatures) so callers
  // can pull them independently (see `part`).

  // Document H1 — the canonical "Key Performance Indicators" header
  // identifies the document type at a glance. Job title + employee
  // name + period sit beneath as subheadings so the reader knows
  // whose KPIs this is.
  //
  // When this section is spliced into a combined doc (the Pack), the
  // caller can request a forced page break + orientation here so the
  // KPI Doc starts cleanly on a fresh page.
  const introContent = [];
  const titleNode = {
    text: applyAllCaps('Key Performance Indicators', h1Caps),
    fontSize: H1, bold: true, alignment: 'center', margin: [0, 0, 0, 6],
  };
  if (startOnNewPage) {
    titleNode.pageBreak = 'before';
    if (startOrientation) titleNode.pageOrientation = startOrientation;
  }
  introContent.push(titleNode);
  if (jobTitle) {
    introContent.push({
      text: jobTitle,
      fontSize: H2, bold: true, alignment: 'center',
      margin: [0, 0, 0, 2],
    });
  }
  if (employeeName) {
    introContent.push({
      text: employeeName,
      fontSize: H2, alignment: 'center', color: '#444',
      margin: [0, 0, 0, 2],
    });
  }
  if (periodLabel) {
    introContent.push({
      text: periodLabel,
      fontSize: BODY, alignment: 'center', color: '#555',
      margin: [0, 0, 0, 12],
    });
  } else {
    introContent.push({ text: '', margin: [0, 0, 0, 6] });
  }

  introContent.push({ text: 'How are we using KPIs?', bold: true, fontSize: H2, margin: [0, 4, 0, 4] });
  introContent.push({ text: introText, fontSize: BODY, margin: [0, 0, 0, 8] });

  introContent.push({ text: 'How do you define good performance / "success" for KPIs?', bold: true, fontSize: H2, margin: [0, 4, 0, 4] });
  introContent.push(ratingTable);

  // The review section is wide — in the standalone doc the FIRST KPA
  // table carries a page-break + landscape orientation switch so it has
  // room to breathe (pdfmake keeps subsequent pages landscape until
  // another override). Each KPA is its own table so its banner + column
  // titles reprint on any page it overflows onto.
  const reviewContent = [];
  if (groups.length) {
    groups.forEach((g, gi) => reviewContent.push(buildGroupTable(g, gi === 0, reviewStartsNewPage)));
    // Signature block follows on the same landscape pages.
    reviewContent.push(signatureBlock);
  } else if (reviewStartsNewPage) {
    // No KPAs captured — still move to a landscape page so the signing
    // block keeps its usual place at the end of the standalone document.
    reviewContent.push({ ...signatureBlock, pageBreak: 'before', pageOrientation: 'landscape' });
  } else {
    reviewContent.push(signatureBlock);
  }

  if (part === 'intro')  return introContent;
  if (part === 'review') return reviewContent;
  return [...introContent, ...reviewContent];
}

// Standalone KPI Document PDF: page 1 portrait (banner + intro + rating
// scale legend) and pages 2+ landscape (wide review table + signatures).
// Calls buildKpidocContentBlocks for the body content and prepends the
// inline page-1 banner block so the standalone preview keeps the same
// branded look it had before the refactor.
export async function buildKpidocPdfBuffer(input) {
  const {
    data = {},
    kpaProcess = null,
    branding = {},
    issuer = {},
    typography = {},
  } = input || {};

  const FONT = resolveFont(typography.fontFamily);
  const BODY = typography.bodyFontSize || 9;

  const A4_PORTRAIT_WIDTH  = 595;
  const portraitHeader = readBanner(branding.headerPath, { pageWidthMm: 210 });
  const portraitFooter = readBanner(branding.footerPath, { pageWidthMm: 210 });

  const PAGE_MARGIN_LR     = 28;
  const PAGE_MARGIN_TOP    = 28;
  const PAGE_MARGIN_BOTTOM = 50;

  const issuerName    = (issuer.name || '').trim();
  const employeeName  = kpaProcess?.employeeName  || data.employeeNameOverride || '';

  const body = buildKpidocContentBlocks(input);

  const content = [];

  // Page-1 header BANNER as inline content (not via pdfmake's header
  // callback). Negative L/R/top margins pull the banner past the
  // page-margin gutters so it sits flush with the page edges — like
  // a printed letterhead. Putting it in content (rather than the
  // per-page header callback) means landscape pages 2+ DON'T inherit
  // the banner-sized top margin that the callback approach forced
  // onto every page.
  if (portraitHeader) {
    const insetLR = branding.headerSideMargin ? PAGE_MARGIN_LR : 0;
    const bannerWidth = A4_PORTRAIT_WIDTH - (insetLR * 2);
    const outerLR = insetLR - PAGE_MARGIN_LR;
    content.push({
      image: portraitHeader.image,
      width: bannerWidth,
      margin: [outerLR, -PAGE_MARGIN_TOP, outerLR, 16],
    });
  }
  content.push(...body);

  function footer(currentPage, pageCount) {
    const insetLR = branding.footerSideMargin ? PAGE_MARGIN_LR : 0;
    const stack = [];
    if (currentPage === 1 && portraitFooter) {
      stack.push({
        image: portraitFooter.image,
        width: A4_PORTRAIT_WIDTH - (insetLR * 2),
        margin: [insetLR, 0, insetLR, 0],
      });
    }
    stack.push({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'center',
      fontSize: Math.max(7, BODY - 2),
      color: '#666',
      margin: [0, 4, 0, 0],
    });
    return stack;
  }

  const docDef = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [PAGE_MARGIN_LR, PAGE_MARGIN_TOP, PAGE_MARGIN_LR, PAGE_MARGIN_BOTTOM],
    defaultStyle: { font: FONT, fontSize: BODY },
    info: {
      title: `${employeeName ? employeeName + ' — ' : ''}KPI Document${issuerName ? ' · ' + issuerName : ''}`,
      author: issuerName || undefined,
    },
    footer,
    content,
  };

  return await pdfmake.createPdf(docDef).getBuffer();
}

function tableLayout() {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#666',
    vLineColor: () => '#666',
  };
}
