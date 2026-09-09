// Builds the Statement of Work as a PDF using pdfmake. Replaces the docx
// generator — PDFs are byte-identical across machines and render natively in
// every browser, so the in-app preview = the downloaded artefact.

import pdfmake from 'pdfmake';
import pdfmakeRenderer from 'pdfmake/js/Renderer.js';
import pdfmakeLayoutBuilder from 'pdfmake/js/LayoutBuilder.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageSize } from 'image-size';
import { UPLOAD_DIR } from './upload.js';

// Shared state used by the two monkey-patches below + the footer callback.
// `pageOffset` is the number of cover + TOC pages the document carries before
// the body starts. The body's first heading lives at `pageOffset + 1` in
// pdfmake's raw page numbering; we subtract `pageOffset` everywhere we print a
// page number so the printed numbers start at 1 on the first body page and
// the TOC entries agree with what the reader sees in the footer.
//
// The offset is computed *during layout* (by inspecting positions after the
// main content is processed but before the footer callback runs) so multi-
// page TOCs work without hard-coding "cover + 1 TOC page = 2".
const _sowState = { pageOffset: 0, active: false };

// --- Patch 1: dynamically compute the body offset just before headers/footers
// are added. By the time `addHeadersAndFooters` is called, the main content
// has been laid out and every node's `positions` array is populated.
const LayoutBuilderClass = pdfmakeLayoutBuilder.default || pdfmakeLayoutBuilder;
const _originalAddHeadersAndFooters = LayoutBuilderClass.prototype.addHeadersAndFooters;
LayoutBuilderClass.prototype.addHeadersAndFooters = function patchedAddHeadersAndFooters(header, footer) {
  if (_sowState.active) {
    // Walk every line item on every page and look at the page-reference
    // targets. Each `_pageNodeRef.positions[0].pageNumber` is the pdfmake
    // page of the heading the TOC entry points at — the minimum across all
    // of them is the first body section's page.
    const pages = this.writer.context().pages;
    let minPage = Infinity;
    for (const page of pages) {
      for (const item of page.items) {
        if (item.type !== 'line' || !item.item) continue;
        const line = item.item;
        const refs = [];
        if (line._pageNodeRef) refs.push(line._pageNodeRef);
        if (Array.isArray(line.inlines)) {
          for (const inl of line.inlines) {
            if (inl && inl._pageNodeRef) refs.push(inl._pageNodeRef);
          }
        }
        for (const ref of refs) {
          const pos = ref && Array.isArray(ref.positions) ? ref.positions[0] : null;
          if (pos && pos.pageNumber < minPage) minPage = pos.pageNumber;
        }
      }
    }
    if (minPage !== Infinity) {
      _sowState.pageOffset = Math.max(0, minPage - 1);
    }
  }
  return _originalAddHeadersAndFooters.call(this, header, footer);
};

// --- Patch 2: while rendering, subtract the discovered offset from each
// `_pageNodeRef.positions[0].pageNumber` so the resolved TOC numbers match
// what the footer prints. The `__sowOffsetApplied` flag prevents us from
// double-subtracting if the same ref is shared across multiple lines.
const RendererClass = pdfmakeRenderer.default || pdfmakeRenderer;
const _originalRenderLine = RendererClass.prototype.renderLine;
RendererClass.prototype.renderLine = function patchedRenderLine(line, x, y) {
  if (_sowState.active && _sowState.pageOffset > 0) {
    const refs = [];
    if (line && line._pageNodeRef) refs.push(line._pageNodeRef);
    if (line && Array.isArray(line.inlines)) {
      for (const inl of line.inlines) {
        if (inl && inl._pageNodeRef) refs.push(inl._pageNodeRef);
      }
    }
    for (const ref of refs) {
      const pos = ref && Array.isArray(ref.positions) ? ref.positions[0] : null;
      if (pos && !ref.__sowOffsetApplied) {
        pos.pageNumber = Math.max(1, pos.pageNumber - _sowState.pageOffset);
        ref.__sowOffsetApplied = true;
      }
    }
  }
  return _originalRenderLine.call(this, line, x, y);
};

