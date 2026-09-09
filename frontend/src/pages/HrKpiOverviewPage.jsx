import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { auth } from '../auth.js';
import { canEdit as canEditSeg } from '../roles.js';
import Modal from '../components/Modal.jsx';
import KpiOrgChart from '../components/KpiOrgChart.jsx';
import CompanyGrid from '../components/CompanyGrid.jsx';
import EmployeeAnalysisModal from '../components/EmployeeAnalysisModal.jsx';
import ReadOnlyBanner from '../components/ReadOnlyBanner.jsx';
import { confirmDialog } from '../confirm.js';

const FREQUENCY_OPTIONS = [
  { value: 'Quarterly',  label: 'Quarterly' },
  { value: 'BiAnnually', label: 'Bi-annually' },
  { value: 'Annually',   label: 'Annually' },
];

function frequencyLabel(value) {
  return FREQUENCY_OPTIONS.find((o) => o.value === value)?.label || value;
}

export default function HrKpiOverviewPage() {
  const canEdit = canEditSeg(auth.getUser(), 'hr_kpi');
  const canEditCompanies = canEditSeg(auth.getUser(), 'companies');
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [companyFrequency, setCompanyFrequency] = useState('Quarterly');

  const [employeeModal, setEmployeeModal] = useState(null);
  const [kpiTarget, setKpiTarget]   = useState(null); // employee whose KPI panel is open
  const [showSettings, setShowSettings] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [startReviewTarget, setStartReviewTarget] = useState(null); // employee to start a review for
  const [reviewDetailId, setReviewDetailId] = useState(null);       // review to view read-only
  const [analysisTarget, setAnalysisTarget] = useState(null);       // employee whose analysis is open
  const [exporting, setExporting] = useState(false);                // org-chart PDF export in progress

  const selectedCompany = companies.find((c) => c.id === selectedId) || null;

  const trackedEmployees = useMemo(
    () => employees.filter((e) => !e.kpiExempt),
    [employees]
  );

  async function loadCompanies() {
    setLoading(true);
    try {
      const list = await api.listCompanies();
      setCompanies(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCompanyDetail(companyId) {
    if (!companyId) {
      setEmployees([]);
      setSessions([]);
      setReviews([]);
      return;
    }
    try {
      const [emps, sess, settings, revs] = await Promise.all([
        api.listEmployees(companyId),
        api.listKpiSessionsByCompany(companyId),
        api.getCompanyKpiSettings(companyId).catch(() => ({ kpiFrequency: 'Quarterly' })),
        api.listKpiReviews(companyId).catch(() => []),
      ]);
      setEmployees(emps);
      setSessions(sess);
      setCompanyFrequency(settings.kpiFrequency || 'Quarterly');
      setReviews(Array.isArray(revs) ? revs : []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadCompanies(); }, []);
  useEffect(() => { loadCompanyDetail(selectedId); }, [selectedId]);

  async function handleSaveEmployee(form) {
    if (employeeModal.mode === 'create') {
      await api.createEmployee({
        companyId: selectedId,
        name: form.name,
        title: form.title,
        email: form.email,
        department: form.department,
        managerId: form.managerId || null,
        additionalManagerIds: form.additionalManagerIds || [],
      });
    } else {
      await api.updateEmployee(employeeModal.preset.id, {
        name: form.name,
        title: form.title,
        email: form.email,
        department: form.department,
        managerId: form.managerId || null,
        additionalManagerIds: form.additionalManagerIds || [],
      });
    }
    // KPI flags are stored on a separate endpoint (kpiExempt / override)
    if (employeeModal.mode !== 'create') {
      try {
        await api.updateEmployeeKpiSettings(employeeModal.preset.id, {
          kpiExempt: form.kpiExempt,
          kpiFrequencyOverride: form.kpiFrequencyOverride || null,
        });
      } catch (err) {
        console.warn('[hr/employee] failed to save KPI settings:', err.message);
      }
    }
    setEmployeeModal(null);
    await loadCompanyDetail(selectedId);
    await loadCompanies();
  }

  async function handleDeleteEmployee(emp) {
    if (!(await confirmDialog({
      title: `Remove ${emp.name}?`,
      body: 'Their KPI history is deleted and any allocated assets return to storage.',
      tone: 'danger',
      confirmLabel: 'Remove employee',
    }))) return;
    await api.deleteEmployee(emp.id);
    await loadCompanyDetail(selectedId);
    await loadCompanies();
  }

  async function handleDeleteCompany(company = selectedCompany) {
    if (!company) return;
    if (!(await confirmDialog({
      title: `Delete "${company.name}"?`,
      body: 'Every employee, asset and KPI record on this company is deleted with it. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete company',
    }))) return;
    try {
      await api.deleteCompany(company.id);
      if (selectedId === company.id) setSelectedId(null);
      await loadCompanies();
    } catch (e) { setError(e.message); }
  }

  async function handleMoveEmployee(empId, newManagerId) {
    const emp = employees.find((e) => e.id === empId);
    if (!emp || emp.managerId === newManagerId) return;
    setEmployees((prev) =>
      prev.map((e) => (e.id === empId ? { ...e, managerId: newManagerId } : e))
    );
    try {
      await api.updateEmployee(empId, {
        name: emp.name,
        title: emp.title,
        email: emp.email,
        department: emp.department,
        managerId: newManagerId,
      });
    } catch (err) {
      setError(err.message);
      await loadCompanyDetail(selectedId);
    }
  }

  // Download the branded, signed KPI document for a completed review straight
  // from the employee card — same on-demand PDF as the analysis view.
  async function handleDownloadReviewDoc(rv) {
    try {
      const { blob, filename } = await api.downloadReviewDocument(rv.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setError(err.message);
    }
  }

  // Export the company's organogram (name · department · email) as a PDF.
  async function handleExportOrg() {
    setExporting(true);
    setError('');
    try {
      const { blob, filename } = await api.downloadCompanyOrgPdf(selectedId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleSaveCompanyFrequency(value) {
    try {
      const r = await api.updateCompanyKpiSettings(selectedId, { kpiFrequency: value });
      setCompanyFrequency(r.kpiFrequency);
      setShowSettings(false);
      await loadCompanies();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return <div className="page"><div className="muted">Loading…</div></div>;
  }

  // Drill-down: KPI org chart for the selected company
  if (selectedCompany) {
    const brandStyle = selectedCompany.brandColor
      ? { '--co-brand': selectedCompany.brandColor }
      : undefined;
    return (
      <div className="page" style={brandStyle} data-brand={selectedCompany.brandColor || undefined}>
        <button className="btn-ghost back-btn" onClick={() => setSelectedId(null)}>
          ← All companies
        </button>
        <header className="page-header">
          <div className="company-detail-head">
            {selectedCompany.logoUrl ? (
              <img className="company-logo-lg" src={selectedCompany.logoUrl} alt={selectedCompany.name} />
            ) : (
              <div className="company-logo-lg company-logo-placeholder">{selectedCompany.name.slice(0, 2).toUpperCase()}</div>
            )}
            <div>
              <h1>{selectedCompany.name} · KPI Tracker</h1>
              <p className="muted">
                {trackedEmployees.length} staff tracked · default cadence <strong>{frequencyLabel(companyFrequency)}</strong>
              </p>
            </div>
          </div>
          <div className="page-actions">
            <button
              className="btn-ghost"
              onClick={handleExportOrg}
              disabled={exporting || employees.length === 0}
              title="Export the organogram (name, department & contact) as a PDF"
            >
              {exporting ? 'Exporting…' : '⤓ Export org chart (PDF)'}
            </button>
            {canEdit && <button className="btn-ghost" onClick={() => setShowSettings(true)}>KPI settings</button>}
            {canEdit && (
              <button
                className="btn-primary"
                onClick={() => setEmployeeModal({ mode: 'create', preset: { managerId: '' } })}
              >
                + Add Employee
              </button>
            )}
            {canEditCompanies && (
              <button className="btn-ghost danger" onClick={() => handleDeleteCompany(selectedCompany)}>Delete company</button>
            )}
          </div>
        </header>

        {!canEdit && <ReadOnlyBanner label="HR & KPI" />}
        {error && <div className="error" onClick={() => setError('')}>{error}</div>}

        {employees.length === 0 ? (
          <div className="empty-state">
            <p>No employees in {selectedCompany.name} yet.</p>
            {canEdit && <p className="muted">Staff are shared with Allocated Assets — adding someone here also adds them there.</p>}
            {canEdit && (
              <button
                className="btn-primary"
                onClick={() => setEmployeeModal({ mode: 'create', preset: { managerId: '' } })}
              >
                + Add first employee
              </button>
            )}
          </div>
        ) : (
          <KpiOrgChart
            employees={employees}
            sessions={sessions}
            reviews={reviews}
            companyFrequency={companyFrequency}
            readOnly={!canEdit}
            onAddReport={(parent) => setEmployeeModal({ mode: 'create', preset: { managerId: parent.id } })}
            onEdit={(emp) => setEmployeeModal({ mode: 'edit', preset: emp })}
            onDelete={handleDeleteEmployee}
            onMove={handleMoveEmployee}
            onOpenKpi={(emp) => setKpiTarget(emp)}
            onStartReview={(emp) => setStartReviewTarget(emp)}
            onOpenReview={(rv) => setReviewDetailId(rv.id)}
            onDownloadReview={handleDownloadReviewDoc}
            onOpenAnalysis={(emp) => setAnalysisTarget(emp)}
          />
        )}

        {analysisTarget && (
          <EmployeeAnalysisModal
            employee={analysisTarget}
            onClose={() => setAnalysisTarget(null)}
          />
        )}

        {employeeModal && (
          <HrEmployeeModal
            mode={employeeModal.mode}
            preset={employeeModal.preset}
            employees={employees}
            companyFrequency={companyFrequency}
            onClose={() => setEmployeeModal(null)}
            onSave={handleSaveEmployee}
          />
        )}

        {showSettings && (
          <CompanyKpiSettingsModal
            companyName={selectedCompany.name}
            value={companyFrequency}
            onClose={() => setShowSettings(false)}
            onSave={handleSaveCompanyFrequency}
          />
        )}

        {kpiTarget && (
          <KpiSessionsModal
            employee={kpiTarget}
            companyFrequency={companyFrequency}
            onClose={() => setKpiTarget(null)}
            onChanged={() => loadCompanyDetail(selectedId)}
          />
        )}

        {startReviewTarget && (
          <StartReviewModal
            employee={startReviewTarget}
            employees={employees}
            companyId={selectedId}
            companyFrequency={companyFrequency}
            onClose={() => setStartReviewTarget(null)}
            onStarted={() => { setStartReviewTarget(null); loadCompanyDetail(selectedId); }}
          />
        )}

        {reviewDetailId && (
          <ReviewDetailModal
            reviewId={reviewDetailId}
            readOnly={!canEdit}
            onClose={() => setReviewDetailId(null)}
            onDeleted={() => { setReviewDetailId(null); loadCompanyDetail(selectedId); }}
          />
        )}
      </div>
    );
  }

  // Grid view
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Human Resources · KPI Tracker</h1>
          <p className="muted">
            Click a company to view its organogram and manage staff KPI documents.
            Staff details are shared with Allocated Assets.
          </p>
        </div>
      </header>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {companies.length === 0 ? (
        <div className="empty-state">
          <p>No companies yet. Add one from the Allocated Assets page first.</p>
        </div>
      ) : (
        <CompanyGrid
          companies={companies}
          onSelect={(c) => setSelectedId(c.id)}
          onAddCompany={() => {
            confirmDialog({
              variant: 'alert',
              title: 'Add companies from Equipment & assets',
              body: 'Companies are created there so branding and asset categories stay in one place.',
            });
          }}
          onDelete={canEditCompanies ? handleDeleteCompany : undefined}
          countLabel={(c) => {
            const cad = c.kpiFrequency ? ` · ${frequencyLabel(c.kpiFrequency)}` : '';
            return `${c.employeeCount} employee${c.employeeCount === 1 ? '' : 's'}${cad}`;
          }}
        />
      )}
    </div>
  );
}

function HrEmployeeModal({ mode, preset, employees, companyFrequency, onClose, onSave }) {
  const [name, setName] = useState(preset?.name ?? '');
  const [title, setTitle] = useState(preset?.title ?? '');
  const [email, setEmail] = useState(preset?.email ?? '');
  const [department, setDepartment] = useState(preset?.department ?? '');
  const [managerId, setManagerId] = useState(preset?.managerId ?? '');
  const [additionalManagerIds, setAdditionalManagerIds] = useState(
    Array.isArray(preset?.additionalManagerIds) ? preset.additionalManagerIds : []
  );
  const [kpiExempt, setKpiExempt] = useState(!!preset?.kpiExempt);
  const [kpiFrequencyOverride, setKpiFrequencyOverride] = useState(preset?.kpiFrequencyOverride ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const managerOptions = employees.filter((e) => e.id !== preset?.id);
  const primaryNum = managerId === '' ? null : Number(managerId);
  const additionalOptions = managerOptions.filter((e) => e.id !== primaryNum);
  const toggleAdditional = (eid) =>
    setAdditionalManagerIds((prev) => (prev.includes(eid) ? prev.filter((x) => x !== eid) : [...prev, eid]));
  const existingDepartments = Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort();

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        title: title.trim(),
        email: email.trim(),
        department: department.trim(),
        managerId: primaryNum,
        additionalManagerIds: additionalManagerIds.filter((x) => x !== primaryNum),
        kpiExempt,
        kpiFrequencyOverride: kpiFrequencyOverride || null,
      });
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === 'create' ? 'Add Employee' : 'Edit Employee'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        <div className="field">
          <label htmlFor="hr-emp-name">Name</label>
          <input id="hr-emp-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="hr-emp-title">Title / Role</label>
          <input id="hr-emp-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CEO, Operations Manager" />
        </div>
        <div className="field">
          <label htmlFor="hr-emp-dept">Department</label>
          <input
            id="hr-emp-dept"
            type="text"
            list="hr-emp-dept-options"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="e.g. IT, Sales, Operations"
          />
          <datalist id="hr-emp-dept-options">
            {existingDepartments.map((d) => <option key={d} value={d} />)}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="hr-emp-email">Email (optional)</label>
          <input id="hr-emp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hr-emp-mgr">Reports to (primary manager)</label>
          <select id="hr-emp-mgr" value={managerId ?? ''} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">— Top of organisation —</option>
            {managerOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}{e.title ? ` · ${e.title}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Also reports to (optional)</label>
          {additionalOptions.length === 0 ? (
            <p className="muted small">Add other employees first to assign extra managers.</p>
          ) : (
            <div className="kpi-pick-list">
              {additionalOptions.map((e) => (
                <label key={e.id} className="kpi-pick-row">
                  <input
                    type="checkbox"
                    checked={additionalManagerIds.includes(e.id)}
                    onChange={() => toggleAdditional(e.id)}
                  />
                  <span>{e.name}{e.title ? ` · ${e.title}` : ''}</span>
                </label>
              ))}
            </div>
          )}
          <p className="muted small">
            Extra managers this person also reports to. Any of their managers can run a KPI review,
            and all can view their completed reviews.
          </p>
        </div>

        {mode !== 'create' && (
          <fieldset className="kpi-fieldset">
            <legend>KPI tracking</legend>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={kpiExempt}
                onChange={(e) => setKpiExempt(e.target.checked)}
              />
              <span>Exempt this person from KPI sessions (e.g. CEO)</span>
            </label>
            <div className="field" style={{ opacity: kpiExempt ? 0.4 : 1 }}>
              <label htmlFor="hr-emp-freq">KPI cadence</label>
              <select
                id="hr-emp-freq"
                value={kpiFrequencyOverride}
                onChange={(e) => setKpiFrequencyOverride(e.target.value)}
                disabled={kpiExempt}
              >
                <option value="">Use company default ({frequencyLabel(companyFrequency)})</option>
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </fieldset>
        )}
        {mode === 'create' && (
          <p className="muted" style={{ marginTop: 8 }}>
            KPI cadence and exemption can be configured after the employee is created.
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : mode === 'create' ? 'Add' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CompanyKpiSettingsModal({ companyName, value, onClose, onSave }) {
  const [freq, setFreq] = useState(value || 'Quarterly');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await onSave(freq);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`KPI settings · ${companyName}`} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        <p className="muted" style={{ marginBottom: 12 }}>
          This sets the default KPI session cadence for everyone in the company.
          Individual staff can override or be exempted from their card.
        </p>
        <div className="field">
          <label htmlFor="co-kpi-freq">Default cadence</label>
          <select id="co-kpi-freq" value={freq} onChange={(e) => setFreq(e.target.value)}>
            {FREQUENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function KpiSessionsModal({ employee, companyFrequency, onClose, onChanged }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [periodLabel, setPeriodLabel] = useState(suggestPeriod(employee, companyFrequency));
  const [sessionDate, setSessionDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const list = await api.listKpiSessions(employee.id);
      setSessions(list);
    } catch (error) {
      setErr(error.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [employee.id]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!periodLabel.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await api.createKpiSession(employee.id, {
        periodLabel: periodLabel.trim(),
        sessionDate,
        notes: notes.trim(),
        documentFile: file,
      });
      setPeriodLabel(suggestPeriod(employee, companyFrequency, sessions.length + 1));
      setSessionDate(today());
      setNotes('');
      setFile(null);
      setAdding(false);
      await load();
      onChanged?.();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(s) {
    if (!(await confirmDialog({
      title: `Delete the ${s.periodLabel} session?`,
      body: `${employee.name}'s session and any document on it are removed.`,
      tone: 'danger',
      confirmLabel: 'Delete session',
    }))) return;
    try {
      await api.deleteKpiSession(s.id);
      await load();
      onChanged?.();
    } catch (error) {
      setErr(error.message);
    }
  }

  async function handleReplaceFile(s, newFile) {
    if (!newFile) return;
    try {
      await api.updateKpiSession(s.id, { documentFile: newFile });
      await load();
      onChanged?.();
    } catch (error) {
      setErr(error.message);
    }
  }

  return (
    <Modal
      title={`KPI sessions · ${employee.name}`}
      onClose={onClose}
      cardClassName="modal-kpi-sessions"
    >
      {err && <div className="error" onClick={() => setErr('')}>{err}</div>}

      <div className="kpi-modal-toolbar">
        <span className="muted">
          Cadence: <strong>{employee.kpiFrequencyOverride
            ? `${frequencyLabel(employee.kpiFrequencyOverride)} (override)`
            : frequencyLabel(companyFrequency)}</strong>
        </span>
        {!adding && (
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            + New session
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="kpi-add-form">
          <div className="kpi-add-grid">
          <div className="field">
            <label htmlFor="kpi-period">Period</label>
            <input
              id="kpi-period"
              type="text"
              required
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder="e.g. Q1 2026"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="kpi-date">Session date</label>
            <input
              id="kpi-date"
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="kpi-doc">KPI document</label>
            <input
              id="kpi-doc"
              type="file"
              accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <small className="muted">PDF preferred. Up to 25 MB.</small>
          </div>
          <div className="field">
            <label htmlFor="kpi-notes">Notes</label>
            <textarea
              id="kpi-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth recording about this session…"
            />
          </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save session'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="muted">Loading sessions…</div>
      ) : sessions.length === 0 && !adding ? (
        <div className="muted" style={{ padding: '12px 0' }}>
          No KPI sessions recorded yet for {employee.name}.
        </div>
      ) : (
        <ul className="kpi-session-list">
          {sessions.map((s) => (
            <li key={s.id} className="kpi-session-item">
              <div className="kpi-session-row">
                <div className="kpi-session-info">
                  <strong>{s.periodLabel}</strong>
                  {s.sessionDate && <span className="muted"> · {formatDate(s.sessionDate)}</span>}
                </div>
                <div className="kpi-session-actions">
                  {s.documentUrl ? (
                    <a className="btn-ghost" href={s.documentUrl} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    <label className="btn-ghost" style={{ cursor: 'pointer' }}>
                      Upload
                      <input
                        type="file"
                        style={{ display: 'none' }}
                        accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
                        onChange={(e) => handleReplaceFile(s, e.target.files?.[0])}
                      />
                    </label>
                  )}
                  {s.documentUrl && (
                    <label className="btn-ghost" style={{ cursor: 'pointer' }}>
                      Replace
                      <input
                        type="file"
                        style={{ display: 'none' }}
                        accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
                        onChange={(e) => handleReplaceFile(s, e.target.files?.[0])}
                      />
                    </label>
                  )}
                  <button className="btn-ghost danger" onClick={() => handleDelete(s)}>Delete</button>
                </div>
              </div>
              {s.originalName && <div className="muted kpi-session-filename">{s.originalName}</div>}
              {s.notes && <div className="kpi-session-notes">{s.notes}</div>}
              {s.uploadedBy && (
                <div className="muted kpi-session-uploaded">
                  Recorded by {s.uploadedBy}{s.createdAt ? ` · ${formatDate(s.createdAt)}` : ''}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="modal-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// Admin flow: pick which project KPA (and which of its KPIs) a review
// pulls through, set the period, and start it — the employee is emailed a
// link to complete their self-assessment.
function StartReviewModal({ employee, employees = [], companyId, companyFrequency, onClose, onStarted }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [periodLabel, setPeriodLabel] = useState(
    suggestPeriod(employee, employee.kpiFrequencyOverride || companyFrequency)
  );
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  // Allocated managers = primary (employee.managerId) + additional. Any of
  // them can conduct the review; default to the primary manager.
  const allocatedManagerIds = [
    ...(employee.managerId ? [employee.managerId] : []),
    ...(Array.isArray(employee.additionalManagerIds) ? employee.additionalManagerIds : []),
  ];
  const allocatedManagers = allocatedManagerIds
    .map((id) => employees.find((e) => e.id === id))
    .filter(Boolean);
  const [conductorId, setConductorId] = useState(allocatedManagerIds[0] ?? '');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.listKpaSources(companyId, employee.id)
      .then((list) => {
        if (cancelled) return;
        const arr = Array.isArray(list) ? list : [];
        setSources(arr);
        if (arr[0]) {
          setSourceId(String(arr[0].processId));
          setSelected(new Set(arr[0].kpis.map((_, i) => i)));
        }
      })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, employee.id]);

  const source = sources.find((s) => String(s.processId) === String(sourceId)) || null;

  function pickSource(id) {
    setSourceId(id);
    const s = sources.find((x) => String(x.processId) === String(id));
    setSelected(new Set((s?.kpis || []).map((_, i) => i)));
  }
  function toggle(i) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (!source || selected.size === 0 || !periodLabel.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const all = source.kpis.map((_, i) => i);
      const picked = all.filter((i) => selected.has(i));
      await api.createKpiReview({
        employeeId: employee.id,
        sourceProcessId: source.processId,
        periodLabel: periodLabel.trim(),
        // Omit when every KPI is included so the server snapshots them all.
        selectedKpiIndices: picked.length === all.length ? undefined : picked,
        managerId: conductorId === '' ? undefined : Number(conductorId),
      });
      onStarted?.();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Start KPI review · ${employee.name}`} onClose={onClose}>
      {err && <div className="error" onClick={() => setErr('')}>{err}</div>}
      {loading ? (
        <div className="muted">Loading KPIs…</div>
      ) : sources.length === 0 ? (
        <div className="muted" style={{ padding: '12px 0' }}>
          No KPA task with KPIs found for {employee.name}. Create a KPA task for them in an HR project first.
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="rv-source">Pull KPIs from</label>
            <select id="rv-source" value={sourceId} onChange={(e) => pickSource(e.target.value)}>
              {sources.map((s) => (
                <option key={s.processId} value={s.processId}>
                  {s.projectName} · {s.processName} ({s.kpiCount} KPI{s.kpiCount === 1 ? '' : 's'})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rv-period">Review period</label>
            <input
              id="rv-period"
              type="text"
              required
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder="e.g. Q1 2026"
            />
          </div>
          {allocatedManagers.length > 1 && (
            <div className="field">
              <label htmlFor="rv-manager">Conducted by</label>
              <select id="rv-manager" value={conductorId} onChange={(e) => setConductorId(e.target.value)}>
                {allocatedManagers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.title ? ` · ${m.title}` : ''}
                  </option>
                ))}
              </select>
              <p className="muted small">{employee.name} reports to more than one manager — pick who runs this review.</p>
            </div>
          )}
          <div className="field">
            <label>KPIs to include ({selected.size}/{source?.kpis.length || 0})</label>
            <div className="kpi-pick-list">
              {(source?.kpis || []).map((k, i) => (
                <label key={i} className="kpi-pick-row">
                  <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                  <span><strong>{k.area || 'KPA'}</strong> — {k.kpiDescription}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            The employee will be emailed a link to complete their self-assessment.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || selected.size === 0}>
              {busy ? 'Starting…' : 'Start review & email employee'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Review detail: its status + frozen KPI list, plus admin actions —
// open the manager review / session, resend the link, or delete.
function ReviewDetailModal({ reviewId, onClose, onDeleted, readOnly = false }) {
  const navigate = useNavigate();
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!(await confirmDialog({
      title: 'Delete this KPI review?',
      body: 'The review cycle is removed and cannot be recovered. A completed review’s PDF stays under the employee’s KPI sessions.',
      tone: 'danger',
      confirmLabel: 'Delete review',
    }))) return;
    setBusy(true); setErr(''); setNotice('');
    try {
      await api.deleteKpiReview(reviewId);
      onDeleted?.();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  async function handleResend(party) {
    setBusy(true); setErr(''); setNotice('');
    try {
      const res = await api.resendReviewEmail(reviewId, party);
      setNotice(`Link ${res.sent ? 'sent' : 'queued'} to the ${party}${res.emailedTo ? ` (${res.emailedTo})` : ''}.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Contextual "next action" the admin/manager can take, by status.
  const primary = !review ? null
    : review.status === 'employee_submitted' ? { label: 'Give manager feedback', to: `/team-review/${review.id}` }
    : (review.status === 'manager_submitted' || review.status === 'unlocked') ? { label: 'Open session', to: `/review-session/${review.id}` }
    : review.status === 'completed' ? { label: 'View outcome', to: `/review-session/${review.id}` }
    : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getKpiReview(reviewId)
      .then((r) => { if (!cancelled) setReview(r); })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reviewId]);

  return (
    <Modal title={review ? `KPI review · ${review.employeeName}` : 'KPI review'} onClose={onClose}>
      {err && <div className="error" onClick={() => setErr('')}>{err}</div>}
      {notice && <div className="notice-banner">{notice}</div>}
      {loading ? (
        <div className="muted">Loading…</div>
      ) : !review ? null : (
        <div className="kpi-review-detail">
          <div className="kpi-review-detail-meta">
            <div>
              <strong>{review.periodLabel}</strong>{' · '}
              <span className={'kpi-review-badge kpi-review-' + review.status}>
                {reviewStatusLabel(review.status)}
              </span>
            </div>
            <div className="muted">
              Employee: {review.employeeName}
              {review.managerName ? ` · Manager: ${review.managerName}` : ' · No manager on file'}
            </div>
          </div>
          <ol className="kpi-review-kpi-list">
            {(review.kpis || []).map((k, i) => (
              <li key={i}>
                <div className="kpi-review-kpi-area">
                  {k.area || 'KPA'}{k.weight ? ` · ${Math.round(k.weight)}%` : ''}
                </div>
                <div className="kpi-review-kpi-desc">{k.kpiDescription}</div>
                {Array.isArray(k.measures) && k.measures.length > 0 && (
                  <div className="muted kpi-review-kpi-measures">{k.measures.join(' · ')}</div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {review && !readOnly && (
        <div className="review-resend">
          <span className="muted small">Resend link:</span>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => handleResend('employee')}>
            To employee
          </button>
          {review.managerName && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => handleResend('manager')}>
              To manager
            </button>
          )}
        </div>
      )}
      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        {!readOnly ? (
          <button type="button" className="btn-ghost danger" disabled={busy} onClick={handleDelete}>
            {busy ? 'Working…' : 'Delete review'}
          </button>
        ) : <span />}
        <div style={{ display: 'flex', gap: 8 }}>
          {primary && (
            <button type="button" className="btn-primary" onClick={() => navigate(primary.to)}>
              {primary.label}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

function reviewStatusLabel(status) {
  switch (status) {
    case 'employee_pending':   return 'Awaiting employee';
    case 'employee_submitted': return 'Awaiting manager';
    case 'manager_submitted':  return 'Session locked';
    case 'unlocked':           return 'In session';
    case 'completed':          return 'Completed';
    default:                   return status || '—';
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function suggestPeriod(_employee, frequency) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  switch (frequency) {
    case 'BiAnnually': return `${month <= 6 ? 'H1' : 'H2'} ${year}`;
    case 'Annually':   return `${year}`;
    case 'Quarterly':
    default: {
      const q = Math.floor((month - 1) / 3) + 1;
      return `Q${q} ${year}`;
    }
  }
}
