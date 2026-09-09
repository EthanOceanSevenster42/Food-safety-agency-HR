import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { auth } from '../auth.js';
import { canEdit } from '../roles.js';
import Modal from '../components/Modal.jsx';
import OrgChart from '../components/OrgChart.jsx';
import CompanyGrid from '../components/CompanyGrid.jsx';
import CompanyModal from '../components/CompanyModal.jsx';
import ReadOnlyBanner from '../components/ReadOnlyBanner.jsx';
import { confirmDialog } from '../confirm.js';

export default function AssetsOverviewPage() {
  const me = auth.getUser();
  const canEditAssets = canEdit(me, 'asset_allocated');
  const canEditCompanies = canEdit(me, 'companies');
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [companyModal, setCompanyModal] = useState(null);
  const [employeeModal, setEmployeeModal] = useState(null);

  // Filters for the org chart's per-employee asset lists
  const [assetSearch, setAssetSearch] = useState('');
  const [assetCategoryFilter, setAssetCategoryFilter] = useState('');
  const [repairsOnly, setRepairsOnly] = useState(false);

  const selectedCompany = companies.find((c) => c.id === selectedId) || null;

  const allocatedAssets = useMemo(() => assets.filter((a) => a.assignedEmployeeId), [assets]);

  const filteredAssets = useMemo(() => {
    const s = assetSearch.trim().toLowerCase();
    return allocatedAssets.filter((a) => {
      if (assetCategoryFilter && a.category !== assetCategoryFilter) return false;
      if (repairsOnly && !a.isInRepairs) return false;
      if (s) {
        const hay = [a.name, a.type, a.serialNumber, a.assetTag, a.assignedEmployeeName]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [allocatedAssets, assetSearch, assetCategoryFilter, repairsOnly]);

  const categoriesPresent = useMemo(() => {
    const set = new Set(allocatedAssets.map((a) => a.category));
    return Array.from(set).sort();
  }, [allocatedAssets]);

  const filtersActive = !!(assetSearch || assetCategoryFilter || repairsOnly);

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
      setAssets([]);
      return;
    }
    try {
      const [emps, ass] = await Promise.all([
        api.listEmployees(companyId),
        api.listAssets(companyId),
      ]);
      setEmployees(emps);
      setAssets(ass);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadCompanies(); }, []);
  useEffect(() => { loadCompanyDetail(selectedId); }, [selectedId]);

  async function handleSaveCompany(form) {
    if (companyModal.mode === 'edit') {
      await api.updateCompany(companyModal.company.id, form);
    } else {
      await api.createCompany(form);
    }
    await loadCompanies();
    setCompanyModal(null);
  }

  async function handleDeleteCompany(company = selectedCompany) {
    if (!company) return;
    if (!(await confirmDialog({
      title: `Delete "${company.name}"?`,
      body: 'Every employee and asset on this company is deleted with it. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete company',
    }))) return;
    try {
      await api.deleteCompany(company.id);
      if (selectedId === company.id) setSelectedId(null);
      await loadCompanies();
    } catch (e) { setError(e.message); }
  }

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
    setEmployeeModal(null);
    await loadCompanyDetail(selectedId);
    await loadCompanies();
  }

  async function handleDeleteEmployee(emp) {
    if (!(await confirmDialog({
      title: `Remove ${emp.name}?`,
      body: 'Direct reports are reassigned and any allocated assets return to storage.',
      tone: 'danger',
      confirmLabel: 'Remove employee',
    }))) return;
    await api.deleteEmployee(emp.id);
    await loadCompanyDetail(selectedId);
    await loadCompanies();
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

  if (loading) {
    return <div className="page"><div className="muted">Loading…</div></div>;
  }

  // Drill-down view: org chart for selected company
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
            {canEditCompanies ? (
              <button
                type="button"
                className="logo-edit-trigger"
                onClick={() => setCompanyModal({ mode: 'edit', company: selectedCompany })}
                aria-label="Edit company branding"
                title="Edit branding"
              >
                {selectedCompany.logoUrl ? (
                  <img className="company-logo-lg" src={selectedCompany.logoUrl} alt={selectedCompany.name} />
                ) : (
                  <div className="company-logo-lg company-logo-placeholder">{selectedCompany.name.slice(0, 2).toUpperCase()}</div>
                )}
                <span className="logo-edit-overlay" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </span>
              </button>
            ) : (
              selectedCompany.logoUrl ? (
                <img className="company-logo-lg" src={selectedCompany.logoUrl} alt={selectedCompany.name} />
              ) : (
                <div className="company-logo-lg company-logo-placeholder">{selectedCompany.name.slice(0, 2).toUpperCase()}</div>
              )
            )}
            <div>
              <h1>{selectedCompany.name}</h1>
              <p className="muted">{employees.length} employee{employees.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          {(canEditAssets || canEditCompanies) && (
            <div className="page-actions">
              {canEditAssets && (
                <button
                  className="btn-primary"
                  onClick={() => setEmployeeModal({ mode: 'create', preset: { managerId: '' } })}
                >
                  + Add Employee
                </button>
              )}
              {canEditCompanies && (
                <button className="btn-ghost danger" onClick={() => handleDeleteCompany(selectedCompany)}>Delete</button>
              )}
            </div>
          )}
        </header>

        {!canEditAssets && <ReadOnlyBanner label="Asset Control" />}
        {error && <div className="error">{error}</div>}

        {companyModal && (
          <CompanyModal
            mode={companyModal.mode}
            company={companyModal.company}
            onClose={() => setCompanyModal(null)}
            onSave={handleSaveCompany}
          />
        )}

        {employees.length === 0 ? (
          <div className="empty-state">
            <p>No employees in {selectedCompany.name} yet.{canEditAssets ? ' Start by adding the CEO.' : ''}</p>
            {canEditAssets && (
              <button
                className="btn-primary"
                onClick={() => setEmployeeModal({ mode: 'create', preset: { managerId: '' } })}
              >
                + Add first employee
              </button>
            )}
          </div>
        ) : (
          <>
            {allocatedAssets.length > 0 && (
              <div className="filters-bar">
                <input
                  type="search"
                  className="filters-search"
                  placeholder="Filter equipment by name, type, serial, tag, person…"
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                />
                <select
                  className="filters-category"
                  value={assetCategoryFilter}
                  onChange={(e) => setAssetCategoryFilter(e.target.value)}
                  aria-label="Filter by category"
                >
                  <option value="">All categories</option>
                  {categoriesPresent.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <label className="filters-toggle">
                  <input type="checkbox" checked={repairsOnly} onChange={(e) => setRepairsOnly(e.target.checked)} />
                  <span>In repairs only</span>
                </label>
                {filtersActive && (
                  <button
                    className="btn-ghost filters-clear"
                    onClick={() => { setAssetSearch(''); setAssetCategoryFilter(''); setRepairsOnly(false); }}
                  >
                    Clear
                  </button>
                )}
                <span className="muted filters-count">
                  Showing {filteredAssets.length} of {allocatedAssets.length} allocated
                </span>
              </div>
            )}
            <OrgChart
              employees={employees}
              assets={filteredAssets}
              readOnly={!canEditAssets}
              onAddReport={(parent) => setEmployeeModal({ mode: 'create', preset: { managerId: parent.id } })}
              onEdit={(emp) => setEmployeeModal({ mode: 'edit', preset: emp })}
              onDelete={handleDeleteEmployee}
              onMove={handleMoveEmployee}
            />
          </>
        )}

        {employeeModal && (
          <EmployeeModal
            mode={employeeModal.mode}
            preset={employeeModal.preset}
            employees={employees}
            onClose={() => setEmployeeModal(null)}
            onSave={handleSaveEmployee}
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
          <h1>Allocated Assets Overview</h1>
          <p className="muted">Click a company to view its organisation and allocated assets.</p>
        </div>
      </header>

      {!canEditAssets && <ReadOnlyBanner label="Asset Control" />}
      {error && <div className="error">{error}</div>}

      {companies.length === 0 ? (
        <div className="empty-state">
          <p>No companies yet.</p>
          {canEditCompanies && (
            <button className="btn-primary" onClick={() => setCompanyModal({ mode: 'create' })}>Create your first company</button>
          )}
        </div>
      ) : (
        <CompanyGrid
          companies={companies}
          onSelect={(c) => setSelectedId(c.id)}
          onAddCompany={() => setCompanyModal({ mode: 'create' })}
          onDelete={canEditCompanies ? handleDeleteCompany : undefined}
          canAdd={canEditCompanies}
          countLabel={(c) => `${c.employeeCount} employee${c.employeeCount === 1 ? '' : 's'}`}
        />
      )}

      {companyModal && (
        <CompanyModal
          mode={companyModal.mode}
          company={companyModal.company}
          onClose={() => setCompanyModal(null)}
          onSave={handleSaveCompany}
        />
      )}
    </div>
  );
}

function EmployeeModal({ mode, preset, employees, onClose, onSave }) {
  const [name, setName] = useState(preset?.name ?? '');
  const [title, setTitle] = useState(preset?.title ?? '');
  const [email, setEmail] = useState(preset?.email ?? '');
  const [department, setDepartment] = useState(preset?.department ?? '');
  const [managerId, setManagerId] = useState(preset?.managerId ?? '');
  const [additionalManagerIds, setAdditionalManagerIds] = useState(
    Array.isArray(preset?.additionalManagerIds) ? preset.additionalManagerIds : []
  );
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
          <label htmlFor="emp-name">Name</label>
          <input id="emp-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="emp-title">Title / Role</label>
          <input id="emp-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CEO, CFO, Operations Manager" />
        </div>
        <div className="field">
          <label htmlFor="emp-dept">Department</label>
          <input
            id="emp-dept"
            type="text"
            list="emp-dept-options"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="e.g. IT, Sales, Operations"
          />
          <datalist id="emp-dept-options">
            {existingDepartments.map((d) => <option key={d} value={d} />)}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="emp-email">Email (optional)</label>
          <input id="emp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="emp-mgr">Reports to (primary manager)</label>
          <select id="emp-mgr" value={managerId ?? ''} onChange={(e) => setManagerId(e.target.value)}>
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
          <p className="muted small">Extra managers this person also reports to. Shared with the HR org chart.</p>
        </div>
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
