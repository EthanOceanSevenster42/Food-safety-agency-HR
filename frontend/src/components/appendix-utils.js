// Helpers for the dynamic appendices feature on SOW templates and generated
// documents.
//
// Each appendix has a `type`:
//   - 'milestones' → uses the structured Project Milestone Table editor +
//     optional Gantt chart. Always renders landscape.
//   - 'custom'     → a regular appendix that can hold a mix of text blocks
//     (H2 heading + HTML body) and table blocks (H2 heading + optional
//     body-text description + 2-D grid). Portrait by default, landscape
//     if the author flips the orientation.
//
// Data shape (lives at data.tables.appendices, replacing the old appendixA
// + extraAppendices pair — both are migrated on load):
//
//   [
//     {
//       id, title, type: 'milestones' | 'custom',
//       orientation: 'portrait' | 'landscape',
//       // milestones-type only:
//       defaultTariff, projects, includeGantt,
//       // custom-type only:
//       blocks: [
//         { id, type: 'text',  heading, body },                          // HTML body
//         { id, type: 'table', heading, description, grid: [[...], …] }
//       ]
//     }
//   ]
//
// Section-level tables live alongside the section body (so a section can
// hold body text + multiple H3-titled tables in addition to sub-sections):
//   section = { id, title, body, status?, subsections, tables: [
//     { id, heading, description, grid: [[...], …] }
//   ] }

let _appendixCounter = 0;
let _blockCounter    = 0;
let _secTableCounter = 0;

export function newAppendixId()      { _appendixCounter += 1; return `app-${Date.now().toString(36)}-${_appendixCounter}`; }
export function newAppendixBlockId() { _blockCounter    += 1; return `blk-${Date.now().toString(36)}-${_blockCounter}`; }
export function newSectionTableId()  { _secTableCounter += 1; return `st-${Date.now().toString(36)}-${_secTableCounter}`; }

// ---------- Appendices ----------

// Build the unified appendices array from a saved `tables` blob. Handles
// three legacy shapes:
//   1. `tables.appendices` already in the new unified form (pass through).
//   2. `tables.appendixA` (milestones) + `tables.extraAppendices` (customs).
//   3. `tables.appendixA` + the older `tables.monthlyServiceAllocation` grid.
export function normaliseAppendices(tables) {
  const t = tables && typeof tables === 'object' ? tables : {};

  if (Array.isArray(t.appendices)) {
    return t.appendices.map(normaliseAppendix);
  }

  const out = [];

  // Migrate legacy appendixA (milestones) into the first slot.
  if (t.appendixA && typeof t.appendixA === 'object') {
    out.push({
      id: newAppendixId(),
      title: 'Detailed Milestone Breakdown, Cost & Timeline Allocation',
      type: 'milestones',
      orientation: 'landscape',
      defaultTariff: Number.isFinite(Number(t.appendixA.defaultTariff)) ? Number(t.appendixA.defaultTariff) : 750,
      projects:      Array.isArray(t.appendixA.projects) ? t.appendixA.projects : [],
      includeGantt:  t.appendixA.includeGantt !== false, // default on
      blocks: [],
    });
  }

  // Migrate legacy extraAppendices (custom appendices) into subsequent slots.
  if (Array.isArray(t.extraAppendices)) {
    for (const a of t.extraAppendices) out.push(normaliseAppendix({ ...a, type: 'custom' }));
  } else if (Array.isArray(t.monthlyServiceAllocation) && t.monthlyServiceAllocation.length > 0) {
    // Even older shape: a single SLA grid. Promote to one custom appendix.
    out.push({
      id: newAppendixId(),
      title: 'SLA Monthly Fee and Service Allocation',
      type: 'custom',
      orientation: 'portrait',
      blocks: [blankTableBlock('SLA Monthly Fee and Service Allocation Summary', t.monthlyServiceAllocation)],
    });
  }

  return out;
}

// Status flag for template authors / SOW reviewers. The same three states
// the main sections use:
//   - 'standard'  : boilerplate, leave as-is
//   - 'attention' : must be tailored per client
//   - null        : no guidance
export function normaliseStatus(s) {
  return s === 'standard' || s === 'attention' ? s : null;
}

