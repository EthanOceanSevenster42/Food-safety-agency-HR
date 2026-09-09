import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import NextStepsEditor from './NextStepsEditor.jsx';
import AttentionPill, { isFlagged as isFlaggedStatus } from './AttentionPill.jsx';
import { api } from '../api.js';

// Editor for an "EDP Alignment Notes — Quarterly Development Focus" task.
// Mirrors JdEditorModal's two-mode shape:
//   templateMode → editing a SowTemplates row with Kind='edp'
//   task mode    → editing a ProjectProcesses row with Kind='edp'
//
// Data shape:
//   {
//     description: string,             // describes the document/template
//     sectionStatus: { description?: 'needs-attention' },
//     edps: [
//       {
//         header: string,              // EDP header text
//         wigs: [                      // one or more WIGs under this EDP
//           {
//             text: string,            // the WIG itself
//             leadMeasures: string[],  // lead measures for THIS WIG
//           },
//           ...
//         ],
//         status?: 'needs-attention',  // per-EDP needs-attention flag
//       },
//       ...
//     ]
//   }
//
// Older saves shaped each EDP as a flat `{ wig, leadMeasures }` — those
// are auto-promoted into a single-element `wigs` array on read so the
// editor only has to deal with the nested shape.

const EMPTY_EDP = { description: '', edps: [], sectionStatus: {} };

function blankWig() { return { text: '', leadMeasures: [''] }; }
function blankEdp() { return { header: '', wigs: [blankWig()] }; }

function normalise(raw) {
  const v = (raw && typeof raw === 'object') ? raw : {};
  const edpsRaw = Array.isArray(v.edps) ? v.edps : [];
  const edps = edpsRaw.length === 0 ? [blankEdp()] : edpsRaw.map((e) => {
    const header = typeof e?.header === 'string' ? e.header : '';
    let wigs;
    if (Array.isArray(e?.wigs) && e.wigs.length) {
      wigs = e.wigs.map((w) => ({
        text: typeof w?.text === 'string' ? w.text : (typeof w?.wig === 'string' ? w.wig : ''),
        leadMeasures: Array.isArray(w?.leadMeasures) && w.leadMeasures.length
          ? w.leadMeasures.map((m) => String(m ?? ''))
          : [''],
      }));
    } else {
      // Legacy shape — flat wig + leadMeasures at the EDP level.
      const text = typeof e?.wig === 'string' ? e.wig : '';
      const lm   = Array.isArray(e?.leadMeasures) && e.leadMeasures.length
        ? e.leadMeasures.map((m) => String(m ?? ''))
        : [''];
      wigs = [{ text, leadMeasures: lm }];
    }
    return {
      header,
      wigs,
      ...(e?.status ? { status: e.status } : {}),
    };
  });
  return {
    ...EMPTY_EDP,
    description: typeof v.description === 'string' ? v.description : '',
    edps,
    sectionStatus: (v.sectionStatus && typeof v.sectionStatus === 'object') ? v.sectionStatus : {},
  };
}