// pdfmake (v0.3+) exposes a singleton — configure fonts + local access policy
// once at module load. The Standard 14 fonts (Helvetica/Times/Courier) are
// guaranteed to render in every viewer without shipping font files. We add
// real TTF fonts on-demand below when the company branding asks for one we
// can find on disk.
pdfmake.setFonts({
  Helvetica: {
    normal:      'Helvetica',
    bold:        'Helvetica-Bold',
    italics:     'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
  Times: {
    normal:      'Times-Roman',
    bold:        'Times-Bold',
    italics:     'Times-Italic',
    bolditalics: 'Times-BoldItalic',
  },
  Courier: {
    normal:      'Courier',
    bold:        'Courier-Bold',
    italics:     'Courier-Oblique',
    bolditalics: 'Courier-BoldOblique',
  },
});
// Standard 14 fonts are resolved internally by pdfkit, but the local access
// guard still trips before that — opt in to local access so the strings (and
// any TTF font paths we register below) pass.
pdfmake.setLocalAccessPolicy(() => true);
// We don't fetch any remote resources, so block URL access entirely.
pdfmake.setUrlAccessPolicy(() => false);

// Common Windows TTF filenames for the brand fonts we might encounter. We
// look these up under `%WINDIR%\Fonts` (the default install location on every
// Windows host) and register them with pdfmake when present so the generated
// PDF uses the actual branded face instead of a Standard-14 fallback.
const FONT_FILE_MAP = {
  arial:           { normal: 'arial.ttf',     bold: 'arialbd.ttf',  italics: 'ariali.ttf',  bolditalics: 'arialbi.ttf'  },
  calibri:         { normal: 'calibri.ttf',   bold: 'calibrib.ttf', italics: 'calibrii.ttf', bolditalics: 'calibriz.ttf' },
  verdana:         { normal: 'verdana.ttf',   bold: 'verdanab.ttf', italics: 'verdanai.ttf', bolditalics: 'verdanaz.ttf' },
  tahoma:          { normal: 'tahoma.ttf',    bold: 'tahomabd.ttf', italics: 'tahoma.ttf',   bolditalics: 'tahomabd.ttf' },
  georgia:         { normal: 'georgia.ttf',   bold: 'georgiab.ttf', italics: 'georgiai.ttf', bolditalics: 'georgiaz.ttf' },
  'times new roman': { normal: 'times.ttf',   bold: 'timesbd.ttf',  italics: 'timesi.ttf',   bolditalics: 'timesbi.ttf'  },
  trebuchet:       { normal: 'trebuc.ttf',    bold: 'trebucbd.ttf', italics: 'trebucit.ttf', bolditalics: 'trebucbi.ttf' },
  'segoe ui':      { normal: 'segoeui.ttf',   bold: 'segoeuib.ttf', italics: 'segoeuii.ttf', bolditalics: 'segoeuiz.ttf' },
  'open sans':     { normal: 'OpenSans-Regular.ttf', bold: 'OpenSans-Bold.ttf', italics: 'OpenSans-Italic.ttf', bolditalics: 'OpenSans-BoldItalic.ttf' },
  // Google Fonts that aren't pre-installed on Windows — placed here so they
  // resolve when the user drops the TTF files into `backend/fonts/`. The
  // filenames match Google Fonts' default ZIP layout.
  poppins:         { normal: 'Poppins-Regular.ttf',  bold: 'Poppins-Bold.ttf',  italics: 'Poppins-Italic.ttf',  bolditalics: 'Poppins-BoldItalic.ttf'  },
  montserrat:      { normal: 'Montserrat-Regular.ttf', bold: 'Montserrat-Bold.ttf', italics: 'Montserrat-Italic.ttf', bolditalics: 'Montserrat-BoldItalic.ttf' },
  inter:           { normal: 'Inter-Regular.ttf',    bold: 'Inter-Bold.ttf',    italics: 'Inter-Italic.ttf',    bolditalics: 'Inter-BoldItalic.ttf'    },
  roboto:          { normal: 'Roboto-Regular.ttf',   bold: 'Roboto-Bold.ttf',   italics: 'Roboto-Italic.ttf',   bolditalics: 'Roboto-BoldItalic.ttf'   },
  lato:            { normal: 'Lato-Regular.ttf',     bold: 'Lato-Bold.ttf',     italics: 'Lato-Italic.ttf',     bolditalics: 'Lato-BoldItalic.ttf'     },
};

// Local font bundle — checked BEFORE the system Fonts directory so the app
// can ship branded fonts (Poppins, Montserrat, …) that aren't installed on
// every Windows host. Drop TTF files matching the filenames in FONT_FILE_MAP
// here and they'll be picked up the next time the backend starts.
const LOCAL_FONT_DIR = path.resolve('fonts');

// Memoise so we only attempt to load each font once per process.
const registeredFonts = new Set();

function fontsDir() {
  // %WINDIR%\Fonts on Windows; harmless string on other platforms (the file
  // check below will simply return false and we fall back to Helvetica).
  return path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
}

// Try to register a real TTF face for the requested family with pdfmake.
// Returns the registered font key on success, or null if the files can't be
// located (caller should fall back to a Standard-14 font).
//
// Search order for each variant:
//   1. `backend/fonts/<filename>`   — bundled fonts (Poppins, Montserrat, …)
//   2. `%WINDIR%\Fonts\<filename>`  — Windows system fonts (Arial, Calibri, …)
// All four variants must be locatable for the font to register — partial
// matches fall back to Helvetica so we don't emit a half-styled PDF.
function tryRegisterSystemFont(family) {
  if (!family) return null;
  const key = String(family).trim();
  const lookup = FONT_FILE_MAP[key.toLowerCase()];
  if (!lookup) return null;
  if (registeredFonts.has(key)) return key;

  const sysDir = fontsDir();
  const resolved = {};
  for (const [variant, filename] of Object.entries(lookup)) {
    const local = path.join(LOCAL_FONT_DIR, filename);
    const sys   = path.join(sysDir,         filename);
    if (fs.existsSync(local))      resolved[variant] = local;
    else if (fs.existsSync(sys))   resolved[variant] = sys;
    else return null;
  }
  pdfmake.addFonts({ [key]: resolved });
  registeredFonts.add(key);
  return key;
}

// Resolve the company-chosen font family to a font key pdfmake can actually
// render. First try to register the real TTF (matching the brand exactly);
// fall back to the nearest Standard-14 face if the font files aren't on disk.
export function resolveFont(family) {
  const real = tryRegisterSystemFont(family);
  if (real) return real;

  const f = (family || '').toLowerCase();
  if (f.includes('times') || f.includes('serif') || f.includes('georgia')) return 'Times';
  if (f.includes('courier') || f.includes('mono')) return 'Courier';
  return 'Helvetica';
}

// ---------- Signature-party normalisation ----------
// The Signature Control section supports an editable list of rows so SOWs can
// add or remove fields beyond the original five (Name & Surname, Post
// Designation, Signature, Date, Location). The default set is used both as a
// seed for brand-new SOWs and as the fallback shape when migrating from the
// older flat `clientName / clientDesignation / …` layout.
export const DEFAULT_SIG_ROWS = [
  { label: 'Name & Surname' },
  { label: 'Post Designation' },
  { label: 'Signature' },
  { label: 'Date' },
  { label: 'Location' },
];

const LEGACY_SIG_FIELD_MAP = {
  client: {
    'Name & Surname':   'clientName',
    'Post Designation': 'clientDesignation',
    'Signature':        null,
    'Date':             'clientDate',
    'Location':         'clientLocation',
  },
  provider: {
    'Name & Surname':   'providerName',
    'Post Designation': 'providerDesignation',
    'Signature':        null,
    'Date':             'providerDate',
    'Location':         'providerLocation',
  },
};

// Coerce a row into the canonical `{ label, value, signatureFile, bold }`
// shape. Strings without these fields are kept (with empty value) so the
// signatures payload from the frontend stays forgiving.
function normaliseSigRow(raw) {
  if (raw == null) return { label: '', value: '', signatureFile: null, bold: false };
  if (typeof raw === 'string') return { label: raw, value: '', signatureFile: null, bold: false };
  return {
    label:         typeof raw.label === 'string' ? raw.label : '',
    value:         typeof raw.value === 'string' ? raw.value : '',
    signatureFile: typeof raw.signatureFile === 'string' && raw.signatureFile ? raw.signatureFile : null,
    bold:          !!raw.bold,
  };
}

// Resolve the rows for one signing party (`client` or `provider`). The new
// payload shape is `signatures.client = { company, rows: [...] }`; we also
// accept the older flat fields (clientName, clientDesignation, …) and migrate
// them onto the default row list.
function resolveSigParty(signatures, key, fallbackCompany) {
  const sig = signatures || {};
  const party = sig[key];
  if (party && typeof party === 'object' && Array.isArray(party.rows)) {
    return {
      company: typeof party.company === 'string' && party.company ? party.company : fallbackCompany,
      rows: party.rows.map(normaliseSigRow),
    };
  }
  // Legacy flat-field fallback
  const legacyMap = LEGACY_SIG_FIELD_MAP[key] || {};
  const rows = DEFAULT_SIG_ROWS.map(({ label }) => {
    const flatField = legacyMap[label];
    const value = flatField ? (sig[flatField] || '') : '';
    return { label, value, signatureFile: null, bold: false };
  });
  const company = key === 'client'
    ? (sig.clientCompany || fallbackCompany || '')
    : (sig.providerCompany || fallbackCompany || '');
  return { company, rows };
}

// Resolve the full ordered list of signature parties for rendering. The new
// shape is `signatures.parties = [{ id, kind, title, company, rows[] }, ...]`.
// Three older shapes are migrated on the fly:
//   1) `signatures.parties` already present → just hydrate rows
//   2) `signatures.client` + `signatures.provider` (object-keyed) → build list
//   3) flat fields (clientName / providerDesignation / …)        → build list
// `clientName` and `providerName` are passed in so client- and provider-kind
// parties can pick up their auto-derived company even when the saved payload
// has the field blank.
function resolveSigParties(signatures, { clientName = '', providerName = '' } = {}) {
  const sig = signatures || {};
  const hydrate = (raw, defaults = {}) => ({
    kind:    raw?.kind === 'client' || raw?.kind === 'provider' || raw?.kind === 'custom'
              ? raw.kind
              : (defaults.kind || 'custom'),
    title:   typeof raw?.title   === 'string' && raw.title   ? raw.title   : (defaults.title   || ''),
    company: typeof raw?.company === 'string' ? raw.company : (defaults.company || ''),
    rows: Array.isArray(raw?.rows) ? raw.rows.map(normaliseSigRow) : [],
  });

  if (Array.isArray(sig.parties)) {
    return sig.parties.map((p) => hydrate(p));
  }

  if (sig.client || sig.provider) {
    return [
      hydrate(sig.client,   { kind: 'client',   title: 'Client',           company: sig.clientCompany   || clientName }),
      hydrate(sig.provider, { kind: 'provider', title: 'Service Provider', company: sig.providerCompany || providerName }),
    ];
  }

  // Oldest flat-field shape — fall back to the per-key resolver to keep the
  // legacy row-by-row mapping intact.
  return [
    { kind: 'client',   title: 'Client',           ...resolveSigParty(sig, 'client',   clientName) },
    { kind: 'provider', title: 'Service Provider', ...resolveSigParty(sig, 'provider', providerName) },
  ];
}

// ---------- Section normalisation (identical contract to sow.js) ----------
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
  // Preserve section-level tables (H3-titled grids that live alongside the
  // section body, before any sub-sections). Each entry carries an optional
  // heading + description plus the grid itself. Anything else on the raw
  // object is intentionally dropped — only the fields the renderer needs
  // are passed through.
  const normaliseSecTable = (t) => ({
    heading:     typeof t?.heading     === 'string' ? t.heading     : '',
    description: typeof t?.description === 'string' ? t.description : '',
    grid: Array.isArray(t?.grid)
      ? t.grid.map((r) => Array.isArray(r) ? r.map((v) => String(v ?? '')) : [])
      : [],
  });

  if (Array.isArray(input)) {
    return input.map((s, i) => ({
      title: (typeof s?.title === 'string' && s.title.trim()) || (SECTION_KEYS[i]?.title || `Section ${i + 1}`),
      body: typeof s === 'string' ? s : (typeof s?.body === 'string' ? s.body : ''),
      subsections: Array.isArray(s?.subsections) ? s.subsections.map(normaliseSub) : [],
      tables:      Array.isArray(s?.tables)      ? s.tables.map(normaliseSecTable) : [],
    }));
  }
  if (input && typeof input === 'object') {
    return SECTION_KEYS.map((sk) => {
      const raw = input[sk.key];
      const body = typeof raw === 'string' ? raw : (typeof raw?.body === 'string' ? raw.body : '');
      const subsections = Array.isArray(raw?.subsections) ? raw.subsections.map(normaliseSub) : [];
      const tables      = Array.isArray(raw?.tables)      ? raw.tables.map(normaliseSecTable) : [];
      return { title: sk.title, body, subsections, tables };
    });
  }
  return SECTION_KEYS.map((sk) => ({ title: sk.title, body: '', subsections: [], tables: [] }));
}

// ---------- HTML → pdfmake content ----------
// The frontend's rich-text editor emits HTML using a constrained subset:
//   <b>/<strong>, <i>/<em>, <u>, <br>, <p>, <ul>, <ol>, <li>
// We do our own conversion (rather than use html-to-pdfmake) so we can apply
// the exact same justification + spacing rules as the previous docx output.

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Walk inline HTML and emit an array of pdfmake "text" items with formatting.
function inlineSpans(html, { bold = false, italic = false, underline = false } = {}) {
  const out = [];
  let i = 0;
  let buffer = '';
  const flush = () => {
    if (buffer) {
      // pdfmake's TextBreaker treats `\n` as a *required* line break, but the
      // HTML coming out of the rich-text editor is pretty-printed with stray
      // newlines that aren't meant to be hard breaks. Collapse every run of
      // whitespace (including \n / \t / \r) to a single space so paragraphs
      // flow as one continuous line.
      const text = decodeEntities(buffer).replace(/\s+/g, ' ');
      const item = { text };
      if (bold) item.bold = true;
      if (italic) item.italics = true;
      if (underline) item.decoration = 'underline';
      out.push(item);
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
        // <br> treated as soft space — see comment in sow.js for the reasoning.
        if (buffer && !/\s$/.test(buffer)) buffer += ' ';
      } else if (['b', 'strong', 'i', 'em', 'u'].includes(tagName) && !selfClose && !isClose) {
        flush();
        const closeTag = `</${tagName}>`;
        const closeIdx = html.toLowerCase().indexOf(closeTag, close + 1);
        const inner = closeIdx === -1 ? html.slice(close + 1) : html.slice(close + 1, closeIdx);
        const nested = inlineSpans(inner, {
          bold: bold || tagName === 'b' || tagName === 'strong',
          italic: italic || tagName === 'i' || tagName === 'em',
          underline: underline || tagName === 'u',
        });
        for (const n of nested) out.push(n);
        i = closeIdx === -1 ? html.length : closeIdx + closeTag.length;
        continue;
      }
      i = close + 1;
      continue;
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

// Convert a block of editor HTML to an array of pdfmake blocks (paragraphs +
// lists). `style` lets the caller scope the body font size etc.
export function htmlToBlocks(html, { style = 'body' } = {}) {
  if (!html || typeof html !== 'string') return [];
  const blocks = [];
  const remaining = html.replace(/\r\n/g, '\n').trim();
  if (!remaining) return [];

  let cursor = 0;
  const lower = remaining.toLowerCase();

  function pushPlainBlock(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const stripped = trimmed.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, '').trim();
    if (!stripped) return;
    blocks.push({
      text: inlineSpans(trimmed),
      style,
      alignment: 'justify',
      // Tightened inter-paragraph gap (was 6pt).
      margin: [0, 0, 0, 3],
    });
  }

  while (cursor < remaining.length) {
    // Recognise `<li` at the top level too — Chrome's contentEditable
    // normally wraps list items in `<ul>` / `<ol>` but pasted content
    // (Word, Outlook, Google Docs) can drop the wrapper. Without this an
    // orphan `<li>` would fall through to `pushPlainBlock` and the whole
    // list would render as one run-together paragraph.
    const m = lower.slice(cursor).search(/<(p|ul|ol|li)\b/);
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
      // Browsers' `execCommand('insertUnorderedList')` happily emits
      // malformed nesting like `<p><ul><li>…</li></ul></p>` when the line
      // it converts is already inside a `<p>`. If we treat that as a
      // plain inline paragraph the `<ul>/<li>` tags get stripped and the
      // items run together. Detect block tags inside the `<p>` and parse
      // the inner recursively so the list (or table-ish markup) is
      // promoted to its own block.
      if (/<(?:ul|ol|li)\b/i.test(inner)) {
        const innerBlocks = htmlToBlocks(inner, { style });
        for (const b of innerBlocks) blocks.push(b);
      } else {
        const stripped = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, '').trim();
        if (stripped) {
          blocks.push({
            text: inlineSpans(inner),
            style,
            alignment: 'justify',
            // Tightened inter-paragraph gap (was 6pt).
            margin: [0, 0, 0, 3],
          });
        }
      }
      cursor = closeIdx === -1 ? remaining.length : closeIdx + 4;
    } else if (tag === 'ul' || tag === 'ol') {
      const closeTag = `</${tag}>`;
      const closeIdx = lower.indexOf(closeTag, tagOpenClose);
      const inner = closeIdx === -1
        ? remaining.slice(tagOpenClose + 1)
        : remaining.slice(tagOpenClose + 1, closeIdx);
      const items = [];
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(inner)) !== null) {
        // Bottom margin on each list item adds breathing room between
        // bullets; without it pdfmake stacks items tight against each
        // other and the list reads as a wall of text.
        items.push({ text: inlineSpans(liMatch[1]), style, margin: [0, 0, 0, 4] });
      }
      // Honour the `type` attribute on <ol> — the editor's "a. List" /
      // "A. List" buttons emit `<ol type="a">` / `<ol type="A">`. HTML
      // accepts single-letter type values (a/A/i/I/1) but pdfmake expects
      // the long form (`lower-alpha`, `upper-alpha`, `lower-roman`,
      // `upper-roman`), so translate.
      const block = { [tag]: items, margin: [0, 0, 0, 4] };
      if (tag === 'ol') {
        const typeMatch = tagOpen.match(/\btype\s*=\s*['"]?([aAiI1])['"]?/);
        if (typeMatch) {
          const m = {
            a: 'lower-alpha',
            A: 'upper-alpha',
            i: 'lower-roman',
            I: 'upper-roman',
          };
          if (m[typeMatch[1]]) block.type = m[typeMatch[1]];
        }
      }
      blocks.push(block);
      cursor = closeIdx === -1 ? remaining.length : closeIdx + closeTag.length;
    } else if (tag === 'li') {
      // Orphan `<li>` (or several consecutive ones) — collect them all
      // into one virtual unordered list. The loop walks `<li>` boundaries
      // (whitespace between items is ignored) and stops as soon as it
      // hits anything else.
      const items = [];
      let p = blockStart;
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      liRegex.lastIndex = p;
      let lm;
      while ((lm = liRegex.exec(remaining)) !== null) {
        // Allow only whitespace between this match and the previous
        // boundary — anything else means we've left the list.
        if (remaining.slice(p, lm.index).trim() !== '') break;
        items.push({ text: inlineSpans(lm[1]), style, margin: [0, 0, 0, 4] });
        p = lm.index + lm[0].length;
        liRegex.lastIndex = p;
      }
      if (items.length > 0) {
        blocks.push({ ul: items, margin: [0, 0, 0, 4] });
        cursor = p;
      } else {
        // Couldn't parse an item — skip the malformed `<li…>` open tag
        // and keep going so the rest of the document still renders.
        cursor = tagOpenClose + 1;
      }
    } else {
      cursor = tagOpenClose + 1;
    }
  }

  return blocks;
}

