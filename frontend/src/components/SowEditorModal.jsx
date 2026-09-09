import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import MilestoneTableEditor from './MilestoneTableEditor.jsx';
import NextStepsEditor from './NextStepsEditor.jsx';
import AttentionPill from './AttentionPill.jsx';
import {
  normaliseAppendices, normaliseSectionTables, normaliseStatus,
  appendixLetter, blankCustomAppendix, blankMilestoneAppendix,
  blankTableBlock, blankTextBlock, blankSectionTable,
} from './appendix-utils.js';
import { confirmDialog } from '../confirm.js';

// Default starting sections for a brand-new SOW. The user can add, remove,
// rename and reorder these on a per-document basis.
const DEFAULT_SECTIONS = [
  { title: 'Executive Summary',                              hint: 'Concise summary of the engagement and why it matters.' },
  { title: 'Background and Current Environment',             hint: 'Context, history, current systems, key pain points.' },
  { title: 'Objectives of the Engagement',                   hint: 'Measurable goals; what success looks like.' },
  { title: 'Scope of Work',                                  hint: 'What is in scope (and explicitly out).' },
  { title: 'Milestone Plan and Timeline',                    hint: 'Phases, dates, deliverables.' },
  { title: 'Roles and Responsibilities',                     hint: 'Who does what — client, contractor, third parties.' },
  { title: 'Takeover, Stabilisation and Support Approach',   hint: 'How handover and post-go-live support will run.' },
  { title: 'Service Level Agreement Principle',              hint: 'High-level commitments; details in Appendix B.' },
  { title: 'Assumptions, Dependencies and Constraints',      hint: 'What we are taking as given; what blocks progress.' },
  { title: 'Commercials and Payment Structure',              hint: 'Fees, billing milestones, payment terms.' },
  { title: 'Acceptance and Sign-Off',                        hint: 'Criteria for accepting deliverables.' },
  { title: 'Confidentiality and NDA Reference',              hint: 'Existing NDAs, confidentiality clauses.' },
  { title: 'Dispute Resolution',                             hint: 'Governing law, jurisdiction, escalation.' },
];

// Legacy keys → title map, used when migrating old saves that stored sections
// as a fixed object keyed by camel-case names.
const LEGACY_KEY_TITLES = {
  executiveSummary:         'Executive Summary',
  background:               'Background and Current Environment',
  objectives:               'Objectives of the Engagement',
  scopeOfWork:              'Scope of Work',
  milestonePlan:            'Milestone Plan and Timeline',
  rolesAndResponsibilities: 'Roles and Responsibilities',
  takeoverAndSupport:       'Takeover, Stabilisation and Support Approach',
  slaPrinciple:             'Service Level Agreement Principle',
  assumptions:              'Assumptions, Dependencies and Constraints',
  commercials:              'Commercials and Payment Structure',
  acceptance:               'Acceptance and Sign-Off',
  confidentiality:          'Confidentiality and NDA Reference',
  disputeResolution:        'Dispute Resolution',
};
const LEGACY_KEY_ORDER = Object.keys(LEGACY_KEY_TITLES);

let _newSectionCounter = 0;
function newSectionId() {
  _newSectionCounter += 1;
  return 'sec-' + Date.now().toString(36) + '-' + _newSectionCounter;
}

function defaultSectionsArray() {
  return DEFAULT_SECTIONS.map((s) => ({
    id: newSectionId(),
    title: s.title,
    hint: s.hint,
    body: '',
    subsections: [],
  }));
}

const EMPTY_SECTION = { body: '', subsections: [] };

// Signature-row helpers — must be declared BEFORE `EMPTY` because the
// `signatures` field of `EMPTY` calls `defaultSigRows()` at module load.
// Moving them after `EMPTY` puts `DEFAULT_SIG_LABELS` (a const) in the
// temporal dead zone, which throws a ReferenceError and breaks the page.
const DEFAULT_SIG_LABELS = ['Name & Surname', 'Post Designation', 'Signature', 'Date', 'Location'];
let _sigRowCounter = 0;
function newSigRowId() { _sigRowCounter += 1; return `sig-${Date.now().toString(36)}-${_sigRowCounter}`; }
let _sigPartyCounter = 0;
function newSigPartyId() { _sigPartyCounter += 1; return `sp-${Date.now().toString(36)}-${_sigPartyCounter}`; }
function defaultSigRows() {
  return DEFAULT_SIG_LABELS.map((label) => ({ id: newSigRowId(), label, value: '', signatureFile: null, signatureUrl: null }));
}
function defaultSigParties() {
  return [
    { id: newSigPartyId(), kind: 'client',   title: 'Client',           company: '', rows: defaultSigRows() },
    { id: newSigPartyId(), kind: 'provider', title: 'Service Provider', company: '', rows: defaultSigRows() },
  ];
}

const EMPTY = {
  cover: { subtitle: '', clientName: '', dateOfSubmission: '', version: '1.0', revision: '' },
  sections: defaultSectionsArray(),
  tables: {
    // Unified appendices list. Each entry is either a `milestones` (Project
    // Milestone Table + optional Gantt, landscape) or `custom` (a list of
    // H2-headed text and/or table blocks, portrait by default) appendix.
    // Old SOWs with the legacy `appendixA` + `extraAppendices` split (and
    // even older single-grid `monthlyServiceAllocation`) are migrated on
    // load by `normaliseAppendices`.
    appendices: [],
  },
  // Signature Control payload. `parties` is an editable list — Client and
  // Service Provider start there by default but authors can rename them,
  // reorder them, remove ones that don't apply or add new parties
  // (Witness, Partner, 3rd-party Vendor, …). Each entry carries:
  //   id, kind ('client'|'provider'|'custom'),
  //   title (heading shown in the PDF), company (auto-derived from cover/
  //   issuer for client/provider, user-typed for custom), rows[].
  signatures: { parties: defaultSigParties() },
};
function normaliseSigRow(raw) {
  const signatureFile = typeof raw?.signatureFile === 'string' && raw.signatureFile ? raw.signatureFile : null;
  // Derive the URL from the filename so a previously-uploaded signature
  // image still appears in the editor when the SOW is reopened.
  const signatureUrl  = signatureFile
    ? (typeof raw?.signatureUrl === 'string' && raw.signatureUrl ? raw.signatureUrl : `/uploads/${signatureFile}`)
    : null;
  return {
    id:    raw?.id || newSigRowId(),
    label: typeof raw?.label === 'string' ? raw.label : '',
    value: typeof raw?.value === 'string' ? raw.value : '',
    signatureFile,
    signatureUrl,
  };
}
function normaliseSigParty(raw, defaults = {}) {
  const kind = raw?.kind === 'client' || raw?.kind === 'provider' || raw?.kind === 'custom'
    ? raw.kind
    : (defaults.kind || 'custom');
  return {
    id:      (raw && typeof raw.id === 'string' && raw.id) ? raw.id : newSigPartyId(),
    kind,
    title:   typeof raw?.title   === 'string' && raw.title   ? raw.title   : (defaults.title   || ''),
    company: typeof raw?.company === 'string' ? raw.company : (defaults.company || ''),
    rows: Array.isArray(raw?.rows) ? raw.rows.map(normaliseSigRow) : defaultSigRows(),
  };
}
// Migrate three shapes:
//   1. New `{ parties: [...] }` list → pass through (with hydration).
//   2. Older `{ client: {...}, provider: {...} }` object → build parties list.
//   3. Oldest flat fields (clientName / clientDesignation / …) → build list.
function normaliseSignatures(raw, defaultClientName = '') {
  const s = raw && typeof raw === 'object' ? raw : {};
  if (Array.isArray(s.parties)) {
    return { parties: s.parties.map((p) => normaliseSigParty(p)) };
  }
  if (s.client || s.provider) {
    return {
      parties: [
        normaliseSigParty(s.client,   { kind: 'client',   title: 'Client',           company: s.clientCompany   || defaultClientName }),
        normaliseSigParty(s.provider, { kind: 'provider', title: 'Service Provider', company: s.providerCompany || '' }),
      ],
    };
  }
  const migrateFlat = (kind, title, prefix, companyFallback) => ({
    id: newSigPartyId(),
    kind,
    title,
    company: s[`${prefix}Company`] || companyFallback || '',
    rows: [
      { id: newSigRowId(), label: 'Name & Surname',  value: s[`${prefix}Name`]        || '', signatureFile: null, signatureUrl: null },
      { id: newSigRowId(), label: 'Post Designation', value: s[`${prefix}Designation`] || '', signatureFile: null, signatureUrl: null },
      { id: newSigRowId(), label: 'Signature',        value: '',                            signatureFile: null, signatureUrl: null },
      { id: newSigRowId(), label: 'Date',             value: s[`${prefix}Date`]        || '', signatureFile: null, signatureUrl: null },
      { id: newSigRowId(), label: 'Location',         value: s[`${prefix}Location`]    || '', signatureFile: null, signatureUrl: null },
    ],
  });
  return {
    parties: [
      migrateFlat('client',   'Client',           'client',   defaultClientName),
      migrateFlat('provider', 'Service Provider', 'provider', ''),
    ],
  };
}

