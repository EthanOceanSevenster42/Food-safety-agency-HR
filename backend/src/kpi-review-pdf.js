// Completed KPI Review document — a branded, signature-controlled PDF of a
// finished review. Portrait page 1 carries the company letterhead + title +
// overall score + rating legend; the wide review table (employee vs manager
// ratings, data, comments, and the agreed discussion note) sits on landscape
// pages, followed by a signing block. Styling mirrors the standalone KPI
// Document / combined-pack pipeline (same fonts + banner treatment).

import pdfmake from 'pdfmake';
import { resolveFont, readBanner } from './sow-pdf.js';

const RATING_LABELS = {
  5: 'Outstanding', 4: 'Exceeds Expectations', 3: 'Meets Expectations',
  2: 'Needs Improvement', 1: 'Unsatisfactory',
};
const ratingText = (r) => {
  const n = Number(r);
  return Number.isFinite(n) && RATING_LABELS[n] ? `${n} · ${RATING_LABELS[n]}` : '—';
};

// Group consecutive KPIs by KPA (area + weight), keeping each KPI's flat index.
function groupByKpa(kpis) {
  const groups = [];
  (Array.isArray(kpis) ? kpis : []).forEach((k, index) => {
    const area = k?.area || '';
    const weight = k?.weight || 0;
    const last = groups[groups.length - 1];
    if (last && last.area === area && last.weight === weight) last.items.push({ k, index });
    else groups.push({ area, weight, items: [{ k, index }] });
  });
  return groups;
}