function normaliseAppendix(raw) {
  const type = raw?.type === 'milestones' ? 'milestones' : 'custom';
  const base = {
    id:    (raw && typeof raw.id === 'string' && raw.id) ? raw.id : newAppendixId(),
    title: typeof raw?.title === 'string' ? raw.title : '',
    type,
    status: normaliseStatus(raw?.status),
    orientation: type === 'milestones'
      ? 'landscape'                                  // milestone breakdowns are always landscape
      : (raw?.orientation === 'landscape' ? 'landscape' : 'portrait'),
  };
  if (type === 'milestones') {
    return {
      ...base,
      defaultTariff: Number.isFinite(Number(raw?.defaultTariff)) ? Number(raw.defaultTariff) : 750,
      projects:      Array.isArray(raw?.projects) ? raw.projects : [],
      includeGantt:  raw?.includeGantt !== false,
      blocks: [],
    };
  }
  return {
    ...base,
    blocks: Array.isArray(raw?.blocks) ? raw.blocks.map(normaliseBlock) : [],
  };
}

function normaliseBlock(raw) {
  if (raw?.type === 'text') {
    return {
      id:      (raw && typeof raw.id === 'string' && raw.id) ? raw.id : newAppendixBlockId(),
      type:    'text',
      status:  normaliseStatus(raw?.status),
      heading: typeof raw?.heading === 'string' ? raw.heading : '',
      body:    typeof raw?.body    === 'string' ? raw.body    : '',
    };
  }
  // Default to a table block.
  return {
    id:          (raw && typeof raw.id === 'string' && raw.id) ? raw.id : newAppendixBlockId(),
    type:        'table',
    status:      normaliseStatus(raw?.status),
    heading:     typeof raw?.heading     === 'string' ? raw.heading     : '',
    description: typeof raw?.description === 'string' ? raw.description : '',
    grid: Array.isArray(raw?.grid)
      ? raw.grid.map((r) => Array.isArray(r) ? r.map((v) => String(v ?? '')) : [])
      : [['Header 1', 'Header 2'], ['', '']],
  };
}

export function appendixLetter(index) {
  return String.fromCharCode(65 + index); // 'A','B','C',…
}

export function blankTableBlock(heading = '', grid = null) {
  return {
    id: newAppendixBlockId(),
    type: 'table',
    status: null,
    heading,
    description: '',
    grid: Array.isArray(grid) ? grid : [['Header 1', 'Header 2'], ['', '']],
  };
}

export function blankTextBlock(heading = '') {
  return { id: newAppendixBlockId(), type: 'text', status: null, heading, body: '' };
}

export function blankCustomAppendix(title = '') {
  return {
    id: newAppendixId(),
    title,
    type: 'custom',
    status: null,
    orientation: 'portrait',
    blocks: [blankTableBlock()],
  };
}

export function blankMilestoneAppendix(title = 'Detailed Milestone Breakdown, Cost & Timeline Allocation') {
  return {
    id: newAppendixId(),
    title,
    type: 'milestones',
    status: null,
    orientation: 'landscape',
    defaultTariff: 750,
    projects: [],
    includeGantt: true,
    blocks: [],
  };
}

// ---------- Section-level tables ----------

export function normaliseSectionTables(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    id:          (t && typeof t.id === 'string' && t.id) ? t.id : newSectionTableId(),
    status:      normaliseStatus(t?.status),
    heading:     typeof t?.heading     === 'string' ? t.heading     : '',
    description: typeof t?.description === 'string' ? t.description : '',
    grid: Array.isArray(t?.grid)
      ? t.grid.map((r) => Array.isArray(r) ? r.map((v) => String(v ?? '')) : [])
      : [['Header 1', 'Header 2'], ['', '']],
  }));
}

export function blankSectionTable() {
  return {
    id: newSectionTableId(),
    status: null,
    heading: '',
    description: '',
    grid: [['Header 1', 'Header 2'], ['', '']],
  };
}