// ---------- Banner image helpers ----------
// Read a banner image from disk and return a pdfmake image node sized to the
// full page width. Returns null if the file can't be read.
export function readBanner(filePath, { pageWidthMm }) {
  if (!filePath) return null;
  try {
    const buf = fs.readFileSync(filePath);
    const dims = imageSize(buf);
    if (!dims?.width || !dims?.height) return null;
    // pdfmake image src accepts a data URL. Detect the type from the file.
    const ext = (dims.type || path.extname(filePath).replace('.', '') || 'png').toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'gif' ? 'image/gif'
      : 'image/png';
    const data = `data:${mime};base64,${buf.toString('base64')}`;
    // Convert mm to pdfmake "points" (1 pt = 1/72 inch; 1 inch = 25.4 mm)
    const widthPt = (pageWidthMm / 25.4) * 72;
    return {
      image: data,
      width: widthPt,
      _origWidth: dims.width,
      _origHeight: dims.height,
    };
  } catch (err) {
    console.error('[sow-pdf] could not read banner:', filePath, err.message);
    return null;
  }
}

// ---------- Tables ----------
function tableFromGrid(grid, { bodyStyle }) {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  const colCount = grid.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
  if (colCount === 0) return null;
  const widths = new Array(colCount).fill('*');
  const body = grid.map((row, i) => {
    const cells = [];
    for (let c = 0; c < colCount; c++) {
      const text = Array.isArray(row) ? String(row[c] ?? '') : '';
      if (i === 0) {
        cells.push({ text, bold: true, alignment: 'center', style: bodyStyle, margin: [2, 4, 2, 4] });
      } else {
        cells.push({ text, style: bodyStyle, margin: [2, 4, 2, 4] });
      }
    }
    return cells;
  });
  return {
    table: {
      widths,
      headerRows: 1,
      // keepWithHeaderRows tells pdfmake to keep the header row glued to
      // at least N body rows. Without it, a table whose first body row
      // doesn't fit at the bottom of the page renders just the header on
      // the current page and the rows on the next page — an orphan-header
      // bug the SOW author has no other way to avoid. With this, if the
      // header + 2 rows can't all fit, the whole table starts on the
      // next page instead.
      keepWithHeaderRows: 2,
      body,
    },
    layout: {
      hLineWidth: () => 0.75,
      vLineWidth: () => 0.75,
      hLineColor: () => '#000000',
      vLineColor: () => '#000000',
    },
  };
}

// ---------- Appendices: unified normaliser ----------
// The editor now stores every appendix in a single `tables.appendices` array.
// Each entry is either a `milestones` appendix (Project Milestone Table +
// optional Gantt, always landscape) or a `custom` appendix (a list of H2
// blocks — either rich-text or a table with optional description). Three
// older shapes are migrated on the fly so SOWs/templates saved before this
// refactor keep rendering:
//   1) `tables.appendices` already in the new form → pass through
//   2) `tables.appendixA` (milestones) + `tables.extraAppendices` (customs)
//   3) `tables.appendixA` + the older single-grid `monthlyServiceAllocation`

const DEFAULT_TARIFF_FALLBACK = 750;

function normaliseMilestonesProjects(raw) {
  if (!raw || !Array.isArray(raw.projects)) {
    return { defaultTariff: DEFAULT_TARIFF_FALLBACK, projects: [] };
  }
  return {
    defaultTariff: Number.isFinite(Number(raw.defaultTariff)) ? Number(raw.defaultTariff) : DEFAULT_TARIFF_FALLBACK,
    projects: raw.projects.map((p, idx) => ({
      name:          typeof p?.name === 'string' ? p.name : '',
      phase:         finiteOrNull(p?.phase),
      // Project numbers are always derived from list position so the locked
      // editor input + the PDF stay in lock-step on reorder.
      projectNumber: idx + 1,
      milestones: Array.isArray(p?.milestones) ? p.milestones.map((m) => ({
        description: typeof m?.description === 'string' ? m.description : '',
        week:        Number.isFinite(Number(m?.week))  ? Number(m.week)  : 1,
        hours:       Number.isFinite(Number(m?.hours)) ? Number(m.hours) : 0,
        tariff:      finiteOrNull(m?.tariff),
      })) : [],
    })),
  };
}

function normaliseAppendicesForRender(tables) {
  const t = tables && typeof tables === 'object' ? tables : {};

  // Already in the new shape — just hydrate type-specific defaults.
  if (Array.isArray(t.appendices)) {
    return t.appendices.map((raw) => hydrateAppendix(raw));
  }

  const out = [];
  if (t.appendixA && typeof t.appendixA === 'object') {
    out.push(hydrateAppendix({
      title: 'Detailed Milestone Breakdown, Cost & Timeline Allocation',
      type: 'milestones',
      orientation: 'landscape',
      defaultTariff: t.appendixA.defaultTariff,
      projects:      t.appendixA.projects,
      includeGantt:  t.appendixA.includeGantt,
    }));
  }
  if (Array.isArray(t.extraAppendices)) {
    for (const a of t.extraAppendices) out.push(hydrateAppendix({ ...a, type: 'custom' }));
  } else if (Array.isArray(t.monthlyServiceAllocation) && t.monthlyServiceAllocation.length > 0) {
    out.push(hydrateAppendix({
      title: 'SLA Monthly Fee and Service Allocation',
      type: 'custom',
      orientation: 'portrait',
      blocks: [{
        type: 'table',
        heading: 'SLA Monthly Fee and Service Allocation Summary',
        grid: t.monthlyServiceAllocation,
      }],
    }));
  }
  return out;
}

function hydrateAppendix(raw) {
  const type = raw?.type === 'milestones' ? 'milestones' : 'custom';
  const base = {
    title: typeof raw?.title === 'string' ? raw.title : '',
    type,
    orientation: type === 'milestones'
      ? 'landscape'
      : (raw?.orientation === 'landscape' ? 'landscape' : 'portrait'),
  };
  if (type === 'milestones') {
    return {
      ...base,
      ...normaliseMilestonesProjects(raw),
      includeGantt: raw?.includeGantt !== false,
      blocks: [],
    };
  }
  return {
    ...base,
    blocks: Array.isArray(raw?.blocks) ? raw.blocks.map(hydrateAppendixBlock) : [],
  };
}

function hydrateAppendixBlock(raw) {
  if (raw?.type === 'text') {
    return {
      type:    'text',
      heading: typeof raw?.heading === 'string' ? raw.heading : '',
      body:    typeof raw?.body    === 'string' ? raw.body    : '',
    };
  }
  return {
    type:        'table',
    heading:     typeof raw?.heading     === 'string' ? raw.heading     : '',
    description: typeof raw?.description === 'string' ? raw.description : '',
    grid: Array.isArray(raw?.grid)
      ? raw.grid.map((row) => Array.isArray(row) ? row.map((v) => String(v ?? '')) : [])
      : [],
  };
}

function finiteOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function milestoneCodeFor(project, milestoneIndex) {
  const pr = `P${project.projectNumber || 1}`;
  const w  = `W${milestoneIndex + 1}`;
  if (project.phase) return `PH${project.phase}-${pr}-${w}`;
  return `${pr}-${w}`;
}

function effectiveTariff(milestone, defaultTariff) {
  return milestone.tariff != null ? Number(milestone.tariff) : Number(defaultTariff || 0);
}
function formatRand(amount) {
  const n = Number(amount || 0);
  return 'R' + n.toFixed(2);
}

// 7-column milestone breakdown table matching the SOW reference layout.
// `bodySize` is the resolved company body font size (BODY inside
// generateSowPdf); header and cell sizes are derived from it.
function buildMilestoneTable(appA, bodySize) {
  const total = appA.projects.reduce(
    (sum, p) => sum + p.milestones.reduce((s, m) => s + Number(m.hours || 0) * effectiveTariff(m, appA.defaultTariff), 0),
    0,
  );
  const hasAnyRow = appA.projects.some((p) => p.milestones.length > 0);
  if (!hasAnyRow) return null;

  const header = [
    cellHead('Projects',              bodySize),
    cellHead('Milestone Code',        bodySize),
    cellHead('Milestone Description', bodySize),
    cellHead('Week Allocation',       bodySize),
    cellHead('Total Hour Allocation', bodySize),
    cellHead('Tariff',                bodySize),
    cellHead('Sub-Total',             bodySize),
  ];

  // The milestone-code column uses an even smaller font (body − 4) since
  // "PH1-P1-W1" needs to read as a compact tag, not body copy.
  const codeFontSize = Math.max(7, bodySize - 4);

  const rows = [header];
  for (const project of appA.projects) {
    project.milestones.forEach((m, i) => {
      const tariff = effectiveTariff(m, appA.defaultTariff);
      const sub    = Number(m.hours || 0) * tariff;
      rows.push([
        cellBody(project.name || '—',                         bodySize),
        cellBody(milestoneCodeFor(project, i),                bodySize, { alignment: 'center', bold: true, fontSize: codeFontSize }),
        cellBody(m.description || '',                         bodySize),
        cellBody(`Week ${m.week || 1}`,                       bodySize, { alignment: 'center' }),
        cellBody(formatHours(m.hours),                        bodySize, { alignment: 'center' }),
        cellBody(formatRand(tariff),                          bodySize, { alignment: 'right' }),
        cellBody(formatRand(sub),                             bodySize, { alignment: 'right', bold: true }),
      ]);
    });
  }
  // Total row at the bottom — right-aligned label + bold figure.
  rows.push([
    cellBody('',                 bodySize, { fillColor: '#f5f5f5' }),
    cellBody('',                 bodySize, { fillColor: '#f5f5f5' }),
    cellBody('',                 bodySize, { fillColor: '#f5f5f5' }),
    cellBody('',                 bodySize, { fillColor: '#f5f5f5' }),
    cellBody('Total',            bodySize, { alignment: 'right', bold: true, fillColor: '#f5f5f5' }),
    cellBody('',                 bodySize, { fillColor: '#f5f5f5' }),
    cellBody(formatRand(total),  bodySize, { alignment: 'right', bold: true, fillColor: '#f5f5f5' }),
  ]);

  return {
    table: {
      widths: [120, 75, '*', 60, 70, 70, 80],
      headerRows: 1,
      // Keep every milestone row intact — pdfmake will move the whole row
      // onto the next page rather than render half on the current page
      // and the rest above the table header at the top of the next.
      // Header row also repeats on every page via `headerRows: 1`.
      dontBreakRows: true,
      // Prevent the header from sitting alone at the bottom of the page
      // (with the first data rows wrapping to the next page).
      keepWithHeaderRows: 2,
      body: rows,
    },
    layout: {
      hLineWidth: () => 0.75,
      vLineWidth: () => 0.75,
      hLineColor: () => '#000000',
      vLineColor: () => '#000000',
    },
  };
}

// Cell factories. Both inherit `defaultStyle.font` (the company-branded font
// family registered at the top of this file), so they always render in the
// brand typeface. Sizes are RELATIVE to the company's body size so the
// document scales when the user changes SowBodyFontSize in the branding —
// header is body − 3, body cell stays at body. Caller passes the resolved
// body size (the BODY variable inside generateSowPdf).
function cellHead(text, bodySize) {
  const headSize = Math.max(7, bodySize - 3);
  return {
    text, bold: true, alignment: 'center',
    fontSize: headSize,
    color: '#000000',
    margin: [2, 5, 2, 5],
    fillColor: '#f5f5f5',
  };
}
function cellBody(text, bodySize, opts = {}) {
  // Body rows render at body − 2 so we can fit more milestones per page
  // without the table feeling sparse. Still proportional to the brand body
  // size, just slightly tighter than the document copy.
  const cellSize = Math.max(8, bodySize - 2);
  return {
    text,
    fontSize: cellSize,
    color: '#000000',
    margin: [4, 4, 4, 4],
    ...opts,
  };
}
function formatHours(h) {
  const n = Number(h || 0);
  // Keep one decimal only when needed: "0.5", "1", "2.5".
  return Number.isInteger(n) ? String(n) : n.toString();
}

// Gantt chart — one row per milestone, columns are weeks. The milestone's
// week is filled with the brand colour; other cells are empty. The chart
// is bounded by the max week across all milestones.
function buildGanttChart(appA, bodySize) {
  const rows = [];
  for (const project of appA.projects) {
    project.milestones.forEach((m, i) => {
      rows.push({
        code: milestoneCodeFor(project, i),
        projectName: project.name || '—',
        description: m.description || '',
        week: Number(m.week || 1),
      });
    });
  }
  if (rows.length === 0) return null;

  const codeFontSize  = Math.max(7, bodySize - 4);
  const labelFontSize = Math.max(8, bodySize - 2);
  const projectFontSize = Math.max(7, bodySize - 3);

  const maxWeek = Math.max(...rows.map((r) => r.week), 1);
  const weekHeaders = [];
  for (let w = 1; w <= maxWeek; w++) weekHeaders.push(cellHead(`W${w}`, bodySize));

  const body = [
    [cellHead('Code', bodySize), cellHead('Project / Milestone', bodySize), ...weekHeaders],
  ];
  for (const r of rows) {
    const cells = [
      cellBody(r.code, bodySize, { alignment: 'center', bold: true, fontSize: codeFontSize }),
      cellBody(
        // Two-line label: project name (muted) over milestone description.
        [
          { text: r.projectName, fontSize: projectFontSize, color: '#666' },
          { text: '\n' + r.description, fontSize: labelFontSize },
        ],
        bodySize,
      ),
    ];
    for (let w = 1; w <= maxWeek; w++) {
      cells.push({ text: '', fillColor: w === r.week ? '#088298' : null, margin: [0, 8, 0, 8] });
    }
    body.push(cells);
  }

  // Column widths — keep the week columns narrow + uniform so the chart
  // reads like a timeline strip even at high week counts.
  const weekWidth = maxWeek > 12 ? 22 : 32;
  return {
    table: {
      widths: [70, '*', ...Array(maxWeek).fill(weekWidth)],
      headerRows: 1,
      // Same rule as the milestone breakdown table — never split a single
      // milestone row across a page boundary; keep the header glued to at
      // least two rows so an orphan header never sits alone at the bottom.
      dontBreakRows: true,
      keepWithHeaderRows: 2,
      body,
    },
    layout: {
      hLineWidth: () => 0.4,
      vLineWidth: () => 0.4,
      hLineColor: () => '#cccccc',
      vLineColor: () => '#cccccc',
    },
  };
}

// Compose the PDF metadata title shown in browser viewers + file
// properties. Format: "<documentName> V<version>". Falls back to the
// older "Statement of Work — <client>" if the caller didn't supply a
// documentName (e.g. very old SOWs whose route doesn't pass it
// through). The version stamp is omitted when there isn't one yet.
function buildPdfTitle(documentName, cover, issuerNameDisplay) {
  const cleanName = typeof documentName === 'string' ? documentName.trim() : '';
  const rawVersion = (cover?.version || '').trim();
  // cover.version is stored bare (e.g. "1.5") — prefix with "V" for the title.
  const versionStamp = rawVersion ? ` V${rawVersion}` : '';
  if (cleanName) return cleanName + versionStamp;
  const clientPart = cover?.clientName ? ` — ${cover.clientName}` : '';
  return `Statement of Work${clientPart}${versionStamp}`;
}

// ---------- Main builder ----------

export async function buildSowPdfBuffer(data) {
  return generateSowPdf(data, { bufferOnly: true });
}