function tableLayout() {
  return { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#888', vLineColor: () => '#888' };
}

export async function buildKpiReviewPdfBuffer(input) {
  const {
    employeeName = '', managerName = '', periodLabel = '', companyName = '',
    kpis = [], employeeRatings = [], managerRatings = [], sessionNotes = [],
    branding = {}, typography = {},
  } = input || {};

  const FONT = resolveFont(typography.fontFamily);
  const BODY = 9;
  const A4_PORTRAIT_WIDTH = 595;   // A4 portrait width in pt
  const A4_LANDSCAPE_WIDTH = 842;  // A4 landscape width in pt (the table pages)
  const PAGE_MARGIN_LR = 28, PAGE_MARGIN_TOP = 28;
  const portraitHeader = readBanner(branding.headerPath, { pageWidthMm: 210 });
  const footerBanner = readBanner(branding.footerPath, { pageWidthMm: 210 });

  // Reserve enough bottom margin for the footer banner on the WIDEST page
  // (landscape) so the footer never collides with the table on those pages.
  const footerInsetLR = branding.footerSideMargin ? PAGE_MARGIN_LR : 0;
  const footerAspect = footerBanner ? footerBanner._origHeight / footerBanner._origWidth : 0;
  const landscapeFooterH = footerBanner ? (A4_LANDSCAPE_WIDTH - footerInsetLR * 2) * footerAspect : 0;
  const PAGE_MARGIN_BOTTOM = footerBanner ? Math.max(50, Math.ceil(landscapeFooterH) + 20) : 40;

  const mgrScores = managerRatings.map((x) => Number(x?.rating)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
  const overall = mgrScores.length ? mgrScores.reduce((s, v) => s + v, 0) / mgrScores.length : null;
  const overallPct = overall != null ? Math.round((overall / 5) * 100) : null;

  // ---- review table cells ----
  const head = (t) => ({ text: t, bold: true, fontSize: 7, fillColor: '#eef1f5', margin: [3, 4, 3, 4] });
  const cell = (t, opts = {}) => ({ text: t == null ? '' : String(t), fontSize: BODY - 1, margin: [3, 3, 3, 3], ...opts });
  const sideCell = (r) => ({
    stack: [
      { text: ratingText(r?.rating), bold: true, fontSize: BODY - 1 },
      r?.data ? { text: [{ text: 'Data: ', bold: true }, { text: String(r.data) }], fontSize: BODY - 2, color: '#444', margin: [0, 2, 0, 0] } : null,
      r?.comment ? { text: [{ text: 'Comment: ', bold: true }, { text: String(r.comment), italics: true }], fontSize: BODY - 2, color: '#555', margin: [0, 2, 0, 0] } : null,
    ].filter(Boolean),
    margin: [3, 3, 3, 3],
  });

  const body = [[
    head('KPI'), head('Employee self-assessment'), head('Manager assessment'), head('Discussion note'),
  ]];
  for (const g of groupByKpa(kpis)) {
    body.push([{
      text: [{ text: g.area || 'KPA', bold: true }, { text: g.weight ? `      Weight: ${Math.round(g.weight)}%` : '', color: '#333' }],
      colSpan: 4, fillColor: '#dde6f1', fontSize: BODY - 1, margin: [5, 4, 5, 4],
    }, {}, {}, {}]);
    for (const { k, index } of g.items) {
      body.push([
        cell(k.kpiDescription),
        sideCell(employeeRatings[index]),
        sideCell(managerRatings[index]),
        cell(sessionNotes[index] || ''),
      ]);
    }
  }

  const reviewTable = {
    pageBreak: 'before',
    pageOrientation: 'landscape',
    table: { headerRows: 1, dontBreakRows: true, widths: ['*', '*', '*', '*'], body },
    layout: tableLayout(),
  };

  // ---- rating legend (page 1) ----
  const legend = {
    table: {
      widths: [130, '*'],
      body: [5, 4, 3, 2, 1].map((s) => [
        { text: String(s), bold: true, alignment: 'center', fontSize: BODY, margin: [4, 3, 4, 3], fillColor: s >= 4 ? '#eef6f0' : s <= 2 ? '#fdf0ee' : '#f7f7f7' },
        { text: RATING_LABELS[s], fontSize: BODY, margin: [6, 3, 4, 3] },
      ]),
    },
    layout: tableLayout(),
    margin: [0, 4, 0, 0],
  };

  // ---- signing block ----
  const SIG = { name: 200, sig: 220, date: 110 };
  const signingField = (label, len) => ({
    stack: [
      { text: ' ', fontSize: BODY, margin: [0, 18, 0, 0] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: len, y2: 0, lineWidth: 0.75, lineColor: '#000' }] },
      { text: label, fontSize: Math.max(7, BODY - 1), color: '#666', margin: [0, 4, 0, 0] },
    ],
    width: len,
  });
  const signingRow = (who) => ({
    stack: [
      { text: who, bold: true, fontSize: BODY, margin: [0, 0, 0, 4] },
      {
        columns: [
          signingField('Name', SIG.name), { text: '', width: 20 },
          signingField('Signature', SIG.sig), { text: '', width: 20 },
          signingField('Date', SIG.date), { text: '', width: '*' },
        ],
      },
    ],
    margin: [0, 0, 0, 24],
  });
  const signatureBlock = {
    table: {
      widths: ['*'], dontBreakRows: true,
      body: [[{
        stack: [
          { text: 'This KPI review has been discussed and agreed between the employee and their manager.', fontSize: BODY, margin: [0, 16, 0, 22] },
          signingRow('Employee'),
          signingRow('Manager'),
        ],
      }]],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    margin: [0, 16, 0, 0],
  };

  // ---- content ----
  const content = [];
  if (portraitHeader) {
    const insetLR = branding.headerSideMargin ? PAGE_MARGIN_LR : 0;
    content.push({
      image: portraitHeader.image,
      width: A4_PORTRAIT_WIDTH - insetLR * 2,
      margin: [insetLR - PAGE_MARGIN_LR, -PAGE_MARGIN_TOP, insetLR - PAGE_MARGIN_LR, 16],
    });
  }
  content.push({ text: 'KPI Performance Review', fontSize: 18, bold: true, alignment: 'center', margin: [0, 0, 0, 4] });
  content.push({
    text: [
      employeeName ? { text: employeeName, bold: true } : '',
      managerName ? `   ·   Manager: ${managerName}` : '',
      periodLabel ? `   ·   ${periodLabel}` : '',
    ],
    fontSize: 11, alignment: 'center', color: '#444', margin: [0, 0, 0, 14],
  });
  if (overallPct != null) {
    content.push({
      table: { widths: ['*'], body: [[{ text: `Overall score:  ${overall.toFixed(1)} / 5   (${overallPct}%)`, alignment: 'center', bold: true, fontSize: 13, color: '#088298', margin: [0, 8, 0, 8] }]] },
      layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => '#cfe3e7', vLineColor: () => '#cfe3e7' },
      margin: [0, 0, 0, 14],
    });
  }
  content.push({ text: 'Rating scale', bold: true, fontSize: 11, margin: [0, 4, 0, 4] });
  content.push(legend);
  content.push(reviewTable);
  content.push(signatureBlock);

  // ---- footer banner (every page, portrait AND landscape) + page numbers ----
  // pdfmake passes the current page's size, so we scale the banner to the
  // real page width and bottom-align it so it hugs the page edge regardless
  // of orientation.
  function footer(currentPage, pageCount, pageSize) {
    const pageW = pageSize?.width || A4_PORTRAIT_WIDTH;
    const stack = [];
    if (footerBanner) {
      const imgW = pageW - footerInsetLR * 2;
      const imgH = imgW * footerAspect;
      const topPush = Math.max(0, PAGE_MARGIN_BOTTOM - imgH - 12);
      stack.push({ image: footerBanner.image, width: imgW, margin: [footerInsetLR, topPush, footerInsetLR, 0] });
    }
    stack.push({ text: `${currentPage} / ${pageCount}`, alignment: 'center', fontSize: 7, color: '#666', margin: [0, 2, 0, 0] });
    return stack;
  }

  const docDef = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [PAGE_MARGIN_LR, PAGE_MARGIN_TOP, PAGE_MARGIN_LR, PAGE_MARGIN_BOTTOM],
    defaultStyle: { font: FONT, fontSize: BODY },
    info: { title: `KPI Review — ${employeeName}${periodLabel ? ' · ' + periodLabel : ''}${companyName ? ' · ' + companyName : ''}` },
    footer,
    content,
  };
  return await pdfmake.createPdf(docDef).getBuffer();
}
