import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import SowEditorModal from './SowEditorModal.jsx';
import KpaTemplateModal from './KpaTemplateModal.jsx';
import JdEditorModal from './JdEditorModal.jsx';
import EdpEditorModal from './EdpEditorModal.jsx';
import KpidocTemplateModal from './KpidocTemplateModal.jsx';
import PackTemplateModal from './PackTemplateModal.jsx';
import { api } from '../api.js';

// Library of reusable "Task templates" for a single company. The data
// model is still SOW-shaped (cover/sections/milestones/signatures) — these
// templates seed any Scope of Service task today, and the same plumbing
// will host future document types (policies, etc.) without a rename.
// Lets the user list, create, duplicate, edit, share and delete templates.
// Editing a template opens the existing SowEditorModal in `template mode`.

export default function SowTemplateLibrary({ company, allCompanies = [], department = 'Procurement', onClose, readOnly = false }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editingId, setEditingId] = useState(null);   // existing SOW template
  const [creating, setCreating] = useState(false);    // brand new SOW template
  const [sharing, setSharing] = useState(null);       // template being shared
  // KPA-kind templates use their own minimal editor (name + description
  // only — there's no body to edit). Tracked separately so the wrong
  // editor never opens on the wrong kind.
  const [editingKpaTemplate, setEditingKpaTemplate] = useState(null);
  const [creatingKpa, setCreatingKpa] = useState(false);
  // JD-kind templates have their own full-body editor (title, location,
  // hours, etc.) — tracked separately so the right modal opens for the
  // right kind.
  const [editingJdTemplateId, setEditingJdTemplateId] = useState(null);
  const [creatingJd, setCreatingJd] = useState(false);
  // EDP Alignment Notes templates — same shape as JD, different editor.
  const [editingEdpTemplateId, setEditingEdpTemplateId] = useState(null);
  const [creatingEdp, setCreatingEdp] = useState(false);
  // KPI Document templates — minimal name/description editor (the body
  // is derived from the KPA task per-process, so there's no template body).
  const [editingKpidocTemplate, setEditingKpidocTemplate] = useState(null);
  const [creatingKpidoc, setCreatingKpidoc] = useState(false);
  // Pack templates — even simpler (the Pack task has zero body; it
  // composes sibling JD / KPI Doc / EDP at render time).
  const [editingPackTemplate, setEditingPackTemplate] = useState(null);
  const [creatingPack, setCreatingPack] = useState(false);

  async function refresh() {
    setLoading(true);
    setErr('');
    try {
      const list = await api.listSowTemplates(company.id, department);
      setTemplates(Array.isArray(list) ? list : []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [company.id, department]);

  async function handleDuplicate(t) {
    try { await api.duplicateSowTemplate(t.id, { ownerCompanyId: company.id }); refresh(); }
    catch (e) { setErr(e.message); }
  }
  async function handleDelete(t) {
    if (!confirm(`Delete template "${t.name}"? This can't be undone.`)) return;
    try { await api.deleteSowTemplate(t.id); refresh(); }
    catch (e) { setErr(e.message); }
  }
  async function handleSetDefault(t) {
    try { await api.updateSowTemplate(t.id, { isDefault: true }); refresh(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <>
      <Modal title={`Task templates · ${company.name}`} onClose={onClose}>
        <div className="tpl-library">
          {err && <div className="error">{err}</div>}
          {!readOnly && (
            <div className="tpl-library-actions">
              <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                + New template
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCreatingKpa(true)}>
                + New KPA template
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCreatingJd(true)}>
                + New JD template
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCreatingEdp(true)}>
                + New EDP template
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCreatingKpidoc(true)}>
                + New KPI Document template
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCreatingPack(true)}>
                + New Pack template
              </button>
            </div>
          )}
          {loading ? (
            <div className="muted">Loading…</div>
          ) : templates.length === 0 ? (
            <div className="muted tpl-library-empty">
              No templates yet. Create one to standardise SOWs for this company.
            </div>
          ) : (
            <ul className="tpl-library-list">
              {templates.map((t) => (
                <li key={t.id} className="tpl-library-item">
                  <div className="tpl-library-item-main">
                    <div className="tpl-library-item-head">
                      <strong>{t.name}</strong>
                      {t.kind === 'kpa' && <span className="tpl-badge tpl-badge-kpa">KPA</span>}
                      {t.kind === 'jd'  && <span className="tpl-badge tpl-badge-jd">JD</span>}
                      {t.kind === 'edp' && <span className="tpl-badge tpl-badge-edp">EDP</span>}
                      {t.kind === 'kpidoc' && <span className="tpl-badge tpl-badge-kpidoc">KPI Doc</span>}
                      {t.kind === 'pack' && <span className="tpl-badge tpl-badge-pack">Pack</span>}
                      {t.isDefault && <span className="tpl-badge tpl-badge-default">Default</span>}
                      {!t.isOwned && <span className="tpl-badge tpl-badge-shared">Shared from {t.ownerCompanyName}</span>}
                    </div>
                    {t.description && <div className="muted small">{t.description}</div>}
                    <div className="muted small tpl-library-item-meta">
                      Updated {formatWhen(t.updatedAt)}
                      {t.sharedWith?.length > 0 && t.isOwned && ` · Shared with ${t.sharedWith.length} compan${t.sharedWith.length === 1 ? 'y' : 'ies'}`}
                    </div>
                  </div>
                  {!readOnly && (
                  <div className="tpl-library-item-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        // Pick the editor that matches the template's kind:
                        //   - KPA: minimal name/description modal (no body)
                        //   - JD:  full JD form editor (template mode)
                        //   - EDP: EDP Alignment Notes editor (template mode)
                        //   - SOW: existing SOW editor (template mode)
                        if (t.kind === 'kpa') setEditingKpaTemplate(t);
                        else if (t.kind === 'jd') setEditingJdTemplateId(t.id);
                        else if (t.kind === 'edp') setEditingEdpTemplateId(t.id);
                        else if (t.kind === 'kpidoc') setEditingKpidocTemplate(t);
                        else if (t.kind === 'pack') setEditingPackTemplate(t);
                        else setEditingId(t.id);
                      }}
                    >
                      {t.isOwned ? 'Edit' : 'View'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => handleDuplicate(t)}>
                      Duplicate
                    </button>
                    {t.isOwned && (
                      <>
                        <button type="button" className="btn-ghost" onClick={() => setSharing(t)}>
                          Share…
                        </button>
                        {!t.isDefault && (
                          <button type="button" className="btn-ghost" onClick={() => handleSetDefault(t)}>
                            Make default
                          </button>
                        )}
                        <button type="button" className="btn-ghost danger" onClick={() => handleDelete(t)}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      {creating && (
        <SowEditorModal
          templateMode
          templateName=""
          templateDescription=""
          templateData={null}
          defaultClientName=""
          issuerName={company.name}
          templateCompanyId={company.id}
          templateDepartment={department}
          onClose={() => setCreating(false)}
          onTemplateSave={async (data, meta) => {
            const created = await api.createSowTemplate({
              ownerCompanyId: company.id,
              name: meta.name,
              description: meta.description,
              department,
              data,
              nextSteps: meta.nextSteps,
              nextTemplateIds: meta.nextTemplateIds,
            });
            return created;
          }}
          onSaved={() => { setCreating(false); refresh(); }}
        />
      )}

      {editingId != null && (
        <SowEditorModal
          templateId={editingId}
          defaultClientName=""
          issuerName={company.name}
          templateCompanyId={company.id}
          templateDepartment={department}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); refresh(); }}
        />
      )}

      {creatingKpa && (
        <KpaTemplateModal
          mode="create"
          companyId={company.id}
          department={department}
          onClose={() => setCreatingKpa(false)}
          onSaved={() => { setCreatingKpa(false); refresh(); }}
        />
      )}

      {editingKpaTemplate && (
        <KpaTemplateModal
          mode="edit"
          template={editingKpaTemplate}
          companyId={company.id}
          department={department}
          onClose={() => setEditingKpaTemplate(null)}
          onSaved={() => { setEditingKpaTemplate(null); refresh(); }}
        />
      )}

      {creatingJd && (
        <JdEditorModal
          templateMode
          templateCompanyId={company.id}
          templateDepartment={department}
          onClose={() => setCreatingJd(false)}
          onSaved={() => { setCreatingJd(false); refresh(); }}
        />
      )}

      {editingJdTemplateId != null && (
        <JdEditorModal
          templateId={editingJdTemplateId}
          templateCompanyId={company.id}
          templateDepartment={department}
          onClose={() => setEditingJdTemplateId(null)}
          onSaved={() => { setEditingJdTemplateId(null); refresh(); }}
        />
      )}

      {creatingEdp && (
        <EdpEditorModal
          templateMode
          templateCompanyId={company.id}
          templateDepartment={department}
          onClose={() => setCreatingEdp(false)}
          onSaved={() => { setCreatingEdp(false); refresh(); }}
        />
      )}

      {editingEdpTemplateId != null && (
        <EdpEditorModal
          templateId={editingEdpTemplateId}
          templateCompanyId={company.id}
          templateDepartment={department}
          onClose={() => setEditingEdpTemplateId(null)}
          onSaved={() => { setEditingEdpTemplateId(null); refresh(); }}
        />
      )}

      {creatingKpidoc && (
        <KpidocTemplateModal
          mode="create"
          companyId={company.id}
          department={department}
          onClose={() => setCreatingKpidoc(false)}
          onSaved={() => { setCreatingKpidoc(false); refresh(); }}
        />
      )}

      {editingKpidocTemplate && (
        <KpidocTemplateModal
          mode="edit"
          template={editingKpidocTemplate}
          companyId={company.id}
          department={department}
          onClose={() => setEditingKpidocTemplate(null)}
          onSaved={() => { setEditingKpidocTemplate(null); refresh(); }}
        />
      )}

      {creatingPack && (
        <PackTemplateModal
          mode="create"
          companyId={company.id}
          department={department}
          onClose={() => setCreatingPack(false)}
          onSaved={() => { setCreatingPack(false); refresh(); }}
        />
      )}

      {editingPackTemplate && (
        <PackTemplateModal
          mode="edit"
          template={editingPackTemplate}
          companyId={company.id}
          department={department}
          onClose={() => setEditingPackTemplate(null)}
          onSaved={() => { setEditingPackTemplate(null); refresh(); }}
        />
      )}

      {sharing && (
        <ShareModal
          template={sharing}
          allCompanies={allCompanies.filter((c) => c.id !== company.id)}
          onClose={() => setSharing(null)}
          onSaved={async (sharedWith) => {
            try {
              await api.updateSowTemplate(sharing.id, { sharedWith });
              setSharing(null);
              refresh();
            } catch (e) { setErr(e.message); }
          }}
        />
      )}
    </>
  );
}

function ShareModal({ template, allCompanies, onClose, onSaved }) {
  const [selected, setSelected] = useState(new Set(template.sharedWith || []));
  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  return (
    <Modal title={`Share "${template.name}"`} onClose={onClose}>
      <div className="tpl-share">
        <p className="muted">Pick the companies that should be able to use this template when creating their own SOWs. They can preview and duplicate it but not edit it.</p>
        {allCompanies.length === 0 ? (
          <div className="muted">No other companies to share with.</div>
        ) : (
          <ul className="tpl-share-list">
            {allCompanies.map((c) => (
              <li key={c.id} className="tpl-share-item">
                <label className="checkbox-row">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  <span>{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => onSaved([...selected])}>
            Save sharing
          </button>
        </div>
      </div>
    </Modal>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
