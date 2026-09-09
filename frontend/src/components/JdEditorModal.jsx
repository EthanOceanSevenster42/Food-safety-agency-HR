import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import NextStepsEditor from './NextStepsEditor.jsx';
import AttentionPill, { isFlagged as isFlaggedStatus } from './AttentionPill.jsx';
import { api } from '../api.js';

// Canonical empty Job Description body. Used as the starting point for a
// brand-new template *and* as the merge base when loading older saves
// that may be missing newer fields.
const EMPTY_JD = {
  title: '',
  location: '',
  hoursDescription: '',
  hoursPerWeek: '',
  workMode: 'office',            // 'office' | 'hybrid' | 'remote'
  hybridDays: [],                // ['Mon','Tue',...]
  reportToEmployeeId: null,
  compensation: '',
  aboutCompany: '',
  jobOverview: '',
  qualifications: [''],
  whyJoinUs: '',
  howToApply: '',
  // Per-section "needs attention" flags. Set in the template, copied
  // through to each task built from it, and cleared by the author when
  // they've reviewed/updated that section for the specific role.
  // Shape: { [sectionKey]: 'needs-attention' } — keys are omitted /
  // deleted when there's no flag.
  sectionStatus: {},
};

// Sections that can carry a needs-attention flag. Keys are also used as
// CSS hooks for the highlight ring. "Reports to" lives outside this set
// because it's always picked per-role anyway, so flagging it adds noise.
const FLAGGABLE_SECTIONS = [
  { key: 'role',          label: 'Role' },
  { key: 'aboutCompany',  label: 'About the company' },
  { key: 'jobOverview',   label: 'Job overview' },
  { key: 'qualifications', label: 'Qualifications & skills' },
  { key: 'whyJoinUs',     label: 'Why join us?' },
  { key: 'howToApply',    label: 'How to apply' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function normalise(raw) {
  const v = (raw && typeof raw === 'object') ? raw : {};
  return {
    ...EMPTY_JD,
    ...v,
    hybridDays: Array.isArray(v.hybridDays) ? v.hybridDays : [],
    qualifications: Array.isArray(v.qualifications) && v.qualifications.length ? v.qualifications : [''],
    sectionStatus: (v.sectionStatus && typeof v.sectionStatus === 'object') ? v.sectionStatus : {},
  };
}

// Editor for a Job Description — handles two modes:
//   templateMode=true  → edits a JD-kind row in dbo.SowTemplates
//                       (name + description + body + next-steps).
//   templateMode=false → edits a JD-kind ProjectProcesses row
//                       (body only + employee picker for "report to" +
//                        read-only Key Responsibilities pulled from the
//                        first KPA-kind task in the same project).
export default function JdEditorModal({
  // ---- Common ----
  onClose, onSaved,
  // ---- Task mode (one of: processId OR templateId+templateMode) ----
  processId, processName,
  // ---- Template mode ----
  templateMode = false,
  templateId,
  templateCompanyId,
  templateDepartment = 'Human Resources',
}) {
  const isTemplate = templateMode || templateId != null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  // Body of the JD — same shape in both modes. In template mode this is
  // the boilerplate; in task mode it's the per-role copy snapshotted from
  // the template on creation.
  const [data, setData] = useState(EMPTY_JD);

  // Template-mode-only fields:
  const [tplName, setTplName]   = useState('');
  const [tplDesc, setTplDesc]   = useState('');
  const [nextSteps, setNextSteps] = useState([]);
  const [companyTemplates, setCompanyTemplates] = useState([]);

  // Task-mode-only fields:
  const [employees, setEmployees]   = useState([]);
  const [kpaProcess, setKpaProcess] = useState(null);

  // PDF preview state — only meaningful in task mode (a saved process is
  // required server-side because the preview pulls the company's branding
  // via the process's project → company chain). Template-mode preview can
  // be added later if needed.
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    (async () => {
      try {
        if (isTemplate) {
          // Template mode — fetch (if editing) or start blank.
          if (templateId != null) {
            const t = await api.getSowTemplate(templateId);
            if (cancelled) return;
            setTplName(t?.name || '');
            setTplDesc(t?.description || '');
            setData(normalise(t?.data));
            setNextSteps(Array.isArray(t?.nextSteps) ? t.nextSteps : (
              Array.isArray(t?.nextTemplateIds) ? t.nextTemplateIds.map((id) => ({ templateId: id })) : []
            ));
          } else {
            setData(EMPTY_JD);
          }
          // Templates library for the workflow successor picker.
          const list = await api.listSowTemplates(templateCompanyId, templateDepartment);
          if (cancelled) return;
          setCompanyTemplates(Array.isArray(list) ? list : []);
        } else {
          // Task mode — fetch JD payload + sibling KPA process.
          const res = await api.getJd(processId);
          if (cancelled) return;
          setData(normalise(res?.data));
          setKpaProcess(res?.kpaProcess || null);
          // Load employees for the "Report to" dropdown.
          if (res?.companyId) {
            const emps = await api.listEmployees(res.companyId);
            if (cancelled) return;
            setEmployees(Array.isArray(emps) ? emps : []);
          }
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isTemplate, processId, templateId, templateCompanyId, templateDepartment]);

  // ---------- Body-field mutators ----------
  function patch(field, value) {
    setData((d) => ({ ...d, [field]: value }));
  }
  function toggleHybridDay(day) {
    setData((d) => {
      const set = new Set(d.hybridDays || []);
      if (set.has(day)) set.delete(day); else set.add(day);
      // Preserve declared day order so display is consistent.
      return { ...d, hybridDays: DAYS.filter((x) => set.has(x)) };
    });
  }
  function updateQualification(idx, value) {
    setData((d) => ({ ...d, qualifications: d.qualifications.map((q, i) => (i === idx ? value : q)) }));
  }
  function addQualification() {
    setData((d) => ({ ...d, qualifications: [...d.qualifications, ''] }));
  }
  function removeQualification(idx) {
    setData((d) => {
      const next = d.qualifications.filter((_, i) => i !== idx);
      return { ...d, qualifications: next.length ? next : [''] };
    });
  }

  // Set or clear a section's needs-attention flag. Used by both the
  // pill button in template mode and the "Mark reviewed" button in task
  // mode — passing null removes the key entirely so the persisted map
  // stays compact.
  function setStatus(key, value) {
    setData((d) => {
      const next = { ...(d.sectionStatus || {}) };
      if (value) next[key] = value; else delete next[key];
      return { ...d, sectionStatus: next };
    });
  }

  // Renders a section heading with either:
  //   - template mode: the shared AttentionPill (click toggle) — flag
  //     status is sticky on the template and copies through to every
  //     task built from it.
  //   - task mode: an amber banner above the section when the flag is
  //     set, with a "Mark reviewed" button that clears it.
  function SectionHeader({ sectionKey, title }) {
    const status = data.sectionStatus?.[sectionKey];
    const flagged = isFlaggedStatus(status);
    return (
      <>
        <div className="modal-section-title jd-section-head">
          <span>{title}</span>
          {isTemplate && (
            <AttentionPill status={status} onChange={(next) => setStatus(sectionKey, next)} />
          )}
        </div>
        {!isTemplate && flagged && (
          <div className="jd-attention-banner">
            <span>⚠ Needs review for this role — update before saving.</span>
            <button
              type="button"
              className="btn-ghost jd-attention-clear"
              onClick={() => setStatus(sectionKey, null)}
            >
              Mark reviewed
            </button>
          </div>
        )}
      </>
    );
  }

  // ---------- Submit ----------
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      // Strip empty qualifications before storing.
      const cleaned = {
        ...data,
        hoursPerWeek: data.hoursPerWeek === '' || data.hoursPerWeek == null
          ? null
          : Number(data.hoursPerWeek),
        reportToEmployeeId: data.reportToEmployeeId
          ? parseInt(data.reportToEmployeeId, 10)
          : null,
        qualifications: (data.qualifications || []).map((q) => String(q).trim()).filter(Boolean),
        hybridDays: data.workMode === 'hybrid' ? (data.hybridDays || []) : [],
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
            description: tplDesc.trim(),
            data: cleaned,
            nextSteps,
          });
        } else {
          await api.createSowTemplate({
            ownerCompanyId: templateCompanyId,
            name: tplName.trim(),
            description: tplDesc.trim(),
            department: templateDepartment,
            kind: 'jd',
            data: cleaned,
            nextSteps,
          });
        }
      } else {
        await api.saveJd(processId, cleaned);
      }
      onSaved?.();
      onClose();
    } catch (e2) {
      setErr(e2.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Flatten the linked KPA payload into a readable "Key responsibilities"
  // block. Each KPA becomes a header, its KPIs become bullets underneath.
  const responsibilities = useMemo(() => {
    if (!kpaProcess || !Array.isArray(kpaProcess.kpas)) return [];
    return kpaProcess.kpas
      .map((k) => ({
        area: k.name || k.department || '',
        weight: k.weight,
        kpis: Array.isArray(k.kpis) ? k.kpis : (
          // legacy flat shape: { kpi, measures }
          k.kpi || (Array.isArray(k.measures) && k.measures.length)
            ? [{ description: k.kpi || '', measures: Array.isArray(k.measures) ? k.measures : [] }]
            : []
        ),
      }))
      .filter((k) => k.area || k.kpis.length);
  }, [kpaProcess]);

  const title = isTemplate
    ? (templateId != null ? 'Edit JD template' : 'New JD template')
    : (processName || 'Job Description');

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        {loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="jd-editor">

            {isTemplate && (
              <>
                <div className="field">
                  <label htmlFor="jd-tpl-name">Template name</label>
                  <input
                    id="jd-tpl-name"
                    type="text"
                    required
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder="e.g. Senior Engineer JD"
                    autoFocus
                    maxLength={255}
                  />
                </div>
                <div className="field">
                  <label htmlFor="jd-tpl-desc">Template description (optional)</label>
                  <textarea
                    id="jd-tpl-desc"
                    rows={2}
                    value={tplDesc}
                    onChange={(e) => setTplDesc(e.target.value)}
                    placeholder="What this JD template is for"
                  />
                </div>
                <div className="muted small" style={{ marginBottom: 12 }}>
                  The body below is the <strong>default content</strong> for every JD task built from this template. Authors can tweak per role.
                </div>
              </>
            )}

            <SectionHeader sectionKey="role" title="Role" />

            <div className="field-row">
              <div className="field">
                <label htmlFor="jd-title">Title</label>
                <input
                  id="jd-title"
                  type="text"
                  value={data.title}
                  onChange={(e) => patch('title', e.target.value)}
                  placeholder="e.g. Senior Backend Engineer"
                  maxLength={255}
                />
              </div>
              <div className="field">
                <label htmlFor="jd-location">Location</label>
                <input
                  id="jd-location"
                  type="text"
                  value={data.location}
                  onChange={(e) => patch('location', e.target.value)}
                  placeholder="e.g. Pretoria"
                  maxLength={255}
                />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="jd-hours-desc">Working hours</label>
                <input
                  id="jd-hours-desc"
                  type="text"
                  value={data.hoursDescription}
                  onChange={(e) => patch('hoursDescription', e.target.value)}
                  placeholder="e.g. Mon–Fri 08:00–17:00"
                  maxLength={255}
                />
              </div>
              <div className="field">
                <label htmlFor="jd-hours-per-week">Hours per week</label>
                <input
                  id="jd-hours-per-week"
                  type="number"
                  min="0"
                  max="168"
                  value={data.hoursPerWeek ?? ''}
                  onChange={(e) => patch('hoursPerWeek', e.target.value)}
                  placeholder="40"
                />
              </div>
            </div>

            <div className="field">
              <label>Work arrangement</label>
              <div className="jd-work-mode">
                {[
                  { v: 'office', label: 'Office-based' },
                  { v: 'hybrid', label: 'Hybrid' },
                  { v: 'remote', label: 'Fully remote' },
                ].map((opt) => (
                  <label key={opt.v} className="checkbox-row">
                    <input
                      type="radio"
                      name={`workmode-${isTemplate ? 't' : 'p'}`}
                      checked={data.workMode === opt.v}
                      onChange={() => patch('workMode', opt.v)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
              {data.workMode === 'hybrid' && (
                <div className="jd-hybrid-days">
                  <span className="muted small">Days in office:</span>
                  {DAYS.map((d) => {
                    const on = (data.hybridDays || []).includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        className={'kpa-cv-chip' + (on ? ' is-on' : '')}
                        aria-pressed={on}
                        onClick={() => toggleHybridDay(d)}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {!isTemplate && (
              <div className="field">
                <label htmlFor="jd-report-to">Reports to</label>
                <select
                  id="jd-report-to"
                  value={data.reportToEmployeeId ?? ''}
                  onChange={(e) => patch('reportToEmployeeId', e.target.value || null)}
                >
                  <option value="">— Select an employee —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}{emp.title ? ` · ${emp.title}` : ''}
                    </option>
                  ))}
                </select>
                {employees.length === 0 && (
                  <small className="muted">No employees yet for this company.</small>
                )}
              </div>
            )}
            {isTemplate && (
              <div className="muted small" style={{ marginBottom: 12 }}>
                "Reports to" is picked per-role when a JD task is created — not on the template.
              </div>
            )}

            <div className="field">
              <label htmlFor="jd-compensation">Compensation</label>
              <textarea
                id="jd-compensation"
                rows={2}
                value={data.compensation}
                onChange={(e) => patch('compensation', e.target.value)}
                placeholder="e.g. R 45 000 – R 60 000 per month, depending on experience"
              />
            </div>

            <SectionHeader sectionKey="aboutCompany" title="About the company" />
            <div className="field">
              <textarea
                rows={4}
                value={data.aboutCompany}
                onChange={(e) => patch('aboutCompany', e.target.value)}
                placeholder="A short paragraph about the company. Edit per role if needed."
              />
            </div>

            <SectionHeader sectionKey="jobOverview" title="Job overview" />
            <div className="field">
              <textarea
                rows={4}
                value={data.jobOverview}
                onChange={(e) => patch('jobOverview', e.target.value)}
                placeholder="What this role is about and what success looks like."
              />
            </div>

            {!isTemplate && (
              <>
                <div className="modal-section-title">Key responsibilities</div>
                {responsibilities.length === 0 ? (
                  <div className="muted small" style={{ marginBottom: 12 }}>
                    No KPA task found in this project yet — once you create a KPA task and save its KPAs, they'll appear here automatically.
                  </div>
                ) : (
                  <div className="jd-kpa-pull">
                    <small className="muted" style={{ display: 'block', marginBottom: 8 }}>
                      Pulled from KPA task <em>{kpaProcess?.name}</em>{kpaProcess?.employeeName ? <> ({kpaProcess.employeeName})</> : null}. Update those KPAs to change this list.
                    </small>
                    {responsibilities.map((r, i) => (
                      <div key={i} className="jd-kpa-area">
                        <div className="jd-kpa-area-head">
                          <strong>{r.area || '— no area —'}</strong>
                          {Number.isFinite(Number(r.weight)) && r.weight > 0 && (
                            <span className="muted small"> · {Number(r.weight).toFixed(2)}%</span>
                          )}
                        </div>
                        <ul className="jd-kpa-kpi-list">
                          {r.kpis.map((kk, j) => (
                            <li key={j}>
                              {kk.description || <span className="muted">—</span>}
                              {Array.isArray(kk.measures) && kk.measures.length > 0 && (
                                <ul className="jd-kpa-measure-list">
                                  {kk.measures.map((m, mi) => <li key={mi}>{m}</li>)}
                                </ul>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {isTemplate && (
              <div className="muted small" style={{ marginBottom: 12 }}>
                Key Responsibilities are pulled automatically from the project's KPA task at JD-task time — not stored on the template.
              </div>
            )}

            <SectionHeader sectionKey="qualifications" title="Qualifications & skills" />
            <div className="kpa-measures">
              <ul className="kpa-measures-list" style={{ paddingLeft: 0 }}>
                {data.qualifications.map((q, idx) => (
                  <li key={idx} className="kpa-measure-row">
                    <span className="kpa-measure-bullet" aria-hidden>•</span>
                    <input
                      type="text"
                      value={q}
                      onChange={(e) => updateQualification(idx, e.target.value)}
                      placeholder="e.g. BSc Computer Science or equivalent experience"
                      maxLength={500}
                    />
                    <button
                      type="button"
                      className="btn-icon btn-icon-danger"
                      title="Remove qualification"
                      onClick={() => removeQualification(idx)}
                      aria-label="Remove qualification"
                    >×</button>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn-ghost kpa-add" onClick={addQualification}>
                + Add qualification
              </button>
            </div>

            <SectionHeader sectionKey="whyJoinUs" title="Why join us?" />
            <div className="field">
              <textarea
                rows={4}
                value={data.whyJoinUs}
                onChange={(e) => patch('whyJoinUs', e.target.value)}
                placeholder="What makes this an attractive place to work."
              />
            </div>

            <SectionHeader sectionKey="howToApply" title="How to apply" />
            <div className="field">
              <textarea
                rows={3}
                value={data.howToApply}
                onChange={(e) => patch('howToApply', e.target.value)}
                placeholder="Where to send applications, expected materials, deadline."
              />
            </div>

            {isTemplate && (
              <>
                <div className="field" style={{ marginTop: 12 }}>
                  <label>Possible next tasks (workflow)</label>
                  <NextStepsEditor
                    steps={nextSteps}
                    allTemplates={companyTemplates}
                    excludeId={templateId ?? null}
                    onChange={setNextSteps}
                  />
                </div>
              </>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          {!isTemplate && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setPreviewing(true)}
              disabled={loading || saving}
              title="Render the JD as a PDF with the company's branding"
            >
              Preview PDF
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={saving || loading}>
            {saving ? 'Saving…' : (isTemplate ? (templateId != null ? 'Save changes' : 'Create template') : 'Save')}
          </button>
        </div>
      </form>
      {previewing && (
        <JdPreview
          processId={processId}
          processName={processName}
          data={data}
          onClose={() => setPreviewing(false)}
        />
      )}
    </Modal>
  );
}

// JD PDF preview — mirrors SowPreview. The backend renders the JD with
// the company's branded letterhead / typography and returns a PDF blob;
// the browser's native PDF viewer renders it inside the iframe so what
// you see here is byte-identical to a downloaded copy.
function JdPreview({ processId, processName, data, onClose }) {
  const [blobUrl, setBlobUrl] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let createdUrl = '';
    setStatus('loading');
    setError('');
    (async () => {
      try {
        const blob = await api.previewJdPdf(processId, data);
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
  }, [processId, data]);

  return (
    <div className="sow-preview-overlay" onMouseDown={onClose}>
      <div className="sow-preview-shell" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sow-preview-toolbar">
          <strong>{processName ? `${processName} · Preview` : 'Job Description Preview'}</strong>
          <span className="muted small">Exact render of the PDF that will be saved.</span>
          <button type="button" className="btn-ghost" onClick={onClose}>Close preview</button>
        </div>
        <div className="sow-preview-pages">
          {status === 'loading' && <div className="sow-preview-loading muted">Generating PDF preview…</div>}
          {status === 'error'   && <div className="sow-preview-loading"><div className="error">{error}</div></div>}
          {status === 'ready' && blobUrl && (
            <iframe src={blobUrl} title="JD PDF preview" className="sow-preview-iframe" />
          )}
        </div>
      </div>
    </div>
  );
}
