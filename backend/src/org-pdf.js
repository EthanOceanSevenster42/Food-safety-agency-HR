// Organogram export — a single auto-sized PDF page that draws the company's
// reporting hierarchy as a top-down org chart. Each box shows the employee's
// name, department and contact email (as requested for the KPI-tracker export).
// Uses pdfkit for absolute-positioned boxes + elbow connectors so wide/deep
// trees fit on one page without overflow.
import PDFDocument from 'pdfkit';

const BRAND = '#088298';
const INK = '#1f2933';
const MUTED = '#6b7280';
const BOX_STROKE = '#d9dfe2';
const LINE = '#b9c2c7';

const BOX_W = 190;
const BOX_H = 66;
const GAP_X = 26;   // between sibling boxes
const GAP_Y = 56;   // between levels
const MARGIN = 40;
const HEADER_H = 58; // title block below the top margin

// Build the reporting forest from a flat employee list (by ManagerId).
function buildForest(employees) {
  const byId = new Map();
  employees.forEach((e) => byId.set(e.id, { ...e, children: [] }));
  const roots = [];
  byId.forEach((n) => {
    if (n.managerId && byId.has(n.managerId)) byId.get(n.managerId).children.push(n);
    else roots.push(n);
  });
  const sortRec = (n) => {
    n.children.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    n.children.forEach(sortRec);
  };
  roots.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  roots.forEach(sortRec);
  return roots;
}

// Tidy-tree layout: leaves take successive x slots; parents centre over their
// children. Returns { nodes, maxDepth, contentRight }.
function layout(roots) {
  let cursorX = 0;
  let maxDepth = 0;
  const nodes = [];
  const assign = (node, depth) => {
    node.depth = depth;
    if (depth > maxDepth) maxDepth = depth;
    if (node.children.length === 0) {
      node.x = cursorX;
      cursorX += BOX_W + GAP_X;
    } else {
      node.children.forEach((c) => assign(c, depth + 1));
      node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2;
    }
    nodes.push(node);
  };
  roots.forEach((r) => assign(r, 0));
  const contentRight = nodes.reduce((m, n) => Math.max(m, n.x + BOX_W), 0);
  return { nodes, maxDepth, contentRight };
}

export function buildOrgChartPdfBuffer({ companyName = 'Company', employees = [], generatedAt = null } = {}) {
  return new Promise((resolve, reject) => {
    const roots = buildForest(employees);
    const { nodes, maxDepth, contentRight } = layout(roots);

    const top = MARGIN + HEADER_H;
    const nodeY = (n) => top + n.depth * (BOX_H + GAP_Y);
    const contentBottom = nodes.length
      ? top + maxDepth * (BOX_H + GAP_Y) + BOX_H
      : top + 20;

    const pageW = Math.max(460, MARGIN + contentRight + MARGIN);
    const pageH = contentBottom + MARGIN;

    const doc = new PDFDocument({ size: [pageW, pageH], margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---- Title block ----
    doc.font('Helvetica-Bold').fontSize(18).fillColor(INK)
      .text(companyName, MARGIN, MARGIN, { width: pageW - MARGIN * 2, lineBreak: false, ellipsis: true });
    const when = generatedAt ? new Date(generatedAt) : null;
    const dateStr = when ? when.toISOString().slice(0, 10) : '';
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text(`Organisation chart${dateStr ? '  ·  ' + dateStr : ''}`, MARGIN, MARGIN + 24, { lineBreak: false });
    doc.moveTo(MARGIN, MARGIN + HEADER_H - 10).lineTo(pageW - MARGIN, MARGIN + HEADER_H - 10)
      .lineWidth(1).strokeColor(BOX_STROKE).stroke();

    if (nodes.length === 0) {
      doc.font('Helvetica').fontSize(12).fillColor(MUTED)
        .text('No employees on file for this company.', MARGIN, top, { lineBreak: false });
      doc.end();
      return;
    }

    // ---- Connectors (elbow), drawn under the boxes ----
    doc.lineWidth(1).strokeColor(LINE);
    for (const n of nodes) {
      if (n.children.length === 0) continue;
      const parentCX = MARGIN + n.x + BOX_W / 2;
      const parentBottom = nodeY(n) + BOX_H;
      const childTop = nodeY(n.children[0]);
      const midY = parentBottom + GAP_Y / 2;
      doc.moveTo(parentCX, parentBottom).lineTo(parentCX, midY).stroke();
      const firstCX = MARGIN + n.children[0].x + BOX_W / 2;
      const lastCX = MARGIN + n.children[n.children.length - 1].x + BOX_W / 2;
      doc.moveTo(firstCX, midY).lineTo(lastCX, midY).stroke();
      for (const c of n.children) {
        const cx = MARGIN + c.x + BOX_W / 2;
        doc.moveTo(cx, midY).lineTo(cx, childTop).stroke();
      }
    }

    // ---- Boxes ----
    for (const n of nodes) {
      const x = MARGIN + n.x;
      const y = nodeY(n);
      doc.roundedRect(x, y, BOX_W, BOX_H, 6).fillColor('#ffffff').fill();
      doc.roundedRect(x, y, BOX_W, BOX_H, 6).lineWidth(1).strokeColor(BOX_STROKE).stroke();
      // brand accent bar on the left
      doc.rect(x, y + 8, 3, BOX_H - 16).fillColor(BRAND).fill();

      const tx = x + 13;
      const tw = BOX_W - 24;
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK)
        .text(n.name || '(unnamed)', tx, y + 10, { width: tw, lineBreak: false, ellipsis: true });
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
        .text(n.department ? n.department : 'No department', tx, y + 27, { width: tw, lineBreak: false, ellipsis: true });
      if (n.email) {
        doc.font('Helvetica').fontSize(8.5).fillColor(BRAND)
          .text(n.email, tx, y + 43, { width: tw, lineBreak: false, ellipsis: true });
      } else {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#9aa5ac')
          .text('No email on file', tx, y + 43, { width: tw, lineBreak: false, ellipsis: true });
      }
    }

    doc.end();
  });
}
