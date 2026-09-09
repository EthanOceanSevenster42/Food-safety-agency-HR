import {
  newProjectId, newMilestoneId, milestoneCode, effectiveTariff, milestoneSubtotal,
  appendixAGrandTotal, formatRand,
} from './milestone-utils.js';

// Inline editor for Appendix A's "Project Milestone Table".
//
// Renders one project block per project (project name + phase/project number)
// with a milestones table underneath. Each milestone row has its own week,
// hours, optional tariff override and computed sub-total. Codes are derived,
// not edited — `P1-W1`, `PH1-P1-W2`, etc.

export default function MilestoneTableEditor({ value, onChange }) {
  const data = value || { defaultTariff: 750, projects: [] };
  const setDefault = (v) => onChange({ ...data, defaultTariff: numericOrNull(v) ?? 0 });

  // Project numbers are derived from the project's position in the list,
  // never user-edited. Every mutation that changes the order (add, remove,
  // move) re-runs this so each project's `projectNumber` matches its new
  // index. The backend's milestone-code generator reads `projectNumber` to
  // build "P1-Wn", so keeping the stored value synced means the codes stay
  // consistent with what the editor displays.
  const resequence = (projects) => projects.map((p, idx) => ({ ...p, projectNumber: idx + 1 }));

  function patchProject(id, patch) {
    onChange({
      ...data,
      projects: data.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  }
  function addProject() {
    onChange({
      ...data,
      projects: resequence([
        ...data.projects,
        {
          id: newProjectId(),
          name: '',
          phase: null,
          projectNumber: 0, // will be assigned by resequence
          milestones: [blankMilestone()],
        },
      ]),
    });
  }
  function removeProject(id) {
    onChange({ ...data, projects: resequence(data.projects.filter((p) => p.id !== id)) });
  }
  function moveProject(id, delta) {
    const idx = data.projects.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const next = idx + delta;
    if (next < 0 || next >= data.projects.length) return;
    const arr = data.projects.slice();
    const [p] = arr.splice(idx, 1);
    arr.splice(next, 0, p);
    onChange({ ...data, projects: resequence(arr) });
  }
  function patchMilestone(projectId, milestoneId, patch) {
    onChange({
      ...data,
      projects: data.projects.map((p) => p.id !== projectId ? p : {
        ...p,
        milestones: p.milestones.map((m) => (m.id === milestoneId ? { ...m, ...patch } : m)),
      }),
    });
  }
  function addMilestone(projectId) {
    onChange({
      ...data,
      projects: data.projects.map((p) => p.id !== projectId ? p : {
        ...p,
        milestones: [...p.milestones, blankMilestone()],
      }),
    });
  }
  function removeMilestone(projectId, milestoneId) {
    onChange({
      ...data,
      projects: data.projects.map((p) => p.id !== projectId ? p : {
        ...p,
        milestones: p.milestones.filter((m) => m.id !== milestoneId),
      }),
    });
  }
  function moveMilestone(projectId, milestoneId, delta) {
    onChange({
      ...data,
      projects: data.projects.map((p) => {
        if (p.id !== projectId) return p;
        const idx = p.milestones.findIndex((m) => m.id === milestoneId);
        if (idx < 0) return p;
        const next = idx + delta;
        if (next < 0 || next >= p.milestones.length) return p;
        const arr = p.milestones.slice();
        const [m] = arr.splice(idx, 1);
        arr.splice(next, 0, m);
        return { ...p, milestones: arr };
      }),
    });
  }

  const grandTotal = appendixAGrandTotal(data);

  return (
    <div className="milestones">
      <div className="milestones-default-tariff">
        <label htmlFor="ms-default-tariff">Default tariff (R / hour)</label>
        <span className="input-affix affix-prefix">
          <span className="input-affix-symbol">R</span>
          <input
            id="ms-default-tariff"
            type="number"
            min="0"
            step="0.01"
            value={data.defaultTariff ?? ''}
            onChange={(e) => setDefault(e.target.value)}
          />
        </span>
        <small className="muted">Applied to every milestone unless overridden in the row.</small>
      </div>

      {data.projects.length === 0 && (
        <div className="muted milestones-empty">
          No projects yet. Add a project to start building the milestone table.
        </div>
      )}

      {data.projects.map((project, pIdx) => (
        <ProjectBlock
          key={project.id}
          project={project}
          /* Number derived from render position, not stored field — so old
             saves with mismatched numbers display correctly. The stored
             projectNumber is still kept in sync via `resequence` for the
             backend's milestone-code generator. */
          displayNumber={pIdx + 1}
          isFirst={pIdx === 0}
          isLast={pIdx === data.projects.length - 1}
          defaultTariff={data.defaultTariff}
          onPatch={(patch) => patchProject(project.id, patch)}
          onRemove={() => removeProject(project.id)}
          onMoveUp={() => moveProject(project.id, -1)}
          onMoveDown={() => moveProject(project.id, +1)}
          onPatchMilestone={(mid, patch) => patchMilestone(project.id, mid, patch)}
          onAddMilestone={() => addMilestone(project.id)}
          onRemoveMilestone={(mid) => removeMilestone(project.id, mid)}
          onMoveMilestone={(mid, d) => moveMilestone(project.id, mid, d)}
        />
      ))}

      <button type="button" className="btn-ghost milestones-add-project" onClick={addProject}>
        + Add project
      </button>

      {data.projects.length > 0 && (
        <div className="milestones-grand-total">
          <strong>Grand total:</strong> {formatRand(grandTotal)}
        </div>
      )}
    </div>
  );
}

function ProjectBlock({
  project, displayNumber, isFirst, isLast, defaultTariff,
  onPatch, onRemove, onMoveUp, onMoveDown,
  onPatchMilestone, onAddMilestone, onRemoveMilestone, onMoveMilestone,
}) {
  const projectTotal = (project.milestones || []).reduce(
    (s, m) => s + milestoneSubtotal(m, defaultTariff), 0,
  );

  return (
    <div className="milestones-project">
      <div className="milestones-project-head">
        <div className="field" style={{ flex: 1 }}>
          <label>Project name (incl. phase)</label>
          <input
            type="text"
            value={project.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="e.g. AFMA Website Takeover – Phase 1"
          />
        </div>
        <div className="field milestones-project-num">
          <label>Project #</label>
          {/* Project number is auto-assigned from the project's position in
              the list — locked from manual editing. Using ↑/↓ to reorder
              re-sequences every project's number. */}
          <input
            type="text"
            value={displayNumber}
            readOnly
            tabIndex={-1}
            className="readonly-input"
            aria-readonly="true"
            title="Auto-assigned — reorder projects to change"
          />
        </div>
        <div className="field milestones-project-num">
          <label>Phase # <small className="muted">(opt.)</small></label>
          <input
            type="number"
            min="1"
            value={project.phase ?? ''}
            onChange={(e) => onPatch({ phase: clampInt(e.target.value, null) })}
            placeholder="—"
          />
        </div>
        <div className="milestones-project-actions">
          <button type="button" className="btn-icon" disabled={isFirst}  title="Move up"   onClick={onMoveUp}>↑</button>
          <button type="button" className="btn-icon" disabled={isLast}   title="Move down" onClick={onMoveDown}>↓</button>
          <button type="button" className="btn-icon btn-icon-danger"     title="Remove project" onClick={onRemove}>×</button>
        </div>
      </div>

      <div className="milestones-table-wrap">
        <table className="milestones-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Milestone description</th>
              <th>Week</th>
              <th>Hours</th>
              <th>Tariff (R/hr)</th>
              <th>Sub-total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {project.milestones.map((m, mIdx) => {
              const code = milestoneCode(project, mIdx);
              const tariff = effectiveTariff(m, defaultTariff);
              const sub = milestoneSubtotal(m, defaultTariff);
              return (
                <tr key={m.id}>
                  <td className="milestones-code">{code}</td>
                  <td>
                    <textarea
                      rows="3"
                      value={m.description}
                      onChange={(e) => onPatchMilestone(m.id, { description: e.target.value })}
                      placeholder="What gets delivered in this milestone"
                    />
                  </td>
                  <td className="milestones-week">
                    <input
                      type="number"
                      min="1"
                      value={m.week ?? ''}
                      onChange={(e) => onPatchMilestone(m.id, { week: clampInt(e.target.value, 1) })}
                    />
                  </td>
                  <td className="milestones-hours">
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={m.hours ?? ''}
                      onChange={(e) => onPatchMilestone(m.id, { hours: numericOrNull(e.target.value) ?? 0 })}
                    />
                  </td>
                  <td className="milestones-tariff">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={m.tariff ?? ''}
                      onChange={(e) => onPatchMilestone(m.id, { tariff: numericOrNull(e.target.value) })}
                      placeholder={`(default ${tariff})`}
                    />
                  </td>
                  <td className="milestones-sub">{formatRand(sub)}</td>
                  <td className="milestones-row-actions">
                    <button type="button" className="btn-icon" disabled={mIdx === 0}                               title="Move up"      onClick={() => onMoveMilestone(m.id, -1)}>↑</button>
                    <button type="button" className="btn-icon" disabled={mIdx === project.milestones.length - 1}  title="Move down"    onClick={() => onMoveMilestone(m.id, +1)}>↓</button>
                    <button type="button" className="btn-icon btn-icon-danger"                                    title="Remove row"   onClick={() => onRemoveMilestone(m.id)}>×</button>
                  </td>
                </tr>
              );
            })}
            {project.milestones.length === 0 && (
              <tr><td colSpan="7" className="muted small" style={{ padding: 12 }}>No milestones — click "Add milestone" below.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="5" style={{ textAlign: 'right' }}><strong>Project sub-total</strong></td>
              <td className="milestones-sub"><strong>{formatRand(projectTotal)}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button type="button" className="btn-ghost milestones-add-row" onClick={onAddMilestone}>
        + Add milestone
      </button>
    </div>
  );
}

function blankMilestone() {
  return { id: newMilestoneId(), description: '', week: 1, hours: 0, tariff: null };
}
function clampInt(v, fallback) {
  if (v === '' || v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function numericOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