export async function generateSowPdf(data, opts = {}) {
  const cover      = data.cover      || {};
  const sections   = data.sections   || {};
  const signatures = data.signatures || {};
  const tables     = data.tables     || {};
  const branding   = data.branding   || {};
  const issuer     = data.issuer     || {};
  const typography = data.typography || {};

  const FONT = resolveFont(typography.fontFamily);
  const BODY = typography.bodyFontSize || 12;
  const H1   = typography.h1FontSize   || 14;
  const H2   = typography.h2FontSize   || 13;
  const H3   = typography.h3FontSize   || 12;

  const issuerRawName = issuer.name || 'E-Click';
  const issuerName = issuerRawName.toUpperCase();
  const issuerNameDisplay = issuerRawName;
  const issuerRegNo = issuer.registrationNumber || '—';

  const applyAllCaps = (text, flag) => flag ? String(text || '').toUpperCase() : String(text || '');
  const h1Caps = !!typography.h1AllCaps;
  const h2Caps = !!typography.h2AllCaps;
  const h3Caps = !!typography.h3AllCaps;

  const clientNameForTitle = (cover.clientName || '').trim();
  const rawVersion = (cover.version || '').trim();
  const versionDisplay = rawVersion
    ? (rawVersion.includes('//') ? rawVersion : `${issuerNameDisplay} // ${clientNameForTitle || 'Client'}: V${rawVersion}`)
    : '';

  const sectionList = resolveSectionList(sections);
  const numSections = sectionList.length;
  // Resolve the signature parties up-front so we know whether to render the
  // Signature Control heading at all. When the author has removed every
  // party the section is omitted entirely (no heading, no TOC entry, no
  // forced page break) and appendix numbering shifts up to fill the gap.
  const sigPartiesPreview = resolveSigParties(signatures, {
    clientName:   cover.clientName  || '',
    providerName: issuer.name       || 'E-Click',
  });
  const hasSigSection = sigPartiesPreview.length > 0;
  const SIG_NUM = hasSigSection ? numSections + 1 : null;
  // Unified appendices list — see normaliseAppendicesForRender for the legacy
  // shapes it migrates. Both the TOC and the body iterate this single array,
  // so the numbering and IDs stay in lock-step.
  const appendices = normaliseAppendicesForRender(tables);
  const APP_NUM = (idx) => (hasSigSection ? SIG_NUM + 1 : numSections + 1) + idx;
  const APP_REF_ID = (idx) => `sow-app-${String.fromCharCode(97 + idx)}`; // 'sow-app-a','sow-app-b',…

  // A4 size: 210 × 297 mm. We use pdfmake's "A4" page size and a 56pt margin
  // (≈ 19.7 mm — close to Word's standard 1" margins after subtracting space
  // for the header/footer banners that extend to the page edges).
  const PAGE_MARGIN_LR = 56;
  const PAGE_MARGIN_TOP = 90;     // leaves room for the header banner
  const PAGE_MARGIN_BOTTOM = 80;  // leaves room for the footer banner + page number

  // Pre-read the banner images so we can sized them once and reuse.
  const portraitHeader  = readBanner(branding.headerPath,           { pageWidthMm: 210 });
  const portraitFooter  = readBanner(branding.footerPath,           { pageWidthMm: 210 });
  const landscapeHeader = readBanner(branding.landscapeHeaderPath || branding.headerPath, { pageWidthMm: 297 });
  const landscapeFooter = readBanner(branding.landscapeFooterPath || branding.footerPath, { pageWidthMm: 297 });

  // Compute the portrait header banner's rendered height in points so we
  // know how far down to push the cover-page content. The banner is drawn
  // full-width at A4 portrait (595pt) with height preserving the source
  // aspect ratio. When the body's top margin (PAGE_MARGIN_TOP, 90pt) isn't
  // enough to clear a tall banner, the cover title would otherwise sit
  // behind the banner image. We add the difference + a small breathing
  // gap to the first cover element's top margin so it can never overlap.
  const A4_PORTRAIT_WIDTH = 595;
  const portraitHeaderHeight = portraitHeader
    ? (portraitHeader._origHeight / portraitHeader._origWidth) * A4_PORTRAIT_WIDTH
    : 0;
  const coverTopGap = Math.max(0, portraitHeaderHeight - PAGE_MARGIN_TOP) + 18;

  // Where the page number sits — 'top' or 'bottom'. Drives which
  // callback (header / footer) renders the page-number text below.
  const pageNumberPosition = branding.pageNumberPosition === 'top' ? 'top' : 'bottom';

  // ---- Build the content array ----
  const content = [];

  // ---- COVER / FRONT-PAGE ----
  // Two layouts:
  //   • cover.style === 'heading-only': render a single Heading-1 line at
  //     the top of page 1; sections (and TOC) flow directly underneath, no
  //     separate cover page. Best for policies, briefs, and other short
  //     documents.
  //   • cover.style === 'full' (default for legacy SOWs): the formal SOW
  //     cover page with parties, registration number, "Entered into by and
  //     between" line, and the Date/Version table — followed by a page
  //     break.
  const titleLine = clientNameForTitle ? `${issuerName} / ${clientNameForTitle}` : issuerName;
  const coverStyle = cover.style === 'heading-only' ? 'heading-only' : 'full';

  if (coverStyle === 'heading-only') {
    const headingText = (cover.headingText && String(cover.headingText).trim())
      ? cover.headingText
      : (clientNameForTitle || 'Document');
    content.push({
      text: applyAllCaps(headingText, h1Caps),
      alignment: 'center',
      bold: true,
      fontSize: H1,
      // coverTopGap pushes the title down past the header banner when the
      // banner is taller than PAGE_MARGIN_TOP, so the heading never sits
      // behind the letterhead image.
      margin: [0, coverTopGap, 0, 14],
    });
    // No page break here — the TOC + body flow directly below the heading.
  } else {
    // Cover-page customisation overrides (cover.fullPage). Each field is
    // optional and falls back to the SOW-style default so the original
    // Scope-of-Work look is preserved unchanged for templates that
    // don't customise. Author-typed strings are trimmed and accepted
    // verbatim — empty strings mean "use default".
    const fp = (cover && typeof cover.fullPage === 'object') ? cover.fullPage : {};
    const docTitle      = (typeof fp.documentTitle  === 'string' && fp.documentTitle.trim())  ? fp.documentTitle  : 'Statement of Work';
    const introText     = (typeof fp.introText      === 'string' && fp.introText.trim())      ? fp.introText      : 'Entered into by and between';
    const party1Label   = (typeof fp.party1Label    === 'string' && fp.party1Label.trim())    ? fp.party1Label    : '(hereinafter referred to as "Contractor")';
    const party2Label   = (typeof fp.party2Label    === 'string' && fp.party2Label.trim())    ? fp.party2Label    : '(hereinafter referred to as "the Client")';
    // Optional second descriptor lines (e.g. ID number, address) —
    // rendered only when filled in, with the same bold styling as the
    // first descriptor so the block reads as one metadata stack.
    const party1Label2  = (typeof fp.party1Label2   === 'string' && fp.party1Label2.trim())   ? fp.party1Label2   : '';
    const party2Label2  = (typeof fp.party2Label2   === 'string' && fp.party2Label2.trim())   ? fp.party2Label2   : '';
    const connectorText = (typeof fp.connectorText  === 'string' && fp.connectorText.trim())  ? fp.connectorText  : 'and';
    // The two boolean toggles default to TRUE (show), so an undefined
    // value preserves the historical look.
    const showRegNum = fp.showRegistrationNumber !== false;
    const showDateVerTable = fp.showDateVersionTable !== false;

    const coverNodes = [
      // Use whichever is larger: the original 90pt cover offset, or the
      // computed coverTopGap (which kicks in for tall banners).
      { text: titleLine, alignment: 'center', bold: true, fontSize: H1, margin: [0, Math.max(90, coverTopGap), 0, 6] },
      { text: docTitle,  alignment: 'center', bold: true, fontSize: H1, margin: [0, 0, 0, 24] },

      { text: introText, alignment: 'center', fontSize: BODY, margin: [0, 8, 0, 18] },
      { text: issuerName, alignment: 'center', bold: true, fontSize: H2, margin: [0, 0, 0, 12] },
    ];
    if (showRegNum) {
      coverNodes.push({ text: `Registration number: ${issuerRegNo}`, alignment: 'center', bold: true, fontSize: BODY, margin: [0, 0, 0, 12] });
    }
    // Party 1 descriptors — bold to match the issuer name + registration
    // number styling. Second line is only emitted when the author has
    // filled it in.
    coverNodes.push({ text: party1Label, alignment: 'center', bold: true, fontSize: BODY, margin: [0, 0, 0, party1Label2 ? 6 : 18] });
    if (party1Label2) {
      coverNodes.push({ text: party1Label2, alignment: 'center', bold: true, fontSize: BODY, margin: [0, 0, 0, 18] });
    }
    // Connector text always renders (defaults to "and"). The client
    // name line is now skipped entirely when blank — no more dash
    // placeholder cluttering an otherwise customised cover.
    coverNodes.push({ text: connectorText, alignment: 'center', fontSize: BODY, margin: [0, 0, 0, 18] });
    if (clientNameForTitle) {
      coverNodes.push({ text: clientNameForTitle, alignment: 'center', bold: true, fontSize: H2, margin: [0, 0, 0, 12] });
    }
    coverNodes.push({ text: party2Label, alignment: 'center', bold: true, fontSize: BODY, margin: [0, 0, 0, party2Label2 ? 6 : 36] });
    if (party2Label2) {
      coverNodes.push({ text: party2Label2, alignment: 'center', bold: true, fontSize: BODY, margin: [0, 0, 0, 36] });
    }

    if (showDateVerTable) {
      coverNodes.push({
        // Date / Version table at the bottom of the cover
        table: {
          widths: ['*', '*'],
          headerRows: 1,
          body: [
            [
              { text: 'Date of submission:', bold: true, alignment: 'center', fontSize: BODY, margin: [2, 6, 2, 6] },
              { text: 'Version:',             bold: true, alignment: 'center', fontSize: BODY, margin: [2, 6, 2, 6] },
            ],
            [
              { text: cover.dateOfSubmission || '', alignment: 'center', fontSize: BODY, margin: [2, 6, 2, 6] },
              { text: versionDisplay,                alignment: 'center', fontSize: BODY, margin: [2, 6, 2, 6] },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.75,
          vLineWidth: () => 0.75,
          hLineColor: () => '#000000',
          vLineColor: () => '#000000',
        },
        margin: [40, 30, 40, 0],
      });
    }
    coverNodes.push({ text: '', pageBreak: 'after' });
    content.push(...coverNodes);
  }

  // ---- TABLE OF CONTENTS ----
  // The TOC is opt-out via `cover.includeToc`. When the author has unchecked
  // "Include table of contents" in the cover-page editor (typical for short
  // documents like policies that don't need navigation), we still pre-
  // generate the section/sub-section IDs further below so individual
  // pageReferences keep working, but we skip rendering the actual TOC.
  const includeToc = cover.includeToc !== false;

  // Stable IDs for the section headings — used by `pageReference` below so the
  // TOC shows the real page number once the document has been laid out. The
  // same IDs are attached to each heading via `id:` when the body is built.
  const SEC_ID    = (i)       => `sow-sec-${i}`;
  const SUB_ID    = (i, j)    => `sow-sec-${i}-${j}`;
  const SUBSUB_ID = (i, j, k) => `sow-sec-${i}-${j}-${k}`;
  const SIG_REF_ID  = 'sow-sig';
  // Per-section table IDs — used as TOC pageReferences if we ever surface
  // section tables in the TOC; right now they're left out so the TOC stays
  // compact, but the IDs are still attached so cross-refs keep working.
  const SEC_TABLE_ID = (i, ti) => `sow-sec-${i}-tbl-${ti}`;

  // If a heading was typed in ALL CAPS upstream (e.g. because the body uses
  // h2AllCaps and the author wrote it that way), we still want the TOC entry
  // to read as a normal title. We only normalise strings whose letters are
  // *entirely* uppercase — anything with a single lower-case letter is
  // assumed to be intentional (preserving acronyms like "AFMA SOW" inside an
  // otherwise mixed-case title).
  const SMALL_WORDS = new Set([
    'a','an','and','as','at','but','by','for','if','in','nor','of','on','or','the','to','with',
  ]);
  function tocTitleCase(s) {
    if (!s) return s;
    const letters = s.match(/[a-zA-Z]/g);
    if (!letters) return s;
    const allCaps = letters.every((c) => c === c.toUpperCase());
    if (!allCaps) return s;
    return s.toLowerCase().split(/(\s+|[-:./()])/).map((tok, i) => {
      if (!/[a-z]/.test(tok)) return tok;
      if (i > 0 && SMALL_WORDS.has(tok)) return tok;
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    }).join('');
  }

  if (includeToc) {
    content.push({ text: 'Table of Contents', alignment: 'center', bold: true, fontSize: H1, margin: [0, 4, 0, 14] });
  }

  // Each TOC entry is rendered as its own one-row 3-column sub-table:
  //   1) Title (auto width, left-aligned)            — no borders
  //   2) Filler              (* width, empty)        — dotted bottom border  ← leader dots
  //   3) Page number  (auto width, right-aligned)    — no borders
  // Per-row tables (instead of one big shared table for the whole TOC) let
  // pdfmake size column 1 to the LONGEST WORD IN THIS ROW rather than the
  // longest title in the whole document, so the dots start right after the
  // title text on every line instead of all being aligned in a fixed
  // middle column.
  //
  // The dashed bottom border on the filler cell gives the classic leader-
  // dot effect; the per-cell `border` arrays suppress every other segment.
  //
  // Titles are rendered in their original case (no applyAllCaps) so the
  // TOC never contains all-caps headings — even when h1AllCaps is enabled
  // for the body.
  const tocRowsContent = [];

  // The dotted leader is rendered as the bottom border of the middle
  // (filler) cell. pdfmake draws cell borders at the cell box's bottom
  // edge, which sits at the text's descender line — visibly below the
  // baseline where typography would normally put leader dots.
  //
  // To pull the dots up into the baseline region we:
  //   • zero the cell padding (gap moves to the row's outer margin
  //     instead),
  //   • set `lineHeight: 1` on each text cell so the line-box height is
  //     tight against the glyphs (no extra leading below the descender),
  //   • drop the cell's effective box height by 3pt via a negative
  //     `paddingBottom` returned from the layout — this raises the
  //     bottom edge (where the dashed line is drawn) into the descender
  //     zone of the text, sitting visually flush with the bottom of the
  //     characters.
  const tocRowLayout = {
    hLineWidth: () => 1,
    hLineColor: () => '#000000',
    hLineStyle: () => ({ dash: { length: 1, space: 2 } }),
    vLineWidth: () => 0,
    paddingLeft:   () => 0,
    paddingRight:  () => 0,
    paddingTop:    () => 0,
    paddingBottom: () => -3,
  };

  function tocRow({ numberPart, titlePart, level, pageRefId }) {
    const indent = (level - 1) * 16;
    return {
      // Outer margin produces the visual gap between TOC entries that the
      // cell-padding used to give us. Top + bottom values are tuned to
      // match the spacing the original TOC table had.
      margin: [0, 5, 0, 2],
      table: {
        widths: ['auto', '*', 'auto'],
        body: [[
          {
            text: [
              { text: numberPart ? `${numberPart}   ` : '' },
              { text: titlePart || '' },
            ],
            lineHeight: 1,
            margin: [indent, 0, 4, 0],
            border: [false, false, false, false],
          },
          {
            text: '',
            lineHeight: 1,
            margin: [0, 0, 0, 0],
            border: [false, false, false, true],
          },
          // pageReference MUST sit directly on the node — pdfmake's
          // preprocessor only injects the resolved page number when it
          // finds `pageReference` on the node itself (it sets
          // node.text = '00000' which the renderer later rewrites).
          // Wrapping it as `text: { pageReference }` silently no-ops.
          {
            pageReference: pageRefId,
            lineHeight: 1,
            alignment: 'right',
            margin: [6, 0, 0, 0],
            border: [false, false, false, false],
          },
        ]],
      },
      layout: tocRowLayout,
    };
  }

  sectionList.forEach((s, i) => {
    const num = i + 1;
    tocRowsContent.push(tocRow({
      numberPart: `${num}.`,
      titlePart: tocTitleCase((s.title || '').trim()) || `Section ${num}`,
      level: 1,
      pageRefId: SEC_ID(i),
    }));
    (Array.isArray(s.subsections) ? s.subsections : []).forEach((sub, j) => {
      const subNum = `${num}.${j + 1}`;
      tocRowsContent.push(tocRow({
        numberPart: subNum,
        titlePart: tocTitleCase((sub.title || '').trim()),
        level: 2,
        pageRefId: SUB_ID(i, j),
      }));
      (Array.isArray(sub.subsubsections) ? sub.subsubsections : []).forEach((ss, k) => {
        tocRowsContent.push(tocRow({
          numberPart: `${subNum}.${k + 1}`,
          titlePart: tocTitleCase((ss.title || '').trim()),
          level: 3,
          pageRefId: SUBSUB_ID(i, j, k),
        }));
      });
    });
  });
  if (hasSigSection) {
    tocRowsContent.push(tocRow({ numberPart: `${SIG_NUM}.`, titlePart: 'Signature Control', level: 1, pageRefId: SIG_REF_ID }));
  }
  // One TOC row per appendix (A, B, C, …). Matches the numbering + IDs the
  // body renderer uses below.
  appendices.forEach((appx, idx) => {
    const letter = String.fromCharCode(65 + idx);
    tocRowsContent.push(tocRow({
      numberPart: `${APP_NUM(idx)}.`,
      titlePart:  `Appendix ${letter}: ${(appx.title || '').trim() || 'Untitled'}`,
      level: 1,
      pageRefId: APP_REF_ID(idx),
    }));
  });

  if (includeToc) {
    // Each TOC row is its own table so the per-row title column shrinks to
    // fit just that row's text — the dot leader then runs from the title
    // to the page number on that line, instead of all rows sharing a
    // single fixed-width title column.
    for (const row of tocRowsContent) content.push(row);
  }

  // Only force a fresh page when there was actually a TOC above — otherwise
  // a heading-only / no-TOC document would print a blank page here.
  if (includeToc) content.push({ text: '', pageBreak: 'after' });

  // ---- BODY SECTIONS ----
  // The footer reads the page-offset (cover + TOC page count) from the shared
  // `_sowState` object, which is set during layout by the LayoutBuilder patch
  // above. That way a 2-page TOC works correctly without any hard-coding —
  // the footer's "page 1" lands on the first body page regardless of how
  // long the TOC turns out to be.

  // Render "N. Heading text" as a two-column row so the title wraps with a
  // proper hanging indent — wrapped lines stay aligned with the start of the
  // title text instead of falling back under the number. The `id` is attached
  // to the number cell because that's the first node rendered for the line,
  // which is what `pageReference` uses to resolve the page.
  //
  // `headlineLevel` lets the `pageBreakBefore` callback recognise this node
  // as a heading and push it onto the next page when nothing else fits below
  // it on the current page (keep-with-next behaviour).
  function numberedHeading({ numberPart, titlePart, styleName, id, margin }) {
    const styleSize = { h1: H1, h2: H2, h3: H3 }[styleName] || BODY;
    const level = { h1: 1, h2: 2, h3: 3 }[styleName] || 1;
    // Bold heading digits are ~0.62 × fontSize wide. Add a small trailing gap
    // (~half a character) so the title doesn't touch the number.
    const numberWidth = Math.ceil((numberPart.length + 0.6) * styleSize * 0.62);
    return {
      columns: [
        { text: numberPart, style: styleName, width: numberWidth, id },
        { text: titlePart,  style: styleName, width: '*' },
      ],
      columnGap: 0,
      headlineLevel: level,
      margin: margin || [0, 0, 0, 0],
    };
  }

  // Faint separator line drawn between sections. Width matches the body
  // text-block exactly (page width minus both side margins), centred between
  // the previous section and the next heading.
  // Section separator is a per-company branding toggle (defaults ON for
  // every legacy row via the DB column's default value). When disabled,
  // the inter-section line and the line above Signature Control are
  // skipped — sections still get their normal heading spacing.
  const includeSeparator = branding.sectionSeparator !== false;
  const SEPARATOR_WIDTH = 595 - (PAGE_MARGIN_LR * 2); // A4 portrait body width in pt
  function sectionSeparator() {
    return {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: SEPARATOR_WIDTH, y2: 0, lineWidth: 0.5, lineColor: '#888888' }],
      // Tightened separator padding (was 12pt top + 12pt bottom).
      margin: [0, 6, 0, 6],
    };
  }

  sectionList.forEach((s, idx) => {
    const title = (s.title || '').trim() || `Section ${idx + 1}`;

    // Inter-section spacing. We attach it as a SEPARATE element BEFORE
    // each non-first heading so that, if the heading wraps to a new
    // page, pdfmake leaves the spacer on the previous page (consumed by
    // the page break) and the heading lands flush at the top of the
    // fresh page — instead of carrying its top margin over and starting
    // a few points down.
    //
    //   • separator on  → push the canvas line (6pt top + 6pt bottom)
    //   • separator off → push an invisible 0-height spacer with 8pt
    //                     bottom margin (small gap, no visible rule)
    if (idx > 0) {
      if (includeSeparator) {
        content.push(sectionSeparator());
      } else {
        content.push({ text: '', margin: [0, 0, 0, 8] });
      }
    }
    content.push(numberedHeading({
      numberPart: `${idx + 1}.`,
      titlePart: applyAllCaps(title, h1Caps),
      styleName: 'h1',
      id: SEC_ID(idx),
      // Tightened heading-to-body gap (was 8pt). First section gets a
      // slightly larger top margin so it doesn't crowd the cover area.
      margin: [0, idx === 0 ? 8 : 0, 0, 5],
    }));

    const bodyBlocks = htmlToBlocks(s.body || '');
    const subs = Array.isArray(s.subsections) ? s.subsections : [];
    const secTables = Array.isArray(s.tables) ? s.tables : [];
    if (bodyBlocks.length === 0 && subs.length === 0 && secTables.length === 0) {
      content.push({ text: '—', style: 'body' });
    } else {
      for (const b of bodyBlocks) content.push(b);
    }

    // Section-level tables: H3-titled tables that live alongside the section
    // body, before any sub-sections. Each entry has an optional heading + an
    // optional body-text description that mirrors the appendix table-block
    // shape (empty descriptions render nothing at all).
    secTables.forEach((tbl, ti) => {
      if (tbl?.heading?.trim()) {
        content.push({
          text: applyAllCaps(tbl.heading.trim(), h3Caps),
          style: 'h3',
          headlineLevel: 3,
          id: SEC_TABLE_ID(idx, ti),
          margin: [0, 6, 0, 3],
        });
      }
      if (tbl?.description?.trim()) {
        content.push({
          text: tbl.description.trim(),
          style: 'body',
          margin: [0, 0, 0, 6],
        });
      }
      const t = tableFromGrid(tbl?.grid, { bodyStyle: 'body' });
      if (t) {
        t.table = { ...t.table, headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 2 };
        content.push(t);
      }
    });

    subs.forEach((sub, subIdx) => {
      const subTitle = (sub?.title || '').trim() || 'Sub-section';
      content.push(numberedHeading({
        numberPart: `${idx + 1}.${subIdx + 1}`,
        titlePart: applyAllCaps(subTitle, h2Caps),
        styleName: 'h2',
        id: SUB_ID(idx, subIdx),
        margin: [0, 6, 0, 3],
      }));
      const subBlocks = htmlToBlocks(sub?.body || '');
      const subsubs = Array.isArray(sub?.subsubsections) ? sub.subsubsections : [];
      if (subBlocks.length === 0 && subsubs.length === 0) {
        content.push({ text: '—', style: 'body' });
      } else {
        for (const b of subBlocks) content.push(b);
      }

      subsubs.forEach((ss, ssIdx) => {
        const ssTitle = (ss?.title || '').trim() || 'Heading 3';
        content.push(numberedHeading({
          numberPart: `${idx + 1}.${subIdx + 1}.${ssIdx + 1}`,
          titlePart: applyAllCaps(ssTitle, h3Caps),
          styleName: 'h3',
          id: SUBSUB_ID(idx, subIdx, ssIdx),
          margin: [0, 5, 0, 2],
        }));
        const ssBlocks = htmlToBlocks(ss?.body || '');
        for (const b of ssBlocks) content.push(b);
      });
    });
  });

  // ---- SIGNATURE CONTROL ----
  // The Signature Control section flows naturally with the rest of the
  // document — it no longer forces a fresh page. Each party block
  // (heading + "warrants" line + bordered signature table) is wrapped in
  // an `unbreakable` stack though, so a party never gets split across a
  // page boundary: if it doesn't fit on the current page, the whole
  // party block moves to the next page together.
  //
  // Party titles + companies come from the editor's `signatures.parties`
  // list — Client and Service Provider start there by default and pick up
  // their company from the cover / branding, but the author can rename
  // them, remove them, reorder them, and add additional parties (e.g.
  // Witness, Partner, 3rd-party Vendor) with author-typed companies.
  // An empty parties list means the document has no signature page — no
  // H1 heading, no TOC entry, and appendix numbering shifts up.
  if (hasSigSection) {
    const sigParties = resolveSigParties(signatures, {
      clientName:   cover.clientName  || '',
      providerName: issuerNameDisplay,
    }).map((p) => {
      if (p.kind === 'client')   return { ...p, company: cover.clientName  || p.company || '' };
      if (p.kind === 'provider') return { ...p, company: issuerNameDisplay || p.company || '' };
      return p;
    });

    // Same faint separator line / spacer treatment as between main
    // sections — keeps the heading flush at the top of a fresh page if
    // it wraps over (the spacer's bottom margin stays on the previous
    // page).
    if (includeSeparator) {
      content.push(sectionSeparator());
    } else {
      content.push({ text: '', margin: [0, 0, 0, 20] });
    }
    content.push(numberedHeading({
      numberPart: `${SIG_NUM}.`,
      titlePart: applyAllCaps('Signature Control', h1Caps),
      styleName: 'h1',
      id: SIG_REF_ID,
      margin: [0, 0, 0, 14],
    }));

    sigParties.forEach((party, partyIdx) => {
      const heading = `${(party.title || '').trim() || 'Party'}: ${party.company || ''}`.trim().replace(/:\s*$/, ':');
      // Heading + warrants line + bordered table, all wrapped in one
      // unbreakable stack so the party never splits across pages. The
      // signature table itself is small (5 default rows) so the whole
      // block fits comfortably on a single page without pdfmake having
      // to truncate.
      content.push({
        unbreakable: true,
        stack: [
          {
            text: heading,
            style: 'h2',
            headlineLevel: 2,
            // Tighter inter-party gap (was 18pt) so the parties stack more
            // compactly when there's room on the same page.
            margin: [0, partyIdx === 0 ? 4 : 12, 0, 3],
          },
          {
            text: 'Who warrants that he/she is authorised to do so',
            style: 'body',
            margin: [0, 0, 0, 5],
          },
          sigTable(party),
        ],
      });
    });
  }

  // Build the bordered 3-column signature table from the party's row list.
  function sigTable(party) {
    const body = party.rows.map((row) => [
      { text: row.label || '', bold: true,  style: 'body', margin: [6, 8, 4, 8] },
      { text: ':',              alignment: 'center', style: 'body', margin: [0, 8, 0, 8] },
      sigValueCell(row),
    ]);
    return {
      table: { widths: [130, 12, '*'], body },
      layout: {
        hLineWidth: () => 0.6,
        vLineWidth: () => 0.6,
        hLineColor: () => '#000000',
        vLineColor: () => '#000000',
      },
      margin: [0, 0, 0, 4],
    };
  }

  // The value cell renders an image when the row carries an uploaded
  // signature file; otherwise it falls back to the plain typed value. Empty
  // cells just leave a blank box so a printed copy can be signed by hand.
  function sigValueCell(row) {
    const padding = [8, 8, 8, 8];
    if (row.signatureFile) {
      const full = path.isAbsolute(row.signatureFile)
        ? row.signatureFile
        : path.join(UPLOAD_DIR, row.signatureFile);
      try {
        const buf = fs.readFileSync(full);
        const dims = imageSize(buf);
        if (dims?.width && dims?.height) {
          const ext = (dims.type || path.extname(full).replace('.', '') || 'png').toLowerCase();
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'gif'  ? 'image/gif'
            : 'image/png';
          return {
            image: `data:${mime};base64,${buf.toString('base64')}`,
            fit:   [220, 56],
            margin: padding,
          };
        }
      } catch (err) {
        console.error('[sow-pdf] could not read signature image:', full, err.message);
      }
    }
    return {
      text:  row.value || '',
      bold:  !!row.bold,
      style: 'body',
      margin: padding,
    };
  }

  // ---- APPENDICES ----
  // pdfmake supports per-element page orientation via
  // `{ pageBreak, pageOrientation }`. Each appendix opens with a fresh page
  // in its chosen orientation; milestones-type entries are forced landscape,
  // custom entries default to portrait but can be flipped to landscape from
  // the editor.
  appendices.forEach((appx, aIdx) => {
    const letter      = String.fromCharCode(65 + aIdx);
    const num         = APP_NUM(aIdx);
    const refId       = APP_REF_ID(aIdx);
    const orientation = appx.orientation === 'landscape' ? 'landscape' : 'portrait';

    content.push({ text: '', pageBreak: 'after', pageOrientation: orientation });
    content.push({
      ...numberedHeading({
        numberPart: `${num}.`,
        titlePart: applyAllCaps(
          `Appendix ${letter}: ${(appx.title || '').trim() || 'Untitled'}`,
          h1Caps,
        ),
        styleName: 'h1',
        id: refId,
        margin: [0, 0, 0, 10],
      }),
      pageOrientation: orientation,
    });

    if (appx.type === 'milestones') {
      const mt = buildMilestoneTable(appx, BODY);
      if (mt) {
        mt.pageOrientation = 'landscape';
        content.push(mt);
      } else {
        content.push({
          text: 'No detailed milestone breakdown provided.',
          italics: true, style: 'body',
          pageOrientation: 'landscape',
        });
      }
      // Gantt chart on its own landscape page (only when the author opted in
      // AND there are milestones to plot).
      if (appx.includeGantt !== false) {
        const gantt = buildGanttChart(appx, BODY);
        if (gantt) {
          content.push({ text: '', pageBreak: 'after', pageOrientation: 'landscape' });
          content.push({
            text: 'Project Timeline · Gantt Chart',
            style: 'h2',
            pageOrientation: 'landscape',
            margin: [0, 0, 0, 10],
          });
          gantt.pageOrientation = 'landscape';
          content.push(gantt);
        }
      }
      return;
    }

    // Custom appendix — a list of H2-headed text and/or table blocks.
    const blocks = Array.isArray(appx.blocks) ? appx.blocks : [];
    if (blocks.length === 0) {
      content.push({
        text: 'No content provided.',
        italics: true,
        style: 'body',
        pageOrientation: orientation,
      });
      return;
    }
    blocks.forEach((blk) => {
      if (blk?.heading?.trim()) {
        content.push({
          text: applyAllCaps(blk.heading.trim(), h2Caps),
          style: 'h2',
          headlineLevel: 2,
          pageOrientation: orientation,
          margin: [0, 12, 0, 6],
        });
      }
      if (blk?.type === 'text') {
        const textBlocks = htmlToBlocks(blk?.body || '');
        for (const tb of textBlocks) {
          content.push({ ...tb, pageOrientation: orientation });
        }
        return;
      }
      // Table block — optional body-text description above the grid, then
      // the table itself. Empty descriptions render nothing.
      if (blk?.description?.trim()) {
        content.push({
          text: blk.description.trim(),
          style: 'body',
          pageOrientation: orientation,
          margin: [0, 0, 0, 6],
        });
      }
      const t = tableFromGrid(blk?.grid, { bodyStyle: 'body' });
      if (t) {
        t.pageOrientation = orientation;
        // Same rule as the milestone breakdown table — never split a row
        // across a page boundary, and repeat the first row as a header on
        // each continuation page.
        t.table = { ...t.table, headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 2 };
        content.push(t);
      }
    });
  });

  // ---- HEADER / FOOTER CALLBACKS ----
  // pdfmake calls these once per page with the current page index and total.
  // The header banner is intentionally restricted to page 1 (the cover or
  // heading-only first page) — subsequent pages run header-free so the body
  // copy gets the full page height. The footer banner + page number still
  // print on every page.
  //
  // `branding.headerSideMargin` / `branding.footerSideMargin` (from the
  // company toggles) decide whether each banner runs full-bleed (default —
  // edge-to-edge) or is inset by the body left/right margin so it lines
  // up with the body text block. The two banners are toggled
  // independently — header can be inset while footer is full-bleed, or
  // vice-versa.
  const insetHeader = !!branding.headerSideMargin;
  const insetFooter = !!branding.footerSideMargin;
  // Which pages show the header / footer banner: 'all' | 'first' | 'last' |
  // 'none'. Defaults preserve the historical behaviour — the header banner
  // only ever appeared on the cover page ('first'), and the footer banner
  // repeated on every page ('all') — so an existing company whose branding
  // doesn't carry these fields renders exactly as before.
  const resolvePlacement = (v, dflt) =>
    (['all', 'first', 'last', 'none'].includes(v) ? v : dflt);
  const headerPlacement = resolvePlacement(branding.headerPlacement, 'first');
  const footerPlacement = resolvePlacement(branding.footerPlacement, 'all');
  const showBanner = (placement, cur, cnt) =>
    placement === 'none'  ? false
    : placement === 'first' ? cur === 1
    : placement === 'last'  ? cur === cnt
    : true; // 'all'
  // `pageNumberPosition` was resolved above (it also influences
  // PAGE_MARGIN_TOP) — re-use that value here without redefining.
  function bannerBox(banner, pageSize, inset) {
    if (!banner) return null;
    const leftPad = inset ? PAGE_MARGIN_LR : 0;
    const w = Math.max(0, pageSize.width - 2 * leftPad);
    const h = (banner._origHeight / banner._origWidth) * w;
    return { x: leftPad, width: w, height: h };
  }
  function header(currentPage, _pageCount, pageSize) {
    const isLandscape = pageSize.width > pageSize.height;
    const banner = isLandscape ? landscapeHeader : portraitHeader;
    const displayPage = currentPage - _sowState.pageOffset;
    const items = [];

    // Header banner image — shown on the pages selected by headerPlacement
    // (default 'first' = cover page only, matching the original behaviour).
    if (showBanner(headerPlacement, currentPage, _pageCount)) {
      const box = bannerBox(banner, pageSize, insetHeader);
      if (box) {
        items.push({
          image: banner.image,
          width: box.width,
          height: box.height,
          absolutePosition: { x: box.x, y: 0 },
        });
      }
    }

    // When the company picked "top" for the page number, render it in
    // the header band on every body page. pdfmake places header content
    // inside a virtual context of (pageSize.width × PAGE_MARGIN_TOP)
    // with origin at the top-left of the page.
    //
    // We anchor the number a few points below the rendered portrait
    // banner edge so on page 1 it sits cleanly underneath the letterhead
    // (instead of behind it), and on pages 2+ — where the banner isn't
    // drawn — it occupies the same Y for consistent visual placement.
    // Clamp upper-side to PAGE_MARGIN_TOP so the number can't collide
    // with the body copy that starts there.
    if (pageNumberPosition === 'top' && displayPage >= 1) {
      const numberFontSize = BODY;
      // Page 1 has the banner drawn — sit the number just below the
      // banner edge, inside the body's top-margin band where there's no
      // body text. On pages 2+ there's no banner, so anchor the number
      // a bit further down (40pt) so it doesn't crowd the top edge.
      const targetY = currentPage === 1
        ? Math.max(4, Math.min(portraitHeaderHeight + 4, PAGE_MARGIN_TOP - numberFontSize - 2))
        : 40;
      items.push({
        text: String(displayPage),
        alignment: 'center',
        fontSize: numberFontSize,
        // Use the company's branded font (FONT was resolved from
        // typography.fontFamily earlier) and render bold to match the
        // weight of section headings.
        font: FONT,
        bold: true,
        width: pageSize.width,
        absolutePosition: { x: 0, y: targetY },
      });
    }

    return items.length ? items : undefined;
  }
  function footer(currentPage, pageCount, pageSize) {
    const isLandscape = pageSize.width > pageSize.height;
    const banner = isLandscape ? landscapeFooter : portraitFooter;
    const displayPage = currentPage - _sowState.pageOffset;
    const items = [];

    // pdfmake renders footer content inside an unbreakable block whose virtual
    // page is (pageSize.width × PAGE_MARGIN_BOTTOM) with (0,0) at the top-left
    // of the footer area. absolutePosition coordinates are relative to THAT
    // origin — NOT to the actual page. We anchor the banner to the bottom of
    // the footer area (which is the bottom of the physical page) and stack the
    // page number just above it (only when the company has the page number
    // configured for the bottom — otherwise it's drawn in the header).
    const box = bannerBox(banner, pageSize, insetFooter);
    const bannerH = box?.height || 0;
    const bannerTopY = Math.max(0, PAGE_MARGIN_BOTTOM - bannerH);

    if (pageNumberPosition === 'bottom' && displayPage >= 1) {
      const numberFontSize = BODY;
      items.push({
        text: String(displayPage),
        alignment: 'center',
        fontSize: numberFontSize,
        // Match the company-branded font + bold weight used by the
        // top-position variant so the number reads consistently.
        font: FONT,
        bold: true,
        width: pageSize.width,
        absolutePosition: { x: 0, y: Math.max(0, bannerTopY - (numberFontSize + 4)) },
      });
    }
    if (box && showBanner(footerPlacement, currentPage, pageCount)) {
      items.push({
        image: banner.image,
        width: box.width,
        height: bannerH,
        absolutePosition: { x: box.x, y: bannerTopY },
      });
    }
    return items.length ? items : undefined;
  }

  // ---- DOCUMENT DEFINITION ----
  const docDef = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [PAGE_MARGIN_LR, PAGE_MARGIN_TOP, PAGE_MARGIN_LR, PAGE_MARGIN_BOTTOM],
    info: {
      // PDF metadata title shown in the browser PDF viewer tab and the
      // file's properties. Built from the document's display name (task
      // name in SOW mode, template name in template-preview mode — both
      // come in via `data.documentName`) plus the version stamp so the
      // viewer header reads e.g. "Equipment Purchase Agreement V1.5".
      title: buildPdfTitle(data.documentName, cover, issuerNameDisplay),
      author: issuerNameDisplay,
      creator: 'FSA HR Portal',
    },
    defaultStyle: {
      font: FONT,
      fontSize: BODY,
      color: '#000000',
      lineHeight: 1.25,
    },
    styles: {
      body:      { fontSize: BODY, color: '#000000' },
      h1:        { fontSize: H1, bold: true, color: '#000000' },
      h2:        { fontSize: H2, bold: true, color: '#000000' },
      h3:        { fontSize: H3, bold: true, color: '#000000' },
      tocEntry:  { fontSize: BODY, color: '#000000', lineHeight: 1.5 },
    },
    header,
    footer,
    content: keepHeadingsWithNext(content),
  };

  const buf = await pdfBufferFromDoc(docDef);
  if (opts.bufferOnly) return buf;

  const safeClient = (cover.clientName || 'client').replace(/[^\w\-]+/g, '_').slice(0, 32);
  const filename = `sow-${safeClient}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  const filepath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filepath, buf);
  return filename;
}

// Post-processor that bundles each run of consecutive headings + the first
// non-heading block that follows into a single `unbreakable: true` stack. This
// is pdfmake's only reliable way to express "keep this heading with the next
// content block" — if the bundle doesn't fit at the bottom of the current
// page it gets pushed onto the next one in its entirety, so headings never
// end up stranded by themselves at the bottom of a page.
//
// `pageOrientation` and `pageBreak` on the original heading are preserved on
// the wrapper so the existing orientation switches around Appendix A still
// work after wrapping.
function keepHeadingsWithNext(content) {
  const isHeading = (n) => !!(n && n.headlineLevel);
  const out = [];
  let i = 0;
  while (i < content.length) {
    const node = content[i];
    if (!isHeading(node)) {
      out.push(node);
      i++;
      continue;
    }
    // A heading that already requests an explicit `pageBreak` (e.g. the
    // Signature Control section, which must start on a new page) is left
    // untouched — wrapping it inside an unbreakable stack along with its
    // peers interacts oddly with the page-break and can cause the wrapper's
    // contents to be silently dropped from the rendered output.
    if (node.pageBreak) {
      out.push(node);
      i++;
      continue;
    }
    // Collect this heading + every consecutive heading immediately after it
    // (h1 → h2 → h3 chains) plus the first non-heading block that follows.
    //
    // BUT: tables, Gantt charts (`table` nodes), and bulleted / numbered
    // lists (`ul` / `ol` nodes) must stay OUTSIDE the unbreakable stack.
    // pdfmake handles its own page-breaks for these; bundling them inside
    // an unbreakable wrapper silently truncates (tables) or completely
    // drops (lists) the content from the rendered output. The Appendix A
    // milestone table and every editor list block are the victims here.
    const isTableLike = (n) => !!(n && (n.table || n.image || n.ul || n.ol));
    const group = [node];
    let j = i + 1;
    while (j < content.length && isHeading(content[j])) {
      group.push(content[j]);
      j++;
    }
    if (j < content.length && !isTableLike(content[j])) {
      group.push(content[j]);
      j++;
    }
    if (group.length === 1) {
      out.push(node);
    } else {
      const wrapper = { stack: group, unbreakable: true };
      // Carry orientation/page-break metadata from the leading heading so
      // section-orientation transitions (e.g. Appendix A landscape) still
      // happen at the wrapper level.
      if (node.pageOrientation) wrapper.pageOrientation = node.pageOrientation;
      if (node.pageBreak)       wrapper.pageBreak       = node.pageBreak;
      out.push(wrapper);
    }
    i = j;
  }
  return out;
}

// pdfmake.createPdf returns an OutputDocumentServer whose getBuffer() resolves
// once the entire PDF has been written. We flip `_sowState.active` on for the
// duration of one render so the LayoutBuilder patch discovers the offset and
// the Renderer patch applies it. Both reset in the finally block so unrelated
// pdfmake usage in the same process isn't affected.
async function pdfBufferFromDoc(docDef) {
  _sowState.active = true;
  _sowState.pageOffset = 0;
  try {
    return await pdfmake.createPdf(docDef).getBuffer();
  } finally {
    _sowState.active = false;
    _sowState.pageOffset = 0;
  }
}
