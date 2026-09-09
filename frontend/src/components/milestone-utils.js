// Shared helpers for the Appendix A "Project Milestone" feature.
//
// Data shape:
//   appendixA = {
//     defaultTariff: 750,                      // R/hr applied when a milestone doesn't override
//     projects: [
//       {
//         id: 'p1',
//         name: 'AFMA Website Takeover – Phase 1',
//         phase:         1,   // optional; when present, prefixes the code with "PH1-"
//         projectNumber: 1,   // the "P1" part of the code
//         milestones: [
//           { id: 'm1', description: '...', week: 1, hours: 0.5, tariff: null /* = use default */ }
//         ]
//       }
//     ]
//   }

const DEFAULT_TARIFF_FALLBACK = 750;

let _projectCounter = 0;
let _milestoneCounter = 0;
export function newProjectId() {
  _projectCounter += 1;
  return `mp-${Date.now().toString(36)}-${_projectCounter}`;
}
export function newMilestoneId() {
  _milestoneCounter += 1;
  return `mm-${Date.now().toString(36)}-${_milestoneCounter}`;
}

// Coerce a saved appendixA blob into the canonical shape. Old SOWs (where
// appendixA was a 2-D string grid from the generic TableBuilder) collapse to
// an empty default — the old placeholder rows weren't real data.
//
// Project numbers are ALWAYS assigned from the project's position in the
// list (1, 2, 3, …) — any previously-stored value is overwritten. This
// makes the field tamper-proof and keeps the milestone codes ("P1-W1") in
// sync with how the user sees the list in the editor.
export function normaliseAppendixA(raw) {
  if (raw && typeof raw === 'object' && Array.isArray(raw.projects)) {
    return {
      defaultTariff: Number.isFinite(raw.defaultTariff) ? Number(raw.defaultTariff) : DEFAULT_TARIFF_FALLBACK,
      projects: raw.projects.map((p, idx) => normaliseProject(p, idx)),
    };
  }
  return { defaultTariff: DEFAULT_TARIFF_FALLBACK, projects: [] };
}

function normaliseProject(raw, idx = 0) {
  return {
    id:            (raw && typeof raw.id === 'string' && raw.id) ? raw.id : newProjectId(),
    name:          typeof raw?.name === 'string' ? raw.name : '',
    phase:         numericOrNull(raw?.phase),
    projectNumber: idx + 1, // forced from position — never from stored value
    milestones:    Array.isArray(raw?.milestones) ? raw.milestones.map(normaliseMilestone) : [],
  };
}

function normaliseMilestone(raw) {
  return {
    id:          (raw && typeof raw.id === 'string' && raw.id) ? raw.id : newMilestoneId(),
    description: typeof raw?.description === 'string' ? raw.description : '',
    week:        Number.isFinite(raw?.week)  ? Number(raw.week)  : 1,
    hours:       Number.isFinite(raw?.hours) ? Number(raw.hours) : 0,
    tariff:      numericOrNull(raw?.tariff),
  };
}

function numericOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// "PH1-P1-W1" if phase is set, otherwise "P1-W1". `milestoneIndex` is the
// zero-based position of the milestone inside its project — milestones are
// numbered sequentially regardless of which week they fall in.
export function milestoneCode(project, milestoneIndex) {
  const prPart = `P${project.projectNumber || 1}`;
  const wPart  = `W${milestoneIndex + 1}`;
  if (project.phase) return `PH${project.phase}-${prPart}-${wPart}`;
  return `${prPart}-${wPart}`;
}

export function effectiveTariff(milestone, defaultTariff) {
  return milestone.tariff != null ? Number(milestone.tariff) : Number(defaultTariff || 0);
}

export function milestoneSubtotal(milestone, defaultTariff) {
  return Number(milestone.hours || 0) * effectiveTariff(milestone, defaultTariff);
}

export function appendixAGrandTotal(appendixA) {
  const dt = appendixA.defaultTariff;
  return (appendixA.projects || []).reduce(
    (sum, p) => sum + (p.milestones || []).reduce((s, m) => s + milestoneSubtotal(m, dt), 0),
    0,
  );
}

// Currency formatting — South African Rand, "R750.00" style to match the
// reference SOW. Uses fixed two-decimal places so the column aligns.
export function formatRand(amount) {
  const n = Number(amount || 0);
  return 'R' + n.toFixed(2);
}
