import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import NextStepsEditor from './NextStepsEditor.jsx';
import { api } from '../api.js';

// Minimal editor for Pack-kind templates — the Pack task itself has no
// body (it composes sibling JD / KPI Doc / EDP at render time), so this
// modal only needs name + description + the workflow successor list.
export default function PackTemplateModal({ mode = 'create', template, companyId, department = 'Human Resources', onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const [name, setName]               = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [nextSteps, setNextSteps] = useState(
    Array.isArray(template?.nextSteps)
      ? template.nextSteps
      : (Array.isArray(template?.nextTemplateIds)
          ? template.nextTemplateIds.map((id) => ({ templateId: id }))
          : []),
  );
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
          kind: 'pack',
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
    <Modal title={isEdit ? 'Edit Pack template' : 'New Pack template'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        <p className="muted" style={{ marginTop: 0 }}>
          A Pack task compiles the project's <strong>Job Description</strong>, <strong>KPI Document</strong> and <strong>EDP Alignment Notes</strong> into a single combined PDF. No body is stored on the template — every task built from it pulls its content live from the sibling tasks on the same project.
        </p>
        <div className="field">
          <label htmlFor="pack-tpl-name">Template name</label>
          <input
            id="pack-tpl-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Role, KPI & EDP Pack"
            autoFocus
            maxLength={255}
          />
        </div>
        <div className="field">
          <label htmlFor="pack-tpl-desc">Description (optional)</label>
          <textarea
            id="pack-tpl-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this Pack template is for"
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
