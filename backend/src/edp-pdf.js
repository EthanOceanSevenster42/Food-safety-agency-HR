// EDP Alignment Notes — content-blocks builder. Exposes ONLY the
// reusable `buildEdpContentBlocks(input, options)` function for now;
// no standalone PDF builder is wired up because the editor doesn't
// currently render a per-task preview for EDPs. The Pack PDF builder
// imports this to splice the EDP section into the combined doc.

// Build the EDP's body content as an array of pdfmake nodes. NO banner,
// NO header/footer callbacks — those are owned by the Pack builder.
//
// `options.startOnNewPage` (default true) emits `pageBreak: 'before'` on
// the first block — since the EDP section comes AFTER the KPI Doc's
// landscape table, the Pack always wants this set so the EDP lands on
// a fresh portrait page. `options.startOrientation` (default 'portrait')
// is set alongside so pdfmake flips back to portrait.
export function buildEdpContentBlocks(input, options = {}) {
  const { data = {}, typography = {} } = input || {};
  const { startOnNewPage = true, startOrientation = 'portrait' } = options;

  const BODY = typography.bodyFontSize || 12;
  const H1   = typography.h1FontSize   || 18;
  const H2   = typography.h2FontSize   || 14;
  const h1Caps = !!typography.h1AllCaps;
  const h2Caps = !!typography.h2AllCaps;
  const applyAllCaps = (text, flag) => flag ? String(text || '').toUpperCase() : String(text || '');

  const blocks = [];

  const titleNode = {
    text: applyAllCaps('Quarterly Development Focus', h1Caps),
    fontSize: H1, bold: true,
    margin: [0, 0, 0, 8],
  };
  if (startOnNewPage) {
    titleNode.pageBreak = 'before';
    if (startOrientation) titleNode.pageOrientation = startOrientation;
  }
  blocks.push(titleNode);

  if (data.description && String(data.description).trim()) {
    blocks.push({
      text: String(data.description),
      fontSize: BODY,
      margin: [0, 0, 0, 12],
    });
  }

  const edps = Array.isArray(data.edps) ? data.edps : [];
  if (edps.length === 0) {
    blocks.push({
      text: 'No EDP entries have been recorded yet.',
      italics: true,
      color: '#999',
      fontSize: BODY,
      margin: [0, 4, 0, 4],
    });
    return blocks;
  }

  for (let i = 0; i < edps.length; i++) {
    const edp = edps[i];
    blocks.push({
      text: applyAllCaps(`EDP ${i + 1}${edp?.header ? ' — ' + edp.header : ''}`, h2Caps),
      bold: true, fontSize: H2,
      margin: [0, 12, 0, 4],
    });

    // Promote legacy wig+leadMeasures shape into the new wigs[] array
    // so old EDP records keep rendering after the schema migration.
    const wigs = Array.isArray(edp?.wigs) && edp.wigs.length
      ? edp.wigs
      : [{ text: edp?.wig || '', leadMeasures: Array.isArray(edp?.leadMeasures) ? edp.leadMeasures : [] }];

    for (let w = 0; w < wigs.length; w++) {
      const wig = wigs[w];
      blocks.push({
        text: `WIG ${w + 1}`,
        bold: true, fontSize: BODY, color: '#333',
        margin: [12, 4, 0, 2],
      });
      if (wig?.text && String(wig.text).trim()) {
        blocks.push({ text: String(wig.text), fontSize: BODY, margin: [24, 0, 0, 4] });
      } else {
        blocks.push({ text: '—', fontSize: BODY, color: '#999', margin: [24, 0, 0, 4] });
      }
      const measures = Array.isArray(wig?.leadMeasures)
        ? wig.leadMeasures.map((m) => String(m || '').trim()).filter(Boolean)
        : [];
      if (measures.length) {
        blocks.push({
          text: 'Lead Measures',
          fontSize: Math.max(7, BODY - 1),
          color: '#666',
          margin: [24, 6, 0, 2],
        });
        blocks.push({ ul: measures, fontSize: BODY, margin: [36, 0, 0, 4] });
      }
    }
  }

  return blocks;
}