function defaultsForClient(clientName, { template = false } = {}) {
  const v = JSON.parse(JSON.stringify(EMPTY));
  v.cover.clientName = clientName || '';
  // Templates have no fixed submission date — they're reused across many
  // SOWs. The date is stamped by the backend on the first save of a real
  // SOW (and re-stamped on every save thereafter, tracking the version
  // bump). Pre-filling today's date here would bake "now" into the
  // template and surface as a stale date when an author creates a SOW
  // from it months later.
  v.cover.dateOfSubmission = template ? '' : new Date().toISOString().slice(0, 10);
  // JSON.parse strips section + signature ids — regenerate them.
  v.sections = defaultSectionsArray();
  v.signatures = { parties: defaultSigParties() };
  // Seed the client party's company field from the cover, just so it
  // displays right away. The PDF generator re-derives it from the cover
  // on every render so editing the cover keeps the heading in sync.
  if (clientName) v.signatures.parties[0].company = clientName;
  return v;
}

// Normalise a single section value into { body, subsections }.
// Accepts a plain HTML string (oldest format), { body, subsections } shape,
// or a fully-formed section object. Sub-sections may themselves carry a
// `subsubsections` array for Heading 3 entries.
function normaliseSubsubsection(raw) {
  return {
    title:  typeof raw?.title === 'string' ? raw.title : '',
    body:   typeof raw?.body === 'string'  ? raw.body  : '',
    status: normaliseStatus(raw?.status),
  };
}
function normaliseSubsection(raw) {
  return {
    title:  typeof raw?.title === 'string' ? raw.title : '',
    body:   typeof raw?.body  === 'string' ? raw.body  : '',
    status: normaliseStatus(raw?.status),
    subsubsections: Array.isArray(raw?.subsubsections)
      ? raw.subsubsections.map(normaliseSubsubsection)
      : [],
  };
}
function normaliseSectionValue(raw) {
  if (raw == null) return { ...EMPTY_SECTION };
  if (typeof raw === 'string') return { body: raw, subsections: [] };
  return {
    body: typeof raw.body === 'string' ? raw.body : '',
    subsections: Array.isArray(raw.subsections) ? raw.subsections.map(normaliseSubsection) : [],
  };
}

// Normalise the full sections field into an editable array.
//   input may be:
//     - undefined / null  → return the default 13-section starter
//     - a legacy object { executiveSummary: {...}, ... } → array preserving DEFAULT order
//     - an array (current shape) → keep as-is, but ensure each entry has id/title/body/subsections
// Section "status" indicates how a section relates to the template author's
// expectation: 'standard' = boilerplate clause, leave as-is; 'attention' =
// must be tailored for this client; null = no guidance. Set in template
// mode, displayed (read-only) in SOW mode. The same three states apply to
// sub-sections, H3s, section tables, appendices and appendix blocks — the
// shared `normaliseStatus` helper lives in appendix-utils.js.

function normaliseSections(input) {
  if (Array.isArray(input)) {
    return input.map((s, i) => {
      const norm = normaliseSectionValue(s);
      return {
        id: s?.id || newSectionId(),
        title: typeof s?.title === 'string' && s.title.trim()
          ? s.title
          : (DEFAULT_SECTIONS[i]?.title || `Section ${i + 1}`),
        hint: s?.hint || DEFAULT_SECTIONS[i]?.hint || '',
        status: normaliseStatus(s?.status),
        body: norm.body,
        subsections: norm.subsections,
        // Pass-through the raw tables array so the post-normalise step
        // (which wraps them through `normaliseSectionTables`) can read
        // them. We deliberately don't normalise here so the helper that
        // mints fresh ids stays the single source of truth.
        tables: Array.isArray(s?.tables) ? s.tables : [],
      };
    });
  }

  if (input && typeof input === 'object') {
    // Legacy object form — preserve the canonical 13-section order.
    return LEGACY_KEY_ORDER.map((key, i) => {
      const norm = normaliseSectionValue(input[key]);
      return {
        id: newSectionId(),
        title: LEGACY_KEY_TITLES[key],
        hint: DEFAULT_SECTIONS[i]?.hint || '',
        body: norm.body,
        subsections: norm.subsections,
        tables: [],
      };
    });
  }

  return defaultSectionsArray();
}

/**
 * SOW editor — used both for editing a process's SOW and for editing a
 * reusable template.
 *
 *   <SowEditorModal processId={id} ... />        ← SOW mode (default)
 *   <SowEditorModal templateId={id} ... />       ← template mode
 *   <SowEditorModal templateMode templateName="…" templateDescription="…"
 *     templateData={data} onTemplateSave={fn} /> ← in-memory template
 *     (used when creating a brand-new template before it exists in the DB)
 *
 * In template mode:
 *   - data is loaded from / saved to the SowTemplates table, not a process
 *   - the live PDF preview is hidden (templates aren't tied to a saved PDF)
 *   - the signature-image upload is hidden (signatures are per-SOW assets)
 *   - the save button reads "Save template"
 */
