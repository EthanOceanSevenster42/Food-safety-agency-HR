// Reusable editor for a template's "next tasks" list. Each step is either
//   - { templateId: number } — resolves to a template, rendered as a ghost
//     card with the template's name + colour on the whiteboard, or
//   - { label: string } — a placeholder for a step whose template doesn't
//     exist yet (lets the user sketch the workflow before all templates
//     are authored).
//
// Used by SowEditorModal (when editing a SOW-kind template) and
// KpaTemplateModal (when editing a KPA-kind template) — both kinds share
// the same successor-suggestion plumbing on the whiteboard.
export default function NextStepsEditor({ steps, allTemplates, excludeId, onChange }) {
  const candidates = (allTemplates || []).filter((t) => t.id !== excludeId);
  const safeSteps = Array.isArray(steps) ? steps : [];

  function patch(idx, mutator) {
    onChange(safeSteps.map((s, i) => (i === idx ? mutator(s) : s)));
  }
  function remove(idx) {
    onChange(safeSteps.filter((_, i) => i !== idx));
  }
  function move(idx, delta) {
    const next = idx + delta;
    if (next < 0 || next >= safeSteps.length) return;
    const arr = safeSteps.slice();
    const [s] = arr.splice(idx, 1);
    arr.splice(next, 0, s);
    onChange(arr);
  }
  function addTemplate() {
    onChange([...safeSteps, { templateId: candidates[0]?.id ?? null }]);
  }
  function addLabel() {
    onChange([...safeSteps, { label: '' }]);
  }

  return (
    <div className="tpl-next-editor">
      {safeSteps.length === 0 && (
        <div className="muted small tpl-next-empty">
          No steps yet. Add a template pick or a placeholder label below.
        </div>
      )}
      <ol className="tpl-next-steps">
        {safeSteps.map((step, idx) => {
          const isLabel = step.label != null;
          return (
            <li key={idx} className={'tpl-next-step ' + (isLabel ? 'tpl-next-step-label' : 'tpl-next-step-template')}>
              <span className="tpl-next-step-num">{idx + 1}.</span>
              {isLabel ? (
                <input
                  type="text"
                  className="tpl-next-step-label-input"
                  value={step.label || ''}
                  onChange={(e) => patch(idx, () => ({ label: e.target.value }))}
                  placeholder="e.g. Initial consultation"
                  maxLength={255}
                />
              ) : (
                <select
                  className="tpl-next-step-template-select"
                  value={step.templateId ?? ''}
                  onChange={(e) => patch(idx, () => ({ templateId: parseInt(e.target.value, 10) }))}
                >
                  {candidates.length === 0 && <option value="">No templates available</option>}
                  {candidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.isDefault ? ' · default' : ''}
                      {!t.isOwned ? ` · shared from ${t.ownerCompanyName}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <div className="tpl-next-step-actions">
                <button type="button" className="btn-icon" title="Move up"   disabled={idx === 0}                   onClick={() => move(idx, -1)}>↑</button>
                <button type="button" className="btn-icon" title="Move down" disabled={idx === safeSteps.length - 1} onClick={() => move(idx, +1)}>↓</button>
                <button type="button" className="btn-icon btn-icon-danger" title="Remove step" onClick={() => remove(idx)}>×</button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="tpl-next-add-row">
        <button type="button" className="btn-ghost" onClick={addTemplate} disabled={candidates.length === 0}>
          + Add template step
        </button>
        <button type="button" className="btn-ghost" onClick={addLabel}>
          + Add placeholder label
        </button>
      </div>
    </div>
  );
}