export default function EdpEditorModal({
  onClose, onSaved,
  // task mode
  processId, processName,
  // template mode
  templateMode = false,
  templateId,
  templateCompanyId,
  templateDepartment = 'Human Resources',
}) {
  const isTemplate = templateMode || templateId != null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  const [data, setData]       = useState(EMPTY_EDP);

  // Template-only
  const [tplName, setTplName] = useState('');
  const [nextSteps, setNextSteps] = useState([]);
  const [companyTemplates, setCompanyTemplates] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    (async () => {
      try {
        if (isTemplate) {
          if (templateId != null) {
            const t = await api.getSowTemplate(templateId);
            if (cancelled) return;
            setTplName(t?.name || '');
            setData(normalise(t?.data));
            setNextSteps(Array.isArray(t?.nextSteps) ? t.nextSteps : (
              Array.isArray(t?.nextTemplateIds) ? t.nextTemplateIds.map((id) => ({ templateId: id })) : []
            ));
          } else {
            setData(normalise(null));
          }
          const list = await api.listSowTemplates(templateCompanyId, templateDepartment);
          if (cancelled) return;
          setCompanyTemplates(Array.isArray(list) ? list : []);
        } else {
          const res = await api.getEdp(processId);
          if (cancelled) return;
          setData(normalise(res?.data));
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isTemplate, processId, templateId, templateCompanyId, templateDepartment]);

  function patch(field, value) { setData((d) => ({ ...d, [field]: value })); }

  // ----- EDP block mutators -----
  function updateEdp(idx, patchObj) {
    setData((d) => ({ ...d, edps: d.edps.map((e, i) => (i === idx ? { ...e, ...patchObj } : e)) }));
  }
  function addEdp() {
    setData((d) => ({ ...d, edps: [...d.edps, blankEdp()] }));
  }
  function removeEdp(idx) {
    setData((d) => {
      const next = d.edps.filter((_, i) => i !== idx);
      // Keep at least one EDP visible so the user always has somewhere to type.
      return { ...d, edps: next.length ? next : [blankEdp()] };
    });
  }

  // Top-level section flags (currently just 'description'). Same shape
  // as JdEditorModal: omit the key when cleared so the persisted map
  // stays compact.
  function setSectionStatus(key, value) {
    setData((d) => {
      const next = { ...(d.sectionStatus || {}) };
      if (value) next[key] = value; else delete next[key];
      return { ...d, sectionStatus: next };
    });
  }
  // Per-EDP flag — lives on the EDP object itself rather than the
  // shared sectionStatus map so the flag travels with its EDP if the
  // list is reordered.
  function setEdpStatus(idx, value) {
    setData((d) => ({
      ...d,
      edps: d.edps.map((e, i) => {
        if (i !== idx) return e;
        const { status: _drop, ...rest } = e;
        return value ? { ...rest, status: value } : rest;
      }),
    }));
  }

  // ----- WIG mutators (per-EDP) -----
  function updateWig(edpIdx, wigIdx, patchObj) {
    setData((d) => ({
      ...d,
      edps: d.edps.map((e, i) => {
        if (i !== edpIdx) return e;
        return { ...e, wigs: e.wigs.map((w, j) => (j === wigIdx ? { ...w, ...patchObj } : w)) };
      }),
    }));
  }
  function addWig(edpIdx) {
    setData((d) => ({
      ...d,
      edps: d.edps.map((e, i) => (i === edpIdx ? { ...e, wigs: [...e.wigs, blankWig()] } : e)),
    }));
  }
  function removeWig(edpIdx, wigIdx) {
    setData((d) => ({
      ...d,
      edps: d.edps.map((e, i) => {
        if (i !== edpIdx) return e;
        const next = e.wigs.filter((_, j) => j !== wigIdx);
        // Keep at least one WIG so the user always has somewhere to type.
        return { ...e, wigs: next.length ? next : [blankWig()] };
      }),
    }));
  }

  // ----- Lead-measure mutators (scoped to one WIG within one EDP) -----
  function updateLeadMeasure(edpIdx, wigIdx, mIdx, value) {
    setData((d) => ({
      ...d,
      edps: d.edps.map((e, i) => {
        if (i !== edpIdx) return e;
        return {
          ...e,
          wigs: e.wigs.map((w, j) => {
            if (j !== wigIdx) return w;
            return { ...w, leadMeasures: w.leadMeasures.map((m, k) => (k === mIdx ? value : m)) };
          }),
        };
      }),
    }));
  }
  function addLeadMeasure(edpIdx, wigIdx) {
    setData((d) => ({
      ...d,
      edps: d.edps.map((e, i) => {
        if (i !== edpIdx) return e;
        return {
          ...e,
          wigs: e.wigs.map((w, j) => (j === wigIdx ? { ...w, leadMeasures: [...w.leadMeasures, ''] } : w)),
        };
      }),
    }));
  }
  function removeLeadMeasure(edpIdx, wigIdx, mIdx) {
    setData((d) => ({
      ...d,
      edps: d.edps.map((e, i) => {
        if (i !== edpIdx) return e;
        return {
          ...e,
          wigs: e.wigs.map((w, j) => {
            if (j !== wigIdx) return w;
            const next = w.leadMeasures.filter((_, k) => k !== mIdx);
            return { ...w, leadMeasures: next.length ? next : [''] };
          }),
        };
      }),
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      // Strip empties before persisting so the JSON stays clean.
      const cleaned = {
        description: (data.description || '').trim(),
        sectionStatus: data.sectionStatus || {},
        edps: (data.edps || [])
          .map((edp) => {
            const wigs = (edp.wigs || [])
              .map((w) => ({
                text: (w.text || '').trim(),
                leadMeasures: (w.leadMeasures || []).map((m) => String(m).trim()).filter(Boolean),
              }))
              .filter((w) => w.text || w.leadMeasures.length);
            const out = { header: (edp.header || '').trim(), wigs };
            if (edp.status) out.status = edp.status;
            return out;
          })
          .filter((edp) => edp.header || edp.wigs.length || edp.status),
      };
      if (isTemplate) {
        if (!tplName.trim()) {
          setErr('Template name is required');
          setSaving(false);
          return;
        }
        if (templateId != null) {
          await api.updateSowTemplate(templateId, {
            name: tplName.trim(),
            description: cleaned.description,
            data: cleaned,
            nextSteps,
          });
        } else {
          await api.createSowTemplate({
            ownerCompanyId: templateCompanyId,
            name: tplName.trim(),
            description: cleaned.description,
            department: templateDepartment,
            kind: 'edp',
            data: cleaned,
            nextSteps,
          });
        }
      } else {
        await api.saveEdp(processId, cleaned);
      }
      onSaved?.();
      onClose();
    } catch (e2) {
      setErr(e2.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const title = isTemplate
    ? (templateId != null ? 'Edit EDP template' : 'New EDP template')
    : (processName || 'EDP Alignment Notes');

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        {loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="edp-editor">

            {isTemplate && (
              <div className="field">
                <label htmlFor="edp-tpl-name">Template name</label>
                <input
                  id="edp-tpl-name"
                  type="text"
                  required
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="e.g. EDP Alignment Notes (Quarterly Development Focus)"
                  autoFocus
                  maxLength={255}
                />
              </div>
            )}

            <div className="field">
              <div className="jd-section-head" style={{ alignItems: 'baseline' }}>
                <label htmlFor="edp-description">Document description</label>
                {isTemplate && (
                  <AttentionPill
                    status={data.sectionStatus?.description}
                    onChange={(next) => setSectionStatus('description', next)}
                  />
                )}
              </div>
              {!isTemplate && isFlaggedStatus(data.sectionStatus?.description) && (
                <div className="jd-attention-banner">
                  <span>⚠ Needs review for this role — update before saving.</span>
                  <button
                    type="button"
                    className="btn-ghost jd-attention-clear"
                    onClick={() => setSectionStatus('description', null)}
                  >Mark reviewed</button>
                </div>
              )}
              <textarea
                id="edp-description"
                rows={3}
                value={data.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="Describe this document / template — what it's for, when it's reviewed, etc."
              />
              {isTemplate && (
                <small className="muted">
                  This description doubles as the template's library description.
                </small>
              )}
            </div>

            <div className="modal-section-title">EDPs</div>

            <div className="edp-list">
              {data.edps.map((edp, idx) => (
                <div key={idx} className="edp-card">
                  {!isTemplate && isFlaggedStatus(edp.status) && (
                    <div className="jd-attention-banner">
                      <span>⚠ Needs review for this role — update before saving.</span>
                      <button
                        type="button"
                        className="btn-ghost jd-attention-clear"
                        onClick={() => setEdpStatus(idx, null)}
                      >Mark reviewed</button>
                    </div>
                  )}
                  <div className="edp-card-head">
                    <span className="edp-card-num">EDP {idx + 1}</span>
                    <input
                      type="text"
                      className="edp-header-input"
                      value={edp.header}
                      onChange={(e) => updateEdp(idx, { header: e.target.value })}
                      placeholder="EDP header — what this focus area is about"
                      maxLength={500}
                    />
                    {isTemplate && (
                      <AttentionPill
                        status={edp.status}
                        onChange={(next) => setEdpStatus(idx, next)}
                      />
                    )}
                    <button
                      type="button"
                      className="btn-icon btn-icon-danger"
                      title="Remove EDP"
                      onClick={() => removeEdp(idx)}
                      aria-label={`Remove EDP ${idx + 1}`}
                    >×</button>
                  </div>

                  <div className="edp-wigs">
                    <label className="edp-sublabel">WIGs (Wildly Important Goals)</label>
                    {edp.wigs.map((wig, wIdx) => (
                      <div key={wIdx} className="edp-wig-card">
                        <div className="edp-wig-head">
                          <span className="edp-wig-num">WIG {wIdx + 1}</span>
                          <textarea
                            rows={2}
                            value={wig.text}
                            onChange={(e) => updateWig(idx, wIdx, { text: e.target.value })}
                            placeholder="e.g. Grow ARR from R10m to R15m by Q4."
                            maxLength={2000}
                          />
                          <button
                            type="button"
                            className="btn-icon btn-icon-danger"
                            title="Remove WIG"
                            onClick={() => removeWig(idx, wIdx)}
                            aria-label={`Remove WIG ${wIdx + 1}`}
                          >×</button>
                        </div>

                        <div className="edp-leads">
                          <label className="edp-sublabel">Lead Measures</label>
                          <ul className="edp-leads-list">
                            {wig.leadMeasures.map((m, mIdx) => (
                              <li key={mIdx} className="edp-lead-row">
                                <input
                                  type="text"
                                  value={m}
                                  onChange={(e) => updateLeadMeasure(idx, wIdx, mIdx, e.target.value)}
                                  placeholder="e.g. 5 qualified discovery calls / week"
                                  maxLength={500}
                                />
                                <button
                                  type="button"
                                  className="btn-icon btn-icon-danger"
                                  title="Remove lead measure"
                                  onClick={() => removeLeadMeasure(idx, wIdx, mIdx)}
                                  aria-label="Remove lead measure"
                                >×</button>
                              </li>
                            ))}
                          </ul>
                          <button type="button" className="btn-ghost kpa-add-sm" onClick={() => addLeadMeasure(idx, wIdx)}>
                            + Add lead measure
                          </button>
                        </div>
                      </div>
                    ))}
                    <button type="button" className="btn-ghost kpa-add-sm" onClick={() => addWig(idx)}>
                      + Add WIG
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn-ghost kpa-add" onClick={addEdp}>
                + Add EDP
              </button>
            </div>

            {isTemplate && (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Possible next tasks (workflow)</label>
                <NextStepsEditor
                  steps={nextSteps}
                  allTemplates={companyTemplates}
                  excludeId={templateId ?? null}
                  onChange={setNextSteps}
                />
              </div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving || loading}>
            {saving ? 'Saving…' : (isTemplate ? (templateId != null ? 'Save changes' : 'Create template') : 'Save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