export default function SowEditorModal({
  processId, processName, defaultClientName, issuerName, onClose, onSaved,
  // --- template-mode props ---
  templateId,            // load + save against this template id
  templateMode = false,  // explicit override when there's no id yet
  templateName,
  templateDescription,
  templateData,          // initial in-memory data when no id yet
  templateCompanyId,     // owner company id (used for the live PDF preview)
  templateDepartment = 'Procurement', // workspace scope — limits the
                          // "next tasks" picker to templates in this
                          // department only, so HR templates can't be
                          // suggested as successors of Procurement
                          // templates and vice versa
  onTemplateSave,        // (data, { name, description }) → Promise<savedTemplate>
}) {
  const isTemplate = templateMode || templateId != null;
  const [data, setData] = useState(() => defaultsForClient(defaultClientName, { template: isTemplate }));
  const [docUrl, setDocUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  // Template-mode title + description (editable from a tiny banner at the
  // top of the modal). SOW mode ignores these.
  const [tplName, setTplName] = useState(templateName || '');
  const [tplDescription, setTplDescription] = useState(templateDescription || '');
  // Resolved owner-company id used by the preview endpoint. Starts from
  // the prop (so a freshly-created template — no template id yet — works),
  // then falls back to the loaded template's ownerCompanyId for the edit
  // flow.
  const [resolvedTemplateCompanyId, setResolvedTemplateCompanyId] = useState(templateCompanyId ?? null);
  // Workflow successors — ordered list of "next task" steps the author
  // has marked as plausible follow-ups after a task built from this
  // template. Each entry is either `{ templateId }` (resolves to a
  // template the user picks) or `{ label }` (free-text placeholder the
  // user types when the matching template doesn't exist yet, useful
  // for sketching the flow before all templates are authored).
  const [nextSteps, setNextSteps] = useState([]);
  // Pool of templates the author can pick from for the successor list
  // (loaded from the same company-scope as the template library).
  const [companyTemplates, setCompanyTemplates] = useState([]);

  // Pull the pool of available templates whenever we know the owner
  // company id — used to populate the "Possible next tasks" picker in
  // template mode.
  useEffect(() => {
    if (!isTemplate) return;
    if (!resolvedTemplateCompanyId) return;
    let cancelled = false;
    // Scope to the same department as the template being edited so the
    // "next tasks" picker only offers same-workspace candidates.
    api.listSowTemplates(resolvedTemplateCompanyId, templateDepartment)
      .then((list) => { if (!cancelled) setCompanyTemplates(Array.isArray(list) ? list : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isTemplate, resolvedTemplateCompanyId, templateDepartment]);

  // Load existing data — either from the process (SOW mode) or the template.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const loader = isTemplate
      ? (templateId
          ? api.getSowTemplate(templateId).then((t) => ({
              data: t?.data,
              name: t?.name,
              description: t?.description,
              ownerCompanyId: t?.ownerCompanyId,
              nextSteps: Array.isArray(t?.nextSteps)
                ? t.nextSteps
                // Fall back to the legacy template-id list if the server
                // hasn't included nextSteps yet.
                : (Array.isArray(t?.nextTemplateIds) ? t.nextTemplateIds.map((id) => ({ templateId: id })) : []),
            }))
          : Promise.resolve({ data: templateData || null, name: templateName || '', description: templateDescription || '' }))
      : api.getSow(processId).then((res) => ({ data: res?.data, docUrl: res?.docUrl }));

    loader
      .then((res) => {
        if (cancelled) return;
        if (res?.data) {
          const merged = { ...defaultsForClient(defaultClientName, { template: isTemplate }), ...res.data };
          merged.cover = { ...EMPTY.cover, ...(res.data.cover || {}) };
          merged.sections = normaliseSections(res.data.sections);
          merged.tables = { ...EMPTY.tables, ...(res.data.tables || {}) };
          // Migrate every legacy appendix shape into the unified array.
          merged.tables.appendices = normaliseAppendices(merged.tables);
          // Drop the legacy fields so subsequent saves don't carry them.
          delete merged.tables.appendixA;
          delete merged.tables.extraAppendices;
          delete merged.tables.monthlyServiceAllocation;
          // Sections can now hold their own tables — backfill empty arrays.
          merged.sections = merged.sections.map((s) => ({
            ...s, tables: normaliseSectionTables(s.tables),
          }));
          merged.signatures = normaliseSignatures(res.data.signatures, defaultClientName);
          setData(merged);
        }
        if (!isTemplate) setDocUrl(res?.docUrl || null);
        if (isTemplate) {
          if (typeof res?.name === 'string') setTplName(res.name);
          if (typeof res?.description === 'string') setTplDescription(res.description);
          if (Number.isFinite(res?.ownerCompanyId)) setResolvedTemplateCompanyId(res.ownerCompanyId);
          if (Array.isArray(res?.nextSteps)) setNextSteps(res.nextSteps);
        }
      })
      .catch((e) => setErr(e.message))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [processId, templateId, isTemplate, defaultClientName]);

  // Patch one key on the nested `cover.fullPage` block (overrides for
  // the full cover page's individual elements). Blank string values are
  // stored as empty strings; the renderer treats them as "fall back to
  // default" so they're effectively unset.
  function setCoverFullPage(key, value) {
    setData((d) => ({
      ...d,
      cover: {
        ...d.cover,
        fullPage: { ...(d.cover?.fullPage || {}), [key]: value },
      },
    }));
  }
  function setCover(key, value) {
    setData((d) => ({ ...d, cover: { ...d.cover, [key]: value } }));
  }

  // --- Main section helpers (each acts on a section id) ---
  function patchSection(id, patch) {
    setData((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }
  function setSectionBody(id, html)   { patchSection(id, { body: html }); }
  function setSectionTitle(id, title) { patchSection(id, { title }); }
  function setSectionStatus(id, status) { patchSection(id, { status: status || null }); }
  function moveSection(id, delta) {
    setData((d) => {
      const idx = d.sections.findIndex((s) => s.id === id);
      if (idx < 0) return d;
      const next = idx + delta;
      if (next < 0 || next >= d.sections.length) return d;
      const arr = d.sections.slice();
      const [s] = arr.splice(idx, 1);
      arr.splice(next, 0, s);
      return { ...d, sections: arr };
    });
  }
  function removeSection(id) {
    setData((d) => ({ ...d, sections: d.sections.filter((s) => s.id !== id) }));
  }
  function addSection() {
    const newOne = { id: newSectionId(), title: 'New section', hint: '', body: '', subsections: [] };
    setData((d) => ({ ...d, sections: [...d.sections, newOne] }));
  }

  // --- Section-level tables (each section can hold zero or more) ---
  function patchSectionTables(id, mutator) {
    setData((d) => ({
      ...d,
      sections: d.sections.map((s) => s.id === id ? {
        ...s,
        tables: mutator(Array.isArray(s.tables) ? s.tables : []),
      } : s),
    }));
  }
  function addSectionTable(id)              { patchSectionTables(id, (arr) => [...arr, blankSectionTable()]); }
  function updateSectionTable(id, ti, patch){ patchSectionTables(id, (arr) => arr.map((t, i) => i === ti ? { ...t, ...patch } : t)); }
  async function removeSectionTable(id, ti) {
    if (!(await confirmDialog({
      title: 'Remove this table?',
      body: 'Its rows are removed from the section.',
      tone: 'danger',
      confirmLabel: 'Remove table',
    }))) return;
    patchSectionTables(id, (arr) => arr.filter((_, i) => i !== ti));
  }
  function moveSectionTable(id, ti, delta) {
    patchSectionTables(id, (arr) => {
      const next = ti + delta;
      if (next < 0 || next >= arr.length) return arr;
      const out = arr.slice();
      const [t] = out.splice(ti, 1);
      out.splice(next, 0, t);
      return out;
    });
  }

  // --- Sub-section helpers (act on parent section id + sub index) ---
  function addSubsection(id) {
    setData((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.id === id ? { ...s, subsections: [...s.subsections, { title: '', body: '', subsubsections: [] }] } : s,
      ),
    }));
  }
  function updateSubsection(id, index, patch) {
    setData((d) => ({
      ...d,
      sections: d.sections.map((s) => s.id === id ? {
        ...s,
        subsections: s.subsections.map((sub, i) => (i === index ? { ...sub, ...patch } : sub)),
      } : s),
    }));
  }
  function removeSubsection(id, index) {
    setData((d) => ({
      ...d,
      sections: d.sections.map((s) => s.id === id ? {
        ...s,
        subsections: s.subsections.filter((_, i) => i !== index),
      } : s),
    }));
  }

  // --- Sub-sub-section (H3) helpers — scoped to a section + sub index ---
  function patchSubsubs(sectionId, subIndex, mutator) {
    setData((d) => ({
      ...d,
      sections: d.sections.map((s) => s.id === sectionId ? {
        ...s,
        subsections: s.subsections.map((sub, i) => i === subIndex ? {
          ...sub,
          subsubsections: mutator(Array.isArray(sub.subsubsections) ? sub.subsubsections : []),
        } : sub),
      } : s),
    }));
  }
  function addSubsubsection(sectionId, subIndex) {
    patchSubsubs(sectionId, subIndex, (arr) => [...arr, { title: '', body: '' }]);
  }
  function updateSubsubsection(sectionId, subIndex, subsubIndex, patch) {
    patchSubsubs(sectionId, subIndex, (arr) => arr.map((x, i) => i === subsubIndex ? { ...x, ...patch } : x));
  }
  function removeSubsubsection(sectionId, subIndex, subsubIndex) {
    patchSubsubs(sectionId, subIndex, (arr) => arr.filter((_, i) => i !== subsubIndex));
  }
  // ---- Signature party helpers (party-id keyed) ----
  // The signatures payload is `{ parties: [{ id, kind, title, company,
  // rows: [...] }, ...] }`. All helpers below operate on a party by its
  // id; the editor renders one card per party and lets the author add,
  // reorder, rename or remove any of them.
  function patchSigParties(mutator) {
    setData((d) => ({
      ...d,
      signatures: {
        ...d.signatures,
        parties: mutator(Array.isArray(d.signatures?.parties) ? d.signatures.parties : []),
      },
    }));
  }
  function patchSigParty(partyId, patch) {
    patchSigParties((parties) => parties.map((p) => (p.id === partyId ? { ...p, ...patch } : p)));
  }
  function addSigParty() {
    patchSigParties((parties) => [
      ...parties,
      { id: newSigPartyId(), kind: 'custom', title: 'Additional party', company: '', rows: defaultSigRows() },
    ]);
  }
  async function removeSigParty(partyId) {
    // Ask first, then patch. The confirm used to live inside the state
    // updater, which made it a side effect of rendering — StrictMode calls an
    // updater twice, so the dialog appeared twice.
    const parties = Array.isArray(data.signatures?.parties) ? data.signatures.parties : [];
    const target = parties.find((p) => p.id === partyId);
    if (!target) return;
    if (!(await confirmDialog({
      title: `Remove "${target.title || 'Untitled'}"?`,
      body: 'The whole signature block goes with it, including any rows beneath.',
      tone: 'danger',
      confirmLabel: 'Remove party',
    }))) return;
    patchSigParties((current) => current.filter((p) => p.id !== partyId));
  }
  function moveSigParty(partyId, delta) {
    patchSigParties((parties) => {
      const idx = parties.findIndex((p) => p.id === partyId);
      if (idx < 0) return parties;
      const next = idx + delta;
      if (next < 0 || next >= parties.length) return parties;
      const arr = parties.slice();
      const [p] = arr.splice(idx, 1);
      arr.splice(next, 0, p);
      return arr;
    });
  }
  function patchSigRow(partyId, rowId, patch) {
    setData((d) => ({
      ...d,
      signatures: {
        ...d.signatures,
        parties: d.signatures.parties.map((p) => p.id === partyId ? {
          ...p,
          rows: p.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
        } : p),
      },
    }));
  }
  function addSigRow(partyId) {
    setData((d) => ({
      ...d,
      signatures: {
        ...d.signatures,
        parties: d.signatures.parties.map((p) => p.id === partyId ? {
          ...p,
          rows: [...p.rows, { id: newSigRowId(), label: '', value: '', signatureFile: null, signatureUrl: null }],
        } : p),
      },
    }));
  }
  function removeSigRow(partyId, rowId) {
    setData((d) => ({
      ...d,
      signatures: {
        ...d.signatures,
        parties: d.signatures.parties.map((p) => p.id === partyId ? {
          ...p,
          rows: p.rows.filter((r) => r.id !== rowId),
        } : p),
      },
    }));
  }
  function moveSigRow(partyId, rowId, delta) {
    setData((d) => ({
      ...d,
      signatures: {
        ...d.signatures,
        parties: d.signatures.parties.map((p) => {
          if (p.id !== partyId) return p;
          const idx = p.rows.findIndex((r) => r.id === rowId);
          if (idx < 0) return p;
          const next = idx + delta;
          if (next < 0 || next >= p.rows.length) return p;
          const arr = p.rows.slice();
          const [r] = arr.splice(idx, 1);
          arr.splice(next, 0, r);
          return { ...p, rows: arr };
        }),
      },
    }));
  }
  async function uploadSigRowImage(partyId, rowId, file) {
    if (!file) return;
    try {
      const res = await api.uploadSowSignature(processId, file);
      patchSigRow(partyId, rowId, { signatureFile: res.filename, signatureUrl: res.url });
    } catch (e) {
      setErr(e.message);
    }
  }
  function setTable(key, grid) {
    setData((d) => ({ ...d, tables: { ...d.tables, [key]: grid } }));
  }

  async function save() {
    setBusy(true);
    setErr('');
    try {
      if (isTemplate) {
        if (!tplName.trim()) {
          setErr('Template needs a name.');
          setBusy(false);
          return;
        }
        let saved;
        if (templateId) {
          saved = await api.updateSowTemplate(templateId, {
            name: tplName.trim(),
            description: tplDescription || '',
            data,
            nextSteps,
          });
        } else if (typeof onTemplateSave === 'function') {
          saved = await onTemplateSave(data, {
            name: tplName.trim(),
            description: tplDescription || '',
            nextSteps,
          });
        }
        onSaved?.(saved);
      } else {
        const res = await api.saveSow(processId, data);
        // The backend auto-bumps cover.version on every save (1.0 → 1.1 → …)
        // and re-stamps cover.dateOfSubmission to today. Pull both back into
        // state so the editor reflects the new version + date without
        // having to be reopened — same behaviour the user sees in the
        // generated PDF.
        if (res?.data?.cover) {
          setData((d) => ({
            ...d,
            cover: {
              ...d.cover,
              ...(res.data.cover.version          ? { version: res.data.cover.version }                   : {}),
              ...(res.data.cover.dateOfSubmission ? { dateOfSubmission: res.data.cover.dateOfSubmission } : {}),
            },
          }));
        }
        setDocUrl(res.docUrl);
        onSaved?.(res);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAndDownload() {
    if (isTemplate) return; // not applicable
    await save();
    const latest = await api.getSow(processId);
    if (latest.docUrl) window.open(latest.docUrl, '_blank');
  }

  // SOW-mode title uses the task's name (passed in from the whiteboard)
  // so each task's editor reads "<task name>" instead of always "Scope
  // of Work". Falls back to the generic label if the parent hasn't
  // wired processName through.
  const modalTitle = isTemplate
    ? (templateId || tplName ? `Template · ${tplName || 'Untitled'}` : 'New task template')
    : (processName?.trim() || 'Scope of Work');

  if (loading) {
    return (
      <Modal title={modalTitle} onClose={onClose} dismissOnBackdrop={false}>
        <div className="muted">Loading…</div>
      </Modal>
    );
  }

  return (
    // dismissOnBackdrop={false} so an accidental click on the narrow strip
    // outside the wide editor card doesn't drop in-progress edits — the user
    // has to use the × button, the Close button, or Escape.
    <Modal title={modalTitle} onClose={onClose} dismissOnBackdrop={false}>
      <div className="sow-editor">
        {err && <div className="error">{err}</div>}

        {isTemplate && (
          <div className="template-banner">
            <div className="field-row" style={{ marginBottom: 0 }}>
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="tpl-name">Template name</label>
                <input
                  id="tpl-name"
                  type="text"
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="e.g. Standard SOW"
                />
              </div>
              <div className="field" style={{ flex: 3 }}>
                <label htmlFor="tpl-desc">Description (optional)</label>
                <input
                  id="tpl-desc"
                  type="text"
                  value={tplDescription}
                  onChange={(e) => setTplDescription(e.target.value)}
                  placeholder="When to use this template"
                />
              </div>
            </div>
            <small className="muted">
              You're editing a reusable template. Saved changes don't affect SOWs that have already been created from it.
            </small>

            {/* Workflow successors — ordered list of possible "next
                tasks" after a task created from this template. Each
                step is either a pick from the template library OR a
                free-text label for a step whose template doesn't exist
                yet (useful for sketching the flow before all templates
                are authored). The whiteboard renders the steps as
                greyed ghost cards branching off the source task. */}
            <div className="field" style={{ marginTop: 12 }}>
              <label>Possible next tasks (workflow)</label>
              <NextStepsEditor
                steps={nextSteps}
                allTemplates={companyTemplates}
                excludeId={templateId}
                onChange={setNextSteps}
              />
              <small className="muted">
                Each step appears as a greyed ghost card branching off any task created from <em>this</em> template.
                Pick a template for steps that exist, or type a placeholder label to sketch a step you'll author later.
              </small>
            </div>
          </div>
        )}

        <p className="muted" style={{ marginTop: 0 }}>
          Fill in the values below. Use the toolbar inside each section for <strong>bold</strong> and bullet points.
          Tables for the two appendices can be built by adding rows and columns at the bottom.
          When you save, a PDF is generated — the live preview below shows you exactly what the final document will look like.
        </p>

        <h3 className="sow-h3">{(data.cover?.style === 'heading-only') ? 'Document heading' : 'Cover page'}</h3>

        {/* Cover-style toggle. A "Full cover page" produces the formal first
            page with parties, date, version table etc. — best for legal
            documents like SOWs. A "Heading only" style drops in a single
            Heading-1 line at the top of page 1 and the sections flow
            immediately underneath — best for policies, briefs, and other
            shorter documents that don't need a full title page. */}
        <div className="field cover-style-toggle">
          <label>Front-page style</label>
          <div className="radio-row">
            <label className="radio-card">
              <input
                type="radio"
                name="cover-style"
                value="full"
                checked={(data.cover?.style || 'full') === 'full'}
                onChange={() => setCover('style', 'full')}
              />
              <span>
                <strong>Full cover page</strong>
                <small className="muted"> — title, parties, date and version table on its own page.</small>
              </span>
            </label>
            <label className="radio-card">
              <input
                type="radio"
                name="cover-style"
                value="heading-only"
                checked={data.cover?.style === 'heading-only'}
                onChange={() => setCover('style', 'heading-only')}
              />
              <span>
                <strong>Heading only</strong>
                <small className="muted"> — a single Heading 1 at the top; sections start right below it.</small>
              </span>
            </label>
          </div>
        </div>

        <div className="field" style={{ marginTop: 6 }}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={(data.cover?.includeToc ?? true) === true}
              onChange={(e) => setCover('includeToc', e.target.checked)}
            />
            <span>
              <strong>Include table of contents</strong>
              <small className="muted"> — auto-generated from the section list, with page numbers and dot leaders. Turn off for short documents.</small>
            </span>
          </label>
        </div>

        {(data.cover?.style === 'heading-only') ? (
          <div className="field">
            <label htmlFor="sow-heading">Document heading</label>
            <input
              id="sow-heading"
              type="text"
              value={data.cover?.headingText || ''}
              onChange={(e) => setCover('headingText', e.target.value)}
              placeholder="e.g. Information Security Policy"
            />
            <small className="muted">Rendered as Heading 1 at the top of page 1. No separate cover page is generated.</small>
          </div>
        ) : (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="sow-client">Client name</label>
                <input id="sow-client" type="text" value={data.cover.clientName || ''}
                       onChange={(e) => setCover('clientName', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="sow-subtitle">Cover subtitle (optional)</label>
                <input id="sow-subtitle" type="text" value={data.cover.subtitle || ''}
                       onChange={(e) => setCover('subtitle', e.target.value)}
                       placeholder="e.g. AFMA Application Take-over" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="sow-date">Date of submission</label>
                {isTemplate ? (
                  // Templates have no version cycle, so the author owns the
                  // date — usually leave it blank and let SOWs created from
                  // the template stamp their own date on first save.
                  <input
                    id="sow-date"
                    type="date"
                    value={data.cover.dateOfSubmission || ''}
                    onChange={(e) => setCover('dateOfSubmission', e.target.value)}
                  />
                ) : (
                  <>
                    <input
                      id="sow-date"
                      type="date"
                      value={data.cover.dateOfSubmission || ''}
                      readOnly
                      tabIndex={-1}
                      className="readonly-input"
                      aria-readonly="true"
                    />
                    <small className="muted">
                      Stamped by the server on every save — moves to today
                      each time the version bumps.
                    </small>
                  </>
                )}
              </div>
              {/* Templates don't need a version field — the version is
                  auto-bumped per-SOW, not per-template. Show it only in
                  SOW mode. */}
              {!isTemplate && (
                <div className="field">
                  <label htmlFor="sow-version">Version number</label>
                  <input
                    id="sow-version"
                    type="text"
                    value={data.cover.version || '1.0'}
                    readOnly
                    tabIndex={-1}
                    className="readonly-input"
                    aria-readonly="true"
                  />
                  <small className="muted">
                    Auto-versioned by the server: <strong>V1.0</strong> on the first save, then <strong>1.1, 1.2, 1.3…</strong> on every re-save.
                    The version is read-only and can't be overwritten.
                  </small>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="sow-revision">Revision note (optional)</label>
              <input id="sow-revision" type="text" value={data.cover.revision || ''}
                     onChange={(e) => setCover('revision', e.target.value)}
                     placeholder="e.g. Final issue · 11 May 2026" />
            </div>

            {/* Cover-page customisation — overrides individual elements
                of the full cover page. Each field is OPTIONAL: leave it
                blank and the renderer falls back to the default SOW-style
                wording, so the Scope of Work template's cover keeps its
                existing look. Authors writing other documents (employment
                contracts, workplace amendments, etc.) can fill these in
                to tailor the cover to their use case. */}
            <details className="cover-customise">
              <summary>Customise cover page content (optional)</summary>
              <div className="cover-customise-body">
                <div className="field">
                  <label htmlFor="cv-doc-title">Document title</label>
                  <input
                    id="cv-doc-title"
                    type="text"
                    value={data.cover?.fullPage?.documentTitle || ''}
                    onChange={(e) => setCoverFullPage('documentTitle', e.target.value)}
                    placeholder="Statement of Work"
                  />
                  <small className="muted">Big H1 below the issuer/client line. Defaults to "Statement of Work".</small>
                </div>
                <div className="field">
                  <label htmlFor="cv-intro">Intro line</label>
                  <input
                    id="cv-intro"
                    type="text"
                    value={data.cover?.fullPage?.introText || ''}
                    onChange={(e) => setCoverFullPage('introText', e.target.value)}
                    placeholder="Entered into by and between"
                  />
                </div>
                <div className="cover-customise-parties">
                  <div className="cover-customise-party">
                    <strong className="cover-customise-party-title">Party 1 (issuer / company)</strong>
                    <div className="field">
                      <label htmlFor="cv-party1-a">Descriptor — line 1</label>
                      <input
                        id="cv-party1-a"
                        type="text"
                        value={data.cover?.fullPage?.party1Label || ''}
                        onChange={(e) => setCoverFullPage('party1Label', e.target.value)}
                        placeholder='(hereinafter referred to as "Contractor")'
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="cv-party1-b">Descriptor — line 2 (optional)</label>
                      <input
                        id="cv-party1-b"
                        type="text"
                        value={data.cover?.fullPage?.party1Label2 || ''}
                        onChange={(e) => setCoverFullPage('party1Label2', e.target.value)}
                        placeholder="e.g. ID number, address, contact details"
                      />
                    </div>
                  </div>
                  <div className="cover-customise-party">
                    <strong className="cover-customise-party-title">Party 2 (client / counterparty)</strong>
                    <div className="field">
                      <label htmlFor="cv-party2-a">Descriptor — line 1</label>
                      <input
                        id="cv-party2-a"
                        type="text"
                        value={data.cover?.fullPage?.party2Label || ''}
                        onChange={(e) => setCoverFullPage('party2Label', e.target.value)}
                        placeholder='(hereinafter referred to as "the Client")'
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="cv-party2-b">Descriptor — line 2 (optional)</label>
                      <input
                        id="cv-party2-b"
                        type="text"
                        value={data.cover?.fullPage?.party2Label2 || ''}
                        onChange={(e) => setCoverFullPage('party2Label2', e.target.value)}
                        placeholder="e.g. ID number, address, contact details"
                      />
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="cv-connector">Connector text between parties</label>
                  <input
                    id="cv-connector"
                    type="text"
                    value={data.cover?.fullPage?.connectorText || ''}
                    onChange={(e) => setCoverFullPage('connectorText', e.target.value)}
                    placeholder="and"
                  />
                </div>
                <div className="field">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={data.cover?.fullPage?.showRegistrationNumber !== false}
                      onChange={(e) => setCoverFullPage('showRegistrationNumber', e.target.checked)}
                    />
                    <span>
                      <strong>Show issuer registration number</strong>
                      <small className="muted"> — turns the "Registration number: …" line on the cover on or off.</small>
                    </span>
                  </label>
                </div>
                <div className="field">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={data.cover?.fullPage?.showDateVersionTable !== false}
                      onChange={(e) => setCoverFullPage('showDateVersionTable', e.target.checked)}
                    />
                    <span>
                      <strong>Show Date / Version table</strong>
                      <small className="muted"> — the bordered table at the bottom of the cover. Turn off for documents that don't need a versioned date stamp.</small>
                    </span>
                  </label>
                </div>
              </div>
            </details>
          </>
        )}

        {isTemplate && (
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            <strong>Tip:</strong> Use the <em>Standard</em> / <em>Needs attention</em> badges on each section
            to tell SOW authors which clauses are boilerplate and which must be tailored per client.
          </p>
        )}

        <h3 className="sow-h3">Sections</h3>
        {data.sections.map((section, sIndex) => {
          const sectionNumber = sIndex + 1;
          const isFirst = sIndex === 0;
          const isLast  = sIndex === data.sections.length - 1;
          const status  = section.status || null;
          return (
            <div className={'sow-section status-' + (status || 'default')} key={section.id}>
              <div className="sow-section-head">
                <span className="sow-section-num">{sectionNumber}.</span>
                <input
                  type="text"
                  className="sow-section-title-input"
                  placeholder="Section title"
                  value={section.title}
                  onChange={(e) => setSectionTitle(section.id, e.target.value)}
                />
                <AttentionPill
                  status={status}
                  editable={isTemplate}
                  onChange={(next) => setSectionStatus(section.id, next)}
                />
                <div className="sow-section-actions">
                  <button
                    type="button"
                    onClick={() => moveSection(section.id, -1)}
                    disabled={isFirst}
                    aria-label="Move section up"
                    title="Move up"
                  >↑</button>
                  <button
                    type="button"
                    onClick={() => moveSection(section.id, +1)}
                    disabled={isLast}
                    aria-label="Move section down"
                    title="Move down"
                  >↓</button>
                  <button
                    type="button"
                    className="danger"
                    onClick={async () => {
                      if (await confirmDialog({
                        title: `Remove "${section.title || 'Untitled'}"?`,
                        body: 'The section and all its content are removed.',
                        tone: 'danger',
                        confirmLabel: 'Remove section',
                      })) {
                        removeSection(section.id);
                      }
                    }}
                    aria-label="Remove section"
                    title="Remove section"
                  >×</button>
                </div>
              </div>

              <RichTextEditor
                value={section.body}
                onChange={(html) => setSectionBody(section.id, html)}
                placeholder={section.hint || 'Content for this section'}
              />

              {Array.isArray(section.tables) && section.tables.length > 0 && (
                <div className="sow-section-tables">
                  {section.tables.map((tbl, ti) => (
                    <SectionTableBlock
                      key={tbl.id}
                      table={tbl}
                      editable={isTemplate}
                      isFirst={ti === 0}
                      isLast={ti === section.tables.length - 1}
                      onPatch={(patch) => updateSectionTable(section.id, ti, patch)}
                      onMoveUp={() => moveSectionTable(section.id, ti, -1)}
                      onMoveDown={() => moveSectionTable(section.id, ti, +1)}
                      onRemove={() => removeSectionTable(section.id, ti)}
                    />
                  ))}
                </div>
              )}
              <button
                type="button"
                className="sow-add-sub sow-add-section-table"
                onClick={() => addSectionTable(section.id)}
              >
                + Add table
              </button>

              {section.subsections.length > 0 && (
                <div className="sow-subsections">
                  {section.subsections.map((sub, subIndex) => (
                    <div className={'sow-subsection status-' + (sub.status || 'default')} key={subIndex}>
                      <div className="sow-subsection-head">
                        <span className="sow-subsection-num">{sectionNumber}.{subIndex + 1}</span>
                        <input
                          type="text"
                          className="sow-subsection-title"
                          placeholder="Sub-section title"
                          value={sub.title}
                          onChange={(e) => updateSubsection(section.id, subIndex, { title: e.target.value })}
                        />
                        <AttentionPill
                          status={sub.status || null}
                          editable={isTemplate}
                          onChange={(next) => updateSubsection(section.id, subIndex, { status: next || null })}
                        />
                        <button
                          type="button"
                          className="sow-subsection-remove"
                          onClick={() => removeSubsection(section.id, subIndex)}
                          aria-label="Remove sub-section"
                          title="Remove sub-section"
                        >×</button>
                      </div>
                      <RichTextEditor
                        compact
                        value={sub.body}
                        onChange={(html) => updateSubsection(section.id, subIndex, { body: html })}
                        placeholder={`Content for ${sectionNumber}.${subIndex + 1}`}
                      />

                      {/* Heading 3 — sub-sub-sections within this sub-section */}
                      {Array.isArray(sub.subsubsections) && sub.subsubsections.length > 0 && (
                        <div className="sow-subsubsections">
                          {sub.subsubsections.map((subsub, subsubIndex) => (
                            <div className={'sow-subsubsection status-' + (subsub.status || 'default')} key={subsubIndex}>
                              <div className="sow-subsection-head">
                                <span className="sow-subsection-num sow-h3-num">
                                  {sectionNumber}.{subIndex + 1}.{subsubIndex + 1}
                                </span>
                                <input
                                  type="text"
                                  className="sow-subsection-title"
                                  placeholder="Heading 3 title"
                                  value={subsub.title}
                                  onChange={(e) => updateSubsubsection(section.id, subIndex, subsubIndex, { title: e.target.value })}
                                />
                                <AttentionPill
                                  status={subsub.status || null}
                                  editable={isTemplate}
                                  onChange={(next) => updateSubsubsection(section.id, subIndex, subsubIndex, { status: next || null })}
                                />
                                <button
                                  type="button"
                                  className="sow-subsection-remove"
                                  onClick={() => removeSubsubsection(section.id, subIndex, subsubIndex)}
                                  aria-label="Remove H3"
                                  title="Remove H3"
                                >×</button>
                              </div>
                              <RichTextEditor
                                compact
                                value={subsub.body}
                                onChange={(html) => updateSubsubsection(section.id, subIndex, subsubIndex, { body: html })}
                                placeholder={`Content for ${sectionNumber}.${subIndex + 1}.${subsubIndex + 1}`}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        className="sow-add-sub sow-add-h3"
                        onClick={() => addSubsubsection(section.id, subIndex)}
                      >
                        + Add Heading 3
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="sow-add-sub"
                onClick={() => addSubsection(section.id)}
              >
                + Add sub-section
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="sow-add-section"
          onClick={addSection}
        >
          + Add main section
        </button>

        <h3 className="sow-h3">Appendices</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Each appendix is rendered on its own page in document order (A, B, C, …).
          Pick <strong>Project milestone breakdown</strong> for a structured
          milestone table (always landscape, with an optional Gantt chart) or
          <strong> Custom appendix</strong> for one or more H2-headed text /
          table sections (portrait by default, landscape on demand).
        </p>
        <AppendicesEditor
          value={data.tables.appendices}
          editable={isTemplate}
          onChange={(next) => setTable('appendices', next)}
        />

        <h3 className="sow-h3">Signature Control</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          This section always starts on its own page in the generated SOW. Each row below becomes
          one line in the signature table — rename the labels, change the values, drop the rows
          you don't need or add new ones (e.g. <em>Email</em>, <em>ID number</em>, <em>Witness</em>).
          The Service Provider rows are pre-filled from the company's default signatory under
          Branding; you can override any value here.
        </p>

        {(data.signatures?.parties || []).map((party, partyIdx) => {
          const isFirst = partyIdx === 0;
          const isLast  = partyIdx === (data.signatures.parties.length - 1);
          // Display company: for the client / provider kinds we surface the
          // auto-derived value (from the cover or the issuer) so the author
          // can see what'll print. Custom parties just show what the author
          // has typed.
          const autoCompany = party.kind === 'client'   ? (data.cover.clientName || '—')
                            : party.kind === 'provider' ? (issuerName            || '—')
                            : null;
          return (
            <SignatureParty
              key={party.id}
              party={party}
              autoCompanyDisplay={autoCompany}
              isFirst={isFirst}
              isLast={isLast}
              onTitleChange={(title)   => patchSigParty(party.id, { title })}
              onCompanyChange={(company) => patchSigParty(party.id, { company })}
              onMoveUp={()             => moveSigParty(party.id, -1)}
              onMoveDown={()           => moveSigParty(party.id, +1)}
              onRemove={()             => removeSigParty(party.id)}
              onRowPatch={(rowId, patch)   => patchSigRow(party.id, rowId, patch)}
              onRowAdd={()                 => addSigRow(party.id)}
              onRowRemove={(rowId)         => removeSigRow(party.id, rowId)}
              onRowMove={(rowId, delta)    => moveSigRow(party.id, rowId, delta)}
              onRowUpload={(rowId, file)   => uploadSigRowImage(party.id, rowId, file)}
            />
          );
        })}
        <button
          type="button"
          className="btn-ghost sig-add-party"
          onClick={addSigParty}
        >
          + Add signature party
        </button>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Close</button>
          {/* Live preview works in both modes — SOW preview hits the
              per-process endpoint (uses the owning company's branding);
              template preview hits the templates endpoint (uses the
              template's owner company). Template preview is only available
              once we know the owner-company id. */}
          {(!isTemplate || resolvedTemplateCompanyId) && (
            <button type="button" className="btn-ghost" onClick={() => setShowPreview(true)} disabled={busy}>
              👁 Preview
            </button>
          )}
          <button type="button" className={isTemplate ? 'btn-primary' : 'btn-ghost'} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : (isTemplate ? 'Save template' : 'Save')}
          </button>
          {!isTemplate && (
            <button type="button" className="btn-primary" onClick={saveAndDownload} disabled={busy}>
              {busy ? 'Saving…' : 'Save & download PDF'}
            </button>
          )}
        </div>
      </div>

      {showPreview && (
        <SowPreview
          processId={isTemplate ? null : processId}
          templateCompanyId={isTemplate ? resolvedTemplateCompanyId : null}
          // Document name powers the PDF viewer's title bar — task name
          // for SOWs, template name for template previews.
          documentName={isTemplate ? (tplName || '') : (processName || '')}
          data={data}
          onClose={() => setShowPreview(false)}
        />
      )}
    </Modal>
  );
}

// Small badge / inline picker that conveys whether a section is boilerplate
// or needs to be customised per-client.
//   - In template mode (editable=true) the badge cycles through the three
//     states on click and shows a dropdown menu for direct selection.
//   - In SOW mode (editable=false) the badge is purely informational.
// Workflow-step editor — renders an ordered list of "next task" steps.
// Each step is either:
//   • a template pick (dropdown of the company's templates), or
//   • a free-text label the author types when the template doesn't
//     exist yet (placeholder ghost on the whiteboard).
//
// Steps can be added, reordered with ↑/↓ and removed. To convert
// between kinds, just delete the row and add a new one of the other
// kind — the small saving in clicks didn't justify the extra control.
// The template currently being edited is excluded from the template
// dropdown so it can't be its own successor.
// ---------------- Rich text editor ----------------
function RichTextEditor({ value, onChange, placeholder, compact }) {
  const ref = useRef(null);

  // Mount the existing HTML on first render and whenever the value resets
  // externally (load from server). We avoid resetting on every keystroke.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!ref.current) return;
    if (!mountedRef.current || ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
      mountedRef.current = true;
    }
  }, [value]);

  // Configure execCommand to emit clean semantic HTML once on mount.
  useEffect(() => {
    try {
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {}
  }, []);

  // Focus the editor first so the command applies to the current selection.
  function exec(cmd) {
    if (!ref.current) return;
    if (document.activeElement !== ref.current) ref.current.focus();
    try {
      document.execCommand('styleWithCSS', false, false);
    } catch {}
    document.execCommand(cmd, false, null);
    onChange(ref.current.innerHTML);
  }

  function onInput() {
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function onKeyDown(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); exec('bold'); }
    else if (key === 'i') { e.preventDefault(); exec('italic'); }
    else if (key === 'u') { e.preventDefault(); exec('underline'); }
  }

  // Detect whether the caret is currently inside a bullet/numbered list so
  // the toolbar buttons can show an active state.
  const [activeList, setActiveList] = useState(null);
  function refreshActiveList() {
    const sel = document.getSelection();
    if (!sel || !sel.anchorNode || !ref.current?.contains(sel.anchorNode)) {
      setActiveList(null);
      return;
    }
    let node = sel.anchorNode;
    while (node && node !== ref.current) {
      if (node.nodeName === 'UL') { setActiveList('ul'); return; }
      if (node.nodeName === 'OL') {
        // Distinguish plain numbered (1, 2, 3) from alpha (a, b, c) /
        // upper-alpha (A, B, C). The OL's `type` attribute carries the
        // distinction; pdfmake honours the same attribute when rendering.
        const t = node.getAttribute('type') || '';
        if (t === 'a') { setActiveList('ol-a'); return; }
        if (t === 'A') { setActiveList('ol-A'); return; }
        setActiveList('ol');
        return;
      }
      node = node.parentNode;
    }
    setActiveList(null);
  }

  // Toggle the current selection into an ordered list with a specific
  // `type` attribute (`a` for a, b, c; `A` for A, B, C). pdfmake reads
  // the type attribute when rendering the list. We use insertOrderedList
  // first to convert the lines, then walk up to the freshly-created OL
  // node and stamp the type attribute on it.
  function execAlphaList(type) {
    if (!ref.current) return;
    if (document.activeElement !== ref.current) ref.current.focus();
    try { document.execCommand('styleWithCSS', false, false); } catch {}
    document.execCommand('insertOrderedList', false, null);
    const sel = document.getSelection();
    let node = sel?.anchorNode || null;
    while (node && node !== ref.current) {
      if (node.nodeName === 'OL') { node.setAttribute('type', type); break; }
      node = node.parentNode;
    }
    onChange(ref.current.innerHTML);
    refreshActiveList();
  }

  return (
    <div className={'rich-editor' + (compact ? ' rich-editor-compact' : '')}>
      <div className="rich-editor-toolbar">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} title="Bold (Ctrl+B)"><strong>B</strong></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} title="Italic (Ctrl+I)"><em>I</em></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} title="Underline (Ctrl+U)"><u>U</u></button>
        <span className="rich-editor-sep" />
        <button
          type="button"
          className={activeList === 'ul' ? 'is-active' : ''}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('insertUnorderedList')}
          title="Bullet list"
        >• List</button>
        <button
          type="button"
          className={activeList === 'ol' ? 'is-active' : ''}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('insertOrderedList')}
          title="Numbered list"
        >1. List</button>
        <button
          type="button"
          className={activeList === 'ol-a' ? 'is-active' : ''}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execAlphaList('a')}
          title="Alphabetical list (a, b, c)"
        >a. List</button>
        <button
          type="button"
          className={activeList === 'ol-A' ? 'is-active' : ''}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execAlphaList('A')}
          title="Upper-case alphabetical list (A, B, C)"
        >A. List</button>
      </div>
      <div
        ref={ref}
        className="rich-editor-body"
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onKeyDown={onKeyDown}
        onKeyUp={refreshActiveList}
        onMouseUp={refreshActiveList}
        onFocus={refreshActiveList}
        data-placeholder={placeholder || ''}
      />
    </div>
  );
}

// ---------------- Table builder ----------------
function TableBuilder({ grid, onChange }) {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;

  function updateCell(r, c, value) {
    const next = grid.map((row, i) => row.map((cell, j) => (i === r && j === c ? value : cell)));
    onChange(next);
  }
  function addRow() {
    onChange([...grid, new Array(cols).fill('')]);
  }
  function addColumn() {
    onChange(grid.map((row) => [...row, '']));
  }
  function removeRow(r) {
    if (rows <= 1) return;
    onChange(grid.filter((_, i) => i !== r));
  }
  function removeColumn(c) {
    if (cols <= 1) return;
    onChange(grid.map((row) => row.filter((_, j) => j !== c)));
  }

  return (
    <div className="sow-table-builder">
      <div className="sow-table-wrap">
        <table>
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={r === 0 ? 'is-header' : ''}>
                    <input
                      type="text"
                      value={cell}
                      onChange={(e) => updateCell(r, c, e.target.value)}
                      placeholder={r === 0 ? 'Header' : ''}
                    />
                  </td>
                ))}
                <td className="sow-table-rowctl">
                  <button type="button" onClick={() => removeRow(r)} disabled={rows <= 1} title="Remove row">−</button>
                </td>
              </tr>
            ))}
            <tr>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="sow-table-colctl">
                  <button type="button" onClick={() => removeColumn(c)} disabled={cols <= 1} title="Remove column">−</button>
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sow-table-actions">
        <button type="button" className="btn-ghost" onClick={addRow}>+ Add row</button>
        <button type="button" className="btn-ghost" onClick={addColumn}>+ Add column</button>
        <span className="muted small">The first row is rendered as the table header in the Word document.</span>
      </div>
    </div>
  );
}

// ---------------- Appendices editor (Appendix B onwards) ----------------
// Renders the dynamic list of extra appendices. Appendix A is the fixed
// landscape milestones block and is rendered separately; entries here
// become "Appendix B", "Appendix C", "Appendix D", … in document order.
function AppendicesEditor({ value, editable, onChange }) {
  const list = Array.isArray(value) ? value : [];

  function patch(id, fn) { onChange(list.map((a) => (a.id === id ? fn(a) : a))); }
  function addCustom()    { onChange([...list, blankCustomAppendix()]); }
  function addMilestone() { onChange([...list, blankMilestoneAppendix()]); }
  function remove(id) { onChange(list.filter((a) => a.id !== id)); }
  function move(id, delta) {
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const next = idx + delta;
    if (next < 0 || next >= list.length) return;
    const arr = list.slice();
    const [item] = arr.splice(idx, 1);
    arr.splice(next, 0, item);
    onChange(arr);
  }

  return (
    <div className="appendices">
      {list.length === 0 && (
        <div className="muted appendices-empty">
          No appendices yet. Add one using the buttons below.
        </div>
      )}
      {list.map((appx, idx) => {
        const letter = appendixLetter(idx);
        return (
          <AppendixBlock
            key={appx.id}
            appx={appx}
            letter={letter}
            editable={editable}
            isFirst={idx === 0}
            isLast={idx === list.length - 1}
            onPatch={(patchObj) => patch(appx.id, (a) => ({ ...a, ...patchObj }))}
            onMoveUp={()        => move(appx.id, -1)}
            onMoveDown={()      => move(appx.id, +1)}
            onRemove={async () => {
              if (await confirmDialog({
                title: `Remove Appendix ${letter}?`,
                body: `"${appx.title || 'Untitled'}" and everything inside it are removed.`,
                tone: 'danger',
                confirmLabel: 'Remove appendix',
              })) {
                remove(appx.id);
              }
            }}
          />
        );
      })}
      <div className="appendices-add-row">
        <button type="button" className="btn-ghost" onClick={addCustom}>
          + Add custom appendix
        </button>
        <button type="button" className="btn-ghost" onClick={addMilestone}>
          + Add milestone breakdown
        </button>
      </div>
    </div>
  );
}

function AppendixBlock({ appx, letter, editable, isFirst, isLast, onPatch, onMoveUp, onMoveDown, onRemove }) {
  const type = appx.type === 'milestones' ? 'milestones' : 'custom';

  async function onTypeChange(nextType) {
    if (nextType === type) return;
    // Switching type preserves title but resets type-specific payload to a
    // sane default. We confirm because the user could lose work otherwise.
    const wasFilled = type === 'custom'
      ? (appx.blocks?.length > 0 && appx.blocks.some((b) => (b.heading || b.body || (b.grid?.flat().some((c) => c)))))
      : (appx.projects?.length > 0);
    if (wasFilled && !(await confirmDialog({
      title: 'Discard the current content?',
      body: `Switching type discards the current ${type === 'custom' ? 'tables and sections' : 'milestones'}.`,
      tone: 'danger',
      confirmLabel: 'Switch type',
    }))) return;
    if (nextType === 'milestones') {
      onPatch({ type: 'milestones', orientation: 'landscape', defaultTariff: appx.defaultTariff ?? 750, projects: [], includeGantt: true, blocks: [] });
    } else {
      onPatch({ type: 'custom', orientation: 'portrait', blocks: [blankTableBlock()] });
    }
  }

  return (
    <div className={'appendix-block appendix-type-' + type + ' status-' + (appx.status || 'default')}>
      <div className="appendix-head">
        <span className="appendix-letter">Appendix {letter}</span>
        <input
          type="text"
          className="appendix-title-input"
          value={appx.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder={type === 'milestones'
            ? 'e.g. Detailed Milestone Breakdown, Cost & Timeline Allocation'
            : 'e.g. Client Onboarding and Financial Setup Information'}
        />
        <AttentionPill
          status={appx.status || null}
          editable={editable}
          onChange={(next) => onPatch({ status: next || null })}
        />
        <div className="appendix-type">
          <label>
            <span className="muted small" style={{ marginRight: 4 }}>Type:</span>
            <select value={type} onChange={(e) => onTypeChange(e.target.value)}>
              <option value="custom">Custom appendix</option>
              <option value="milestones">Project milestone breakdown</option>
            </select>
          </label>
        </div>
        {type === 'custom' && (
          <div className="appendix-orientation">
            <label title="Pick portrait for text-heavy appendices, landscape for wide tables">
              <span className="muted small" style={{ marginRight: 4 }}>Layout:</span>
              <select value={appx.orientation} onChange={(e) => onPatch({ orientation: e.target.value })}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
          </div>
        )}
        <div className="appendix-actions">
          <button type="button" className="btn-icon" disabled={isFirst} onClick={onMoveUp}   title="Move up">↑</button>
          <button type="button" className="btn-icon" disabled={isLast}  onClick={onMoveDown} title="Move down">↓</button>
          <button type="button" className="btn-icon btn-icon-danger"    onClick={onRemove}   title="Remove appendix">×</button>
        </div>
      </div>

      {type === 'milestones' ? (
        <div className="appendix-body">
          <label className="checkbox-row" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={appx.includeGantt !== false}
              onChange={(e) => onPatch({ includeGantt: e.target.checked })}
            />
            <span>
              <strong>Include a Gantt chart</strong>
              <small className="muted"> — adds a timeline page after the milestone table.</small>
            </span>
          </label>
          <MilestoneTableEditor
            value={{ defaultTariff: appx.defaultTariff ?? 750, projects: appx.projects ?? [] }}
            onChange={(next) => onPatch({ defaultTariff: next.defaultTariff, projects: next.projects })}
          />
        </div>
      ) : (
        <CustomAppendixBlocks
          blocks={Array.isArray(appx.blocks) ? appx.blocks : []}
          editable={editable}
          onChange={(blocks) => onPatch({ blocks })}
        />
      )}
    </div>
  );
}

function CustomAppendixBlocks({ blocks, editable, onChange }) {
  function patchBlock(id, fn) { onChange(blocks.map((b) => (b.id === id ? fn(b) : b))); }
  function addTable()         { onChange([...blocks, blankTableBlock()]); }
  function addText()          { onChange([...blocks, blankTextBlock()]); }
  async function removeBlock(id) {
    if (await confirmDialog({
      title: 'Remove this block?',
      tone: 'danger',
      confirmLabel: 'Remove block',
    })) onChange(blocks.filter((b) => b.id !== id));
  }
  function moveBlock(id, delta) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const next = idx + delta;
    if (next < 0 || next >= blocks.length) return;
    const arr = blocks.slice();
    const [item] = arr.splice(idx, 1);
    arr.splice(next, 0, item);
    onChange(arr);
  }

  return (
    <div className="appendix-blocks">
      {blocks.length === 0 && (
        <div className="muted small" style={{ padding: 8 }}>
          No content yet. Add a text section or a table below.
        </div>
      )}
      {blocks.map((blk, bIdx) => (
        <div key={blk.id} className={'appendix-table-block appendix-block-type-' + blk.type + ' status-' + (blk.status || 'default')}>
          <div className="appendix-table-head">
            <input
              type="text"
              className="appendix-table-heading-input"
              value={blk.heading || ''}
              onChange={(e) => patchBlock(blk.id, (b) => ({ ...b, heading: e.target.value }))}
              placeholder={blk.type === 'text'
                ? 'Heading 2 (text section title)'
                : 'Heading 2 (e.g. Client Entity Information)'}
            />
            <span className="appendix-block-typebadge">{blk.type === 'text' ? 'Text' : 'Table'}</span>
            <AttentionPill
              status={blk.status || null}
              editable={editable}
              onChange={(next) => patchBlock(blk.id, (b) => ({ ...b, status: next || null }))}
            />
            <div className="appendix-table-actions">
              <button type="button" className="btn-icon" disabled={bIdx === 0}                       onClick={() => moveBlock(blk.id, -1)} title="Move up">↑</button>
              <button type="button" className="btn-icon" disabled={bIdx === blocks.length - 1}      onClick={() => moveBlock(blk.id, +1)} title="Move down">↓</button>
              <button type="button" className="btn-icon btn-icon-danger"                             onClick={() => removeBlock(blk.id)} title="Remove">×</button>
            </div>
          </div>
          {blk.type === 'text' ? (
            <RichTextEditor
              value={blk.body || ''}
              onChange={(html) => patchBlock(blk.id, (b) => ({ ...b, body: html }))}
              placeholder="Body text…"
            />
          ) : (
            <>
              <textarea
                className="appendix-block-description"
                value={blk.description || ''}
                onChange={(e) => patchBlock(blk.id, (b) => ({ ...b, description: e.target.value }))}
                placeholder="Description (optional, rendered as body text below the heading and above the table)"
                rows={2}
              />
              <TableBuilder
                grid={blk.grid}
                onChange={(g) => patchBlock(blk.id, (b) => ({ ...b, grid: g }))}
              />
            </>
          )}
        </div>
      ))}
      <div className="appendix-blocks-add-row">
        <button type="button" className="btn-ghost" onClick={addText}>+ Add text section</button>
        <button type="button" className="btn-ghost" onClick={addTable}>+ Add table</button>
      </div>
    </div>
  );
}

// Single section-level table editor — Heading 3 + optional description +
// 2-D grid. The heading renders as an H3 in the PDF, the description as
// body text (only when filled in), and the grid as a regular table.
function SectionTableBlock({ table, editable, isFirst, isLast, onPatch, onMoveUp, onMoveDown, onRemove }) {
  return (
    <div className={'sow-section-table status-' + (table.status || 'default')}>
      <div className="sow-section-table-head">
        <input
          type="text"
          className="sow-section-table-heading"
          value={table.heading || ''}
          onChange={(e) => onPatch({ heading: e.target.value })}
          placeholder="Heading 3 (table title)"
        />
        <AttentionPill
          status={table.status || null}
          editable={editable}
          onChange={(next) => onPatch({ status: next || null })}
        />
        <div className="sow-section-table-actions">
          <button type="button" className="btn-icon" disabled={isFirst} onClick={onMoveUp}   title="Move up">↑</button>
          <button type="button" className="btn-icon" disabled={isLast}  onClick={onMoveDown} title="Move down">↓</button>
          <button type="button" className="btn-icon btn-icon-danger"    onClick={onRemove}   title="Remove table">×</button>
        </div>
      </div>
      <textarea
        className="appendix-block-description"
        value={table.description || ''}
        onChange={(e) => onPatch({ description: e.target.value })}
        placeholder="Description (optional, rendered as body text below the heading and above the table)"
        rows={2}
      />
      <TableBuilder
        grid={table.grid}
        onChange={(g) => onPatch({ grid: g })}
      />
    </div>
  );
}

// ---------------- SOW preview (native PDF render via iframe) ----------------
// The backend generates the same PDF that will be saved/downloaded, so the
// preview is byte-identical to the final artefact. Browsers render PDFs in
// <iframe> using their built-in viewer (Chrome/Edge/Firefox/Safari all do).
function SowPreview({ processId, templateCompanyId, documentName, data, onClose }) {
  const [blobUrl, setBlobUrl] = useState('');
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState('');
  const isTemplatePreview = templateCompanyId != null;

  useEffect(() => {
    let cancelled = false;
    let createdUrl = '';
    setStatus('loading');
    setError('');

    (async () => {
      try {
        // SOW preview uses the per-process endpoint; template preview uses
        // the templates endpoint (passes the owner company id so the PDF
        // gets the correct branding).
        const blob = isTemplatePreview
          ? await api.previewSowTemplatePdf(templateCompanyId, data, documentName)
          : await api.previewSowPdf(processId, data);
        if (cancelled) return;
        createdUrl = window.URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setError(e.message);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) window.URL.revokeObjectURL(createdUrl);
    };
  }, [processId, templateCompanyId, isTemplatePreview, data]);

  return (
    <div className="sow-preview-overlay" onMouseDown={onClose}>
      <div className="sow-preview-shell" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sow-preview-toolbar">
          <strong>
            {documentName ? `${documentName} · Preview` : (isTemplatePreview ? 'Template Preview' : 'Document Preview')}
          </strong>
          <span className="muted small">
            {isTemplatePreview
              ? "Renders this template with the owner company's branding — a document built from it will look identical."
              : 'Exact render of the PDF that will be saved.'}
          </span>
          <button type="button" className="btn-ghost" onClick={onClose}>Close preview</button>
        </div>

        <div className="sow-preview-pages">
          {status === 'loading' && (
            <div className="sow-preview-loading muted">Generating PDF preview…</div>
          )}
          {status === 'error' && (
            <div className="sow-preview-loading"><div className="error">{error}</div></div>
          )}
          {status === 'ready' && blobUrl && (
            <iframe
              src={blobUrl}
              title="SOW PDF preview"
              className="sow-preview-iframe"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Editable signature table for one party (Client or Service Provider).
// Renders the company-name field at the top and a list of {label, value}
// rows below it; the user can rename labels, edit values, reorder rows,
// remove rows and add new ones. The Signature row also accepts an image
// upload (handled per-SOW by the parent component).
function SignatureParty({
  party,
  autoCompanyDisplay,
  isFirst, isLast,
  onTitleChange, onCompanyChange, onMoveUp, onMoveDown, onRemove,
  onRowPatch, onRowAdd, onRowRemove, onRowMove, onRowUpload,
}) {
  const isClient   = party.kind === 'client';
  const isProvider = party.kind === 'provider';
  const isCustom   = party.kind === 'custom';
  // Company control depends on the party kind:
  //   • client   → read-only, mirrors the cover's "Client name" field
  //   • provider → read-only, mirrors the issuing company (Branding)
  //   • custom   → free-text, the author types whoever this is
  const companyHint = isClient   ? 'Tracks the client name on the cover page.'
                    : isProvider ? "Uses the company we're working in (from Branding)."
                    : 'Type the legal name of the signing party.';
  return (
    <div className={'sig-party sig-party-' + party.kind}>
      <div className="sig-party-head">
        <input
          type="text"
          className="sig-party-title-input"
          value={party.title || ''}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Party title (e.g. Witness)"
          aria-label="Signature party title"
        />
        <span className="sig-party-kindbadge">{isClient ? 'Client' : isProvider ? 'Service Provider' : 'Custom'}</span>
        <div className="sig-party-actions">
          <button type="button" className="btn-icon" disabled={isFirst} onClick={onMoveUp}   title="Move party up">↑</button>
          <button type="button" className="btn-icon" disabled={isLast}  onClick={onMoveDown} title="Move party down">↓</button>
          <button type="button" className="btn-icon btn-icon-danger"    onClick={onRemove}   title="Remove this party">×</button>
        </div>
      </div>
      <div className="field sig-party-company" style={{ marginBottom: 12 }}>
        <label>{(party.title || 'Party')} company</label>
        {isCustom ? (
          <input
            type="text"
            value={party.company || ''}
            onChange={(e) => onCompanyChange(e.target.value)}
            placeholder="Legal company / organisation name"
          />
        ) : (
          <div className="sig-party-company-display">{autoCompanyDisplay || '—'}</div>
        )}
        {companyHint && <small className="muted">{companyHint}</small>}
      </div>
      <div className="sig-rows">
        {party.rows.map((row, idx) => {
          const isSignatureRow = (row.label || '').toLowerCase() === 'signature';
          return (
            <div key={row.id} className="sig-row">
              <input
                className="sig-row-label"
                type="text"
                value={row.label}
                onChange={(e) => onRowPatch(row.id, { label: e.target.value })}
                placeholder="Label"
                aria-label="Row label"
              />
              <span className="sig-row-sep">:</span>
              {isSignatureRow ? (
                <div className="sig-row-signature">
                  {row.signatureUrl
                    ? <img src={row.signatureUrl} alt="Signature" className="sig-row-image" />
                    : <span className="muted small">No signature image</span>}
                  <label className="btn-ghost upload-trigger sig-row-upload">
                    {row.signatureUrl ? 'Replace…' : 'Upload…'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="upload-input-overlay"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onRowUpload(row.id, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {row.signatureUrl && (
                    <button
                      type="button"
                      className="btn-ghost danger sig-row-remove-image"
                      onClick={() => onRowPatch(row.id, { signatureFile: null, signatureUrl: null })}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ) : (
                <input
                  className="sig-row-value"
                  type="text"
                  value={row.value}
                  onChange={(e) => onRowPatch(row.id, { value: e.target.value })}
                  placeholder="Value"
                  aria-label="Row value"
                />
              )}
              <div className="sig-row-actions">
                <button
                  type="button"
                  className="btn-icon"
                  title="Move up"
                  disabled={idx === 0}
                  onClick={() => onRowMove(row.id, -1)}
                >↑</button>
                <button
                  type="button"
                  className="btn-icon"
                  title="Move down"
                  disabled={idx === party.rows.length - 1}
                  onClick={() => onRowMove(row.id, 1)}
                >↓</button>
                <button
                  type="button"
                  className="btn-icon btn-icon-danger"
                  title="Remove row"
                  onClick={() => onRowRemove(row.id)}
                >×</button>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn-ghost sig-add-row" onClick={onRowAdd}>
        + Add row
      </button>
    </div>
  );
}
