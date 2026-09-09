import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import NextStepsEditor from './NextStepsEditor.jsx';
import { api } from '../api.js';

// Minimal editor for KPA-kind templates. Unlike SOW templates, KPA tasks
// don't store any per-template body — every task built from a KPA
// template captures its own employee + KPA rows fresh. So the template
// only needs a name + description (and an implicit Kind='kpa') plus the
// shared "next tasks" successor list so KPA templates can branch into
// follow-on tasks on the whiteboard just like SOW templates can.
export default function KpaTemplateModal({ mode = 'create', template, companyId, department = 'Human Resources', onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const [name, setName]               = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  // Workflow successor steps. Shape mirrors SOW templates exactly so the
  // whiteboard's ghost-card renderer treats both kinds identically.
  const [nextSteps, setNextSteps] = useState(
    Array.isArray(template?.nextSteps)
      ? template.nextSteps
      : (Array.isArray(template?.nextTemplateIds)
          ? template.nextTemplateIds.map((id) => ({ templateId: id }))
          : []),
  );
  // Template library scoped to this workspace — drives the dropdown of
  // pickable successor templates. Loaded once on mount; a KPA template
  // can point at either KPA or SOW templates as its next steps.
  const [companyTemplates, setCompanyTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  useEffect(() => {
    let cancelled = false;
    api.listSowTemplates(companyId, department)
      .then((list) => { if (!cancelled) setCompanyTemplates(Array.isArray(list) ? list : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [companyId, department]);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      if (isEdit) {
        await api.updateSowTemplate(template.id, {
          name: name.trim(),
          description: description.trim(),
          nextSteps,
        });
      } else {
        await api.createSowTemplate({
          ownerCompanyId: companyId,
          name: name.trim(),
          description: description.trim(),
          department,
          kind: 'kpa',
          nextSteps,
        });
      }
      onSaved?.();
    } catch (e2) {
      setErr(e2.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit KPA template' : 'New KPA template'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        <p className="muted" style={{ marginTop: 0 }}>
          KPA templates have no body — every task built from this template captures its own employee and KPA list. Just give it a recognisable name (e.g. <em>KPA formulation</em>).
        </p>
        <div className="field">
          <label htmlFor="kpa-tpl-name">Template name</label>
          <input
            id="kpa-tpl-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. KPA formulation"
            autoFocus
            maxLength={255}
          />
        </div>
        <div className="field">
          <label htmlFor="kpa-tpl-desc">Description (optional)</label>
          <textarea
            id="kpa-tpl-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this KPA template is for"
          />
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Possible next tasks (workflow)</label>
          <NextStepsEditor
            steps={nextSteps}
            allTemplates={companyTemplates}
            excludeId={template?.id ?? null}
            onChange={setNextSteps}
          />
          <small className="muted">
            Each step appears as a greyed ghost card branching off any task created from <em>this</em> template.
            Pick a template for steps that exist, or type a placeholder label to sketch a step you'll author later.
          </small>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create template')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
