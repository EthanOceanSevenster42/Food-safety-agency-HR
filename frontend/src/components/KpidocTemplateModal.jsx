import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import NextStepsEditor from './NextStepsEditor.jsx';
import { api } from '../api.js';

// Minimal editor for KPI-Doc-kind templates — mirrors KpaTemplateModal.
// The doc body is generated per-task from the project's KPA payload at
// view time, so the template itself only needs a name, description, and
// optional workflow successor list.
export default function KpidocTemplateModal({ mode = 'create', template, companyId, department = 'Human Resources', onClose, onSaved }) {
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
          kind: 'kpidoc',
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
    <Modal title={isEdit ? 'Edit KPI Document template' : 'New KPI Document template'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        <p className="muted" style={{ marginTop: 0 }}>
          KPI Document templates have no body — every task built from this template pulls its rows live from the project's KPA task. Just give it a recognisable name (e.g. <em>KPI Document</em>).
        </p>
        <div className="field">
          <label htmlFor="kpidoc-tpl-name">Template name</label>
          <input
            id="kpidoc-tpl-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. KPI Document"
            autoFocus
            maxLength={255}
          />
        </div>
        <div className="field">
          <label htmlFor="kpidoc-tpl-desc">Description (optional)</label>
          <textarea
            id="kpidoc-tpl-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this KPI Document template is for"
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
