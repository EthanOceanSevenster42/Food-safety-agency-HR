import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { auth } from '../auth.js';
import { canEdit } from '../roles.js';
import ReadOnlyBanner from '../components/ReadOnlyBanner.jsx';
import CompanyGrid from '../components/CompanyGrid.jsx';
import CompanyModal from '../components/CompanyModal.jsx';
import AssetCard from '../components/AssetCard.jsx';
import AssetSection from '../components/AssetSection.jsx';
import AssetModal from '../components/AssetModal.jsx';
import SendToRepairsModal from '../components/SendToRepairsModal.jsx';
import TransferAssetModal from '../components/TransferAssetModal.jsx';
import CategoryDefaultsModal from '../components/CategoryDefaultsModal.jsx';
import { getAssetStatus } from '../utils/assetMath.js';
import { confirmDialog } from '../confirm.js';
import useAutoSelectCompany from '../useAutoSelectCompany.js';

export default function AllAssetOverviewPage() {
  const me = auth.getUser();
  const canEditAssets = canEdit(me, 'asset_all');
  const canEditCompanies = canEdit(me, 'companies');
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  // One company means nothing to choose — go straight in.
  useAutoSelectCompany(companies, selectedId, setSelectedId);
  const [employees, setEmployees] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [companyModal, setCompanyModal] = useState(null);
  const [assetModal, setAssetModal] = useState(null);
  const [sendToRepairsAsset, setSendToRepairsAsset] = useState(null);
  const [transferAsset, setTransferAsset] = useState(null);
  const [categoryDefaults, setCategoryDefaults] = useState([]);
  const [showCategoryDefaults, setShowCategoryDefaults] = useState(false);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [expanded, setExpanded] = useState({ storage: true, allocated: true, repairs: true });
  const toggleSection = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const selectedCompany = companies.find((c) => c.id === selectedId) || null;

  async function loadCompanies() {
    setLoading(true);
    try {
      setCompanies(await api.listCompanies());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function loadCompanyDetail(companyId) {
    if (!companyId) { setEmployees([]); setAssets([]); setCategoryDefaults([]); return; }
    try {
      const [emps, ass, defs] = await Promise.all([
        api.listEmployees(companyId),
        api.listAssets(companyId),
        api.getCategoryDefaults(companyId),
      ]);
      setEmployees(emps);
      setAssets(ass);
      setCategoryDefaults(defs);
    } catch (err) { setError(err.message); }
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

  async function handleSaveAsset(form) {
    const fields = {
      category: form.category, type: form.type, name: form.name,
      serialNumber: form.serialNumber, assetTag: form.assetTag,
      purchaseDate: form.purchaseDate,
      purchaseValue: form.purchaseValue,
      depreciationPercentPerYear: form.depreciationPercentPerYear,
      usefulLifeYears: form.usefulLifeYears,
      notes: form.notes,
      assignedEmployeeId: form.assignedEmployeeId,
      isInRepairs: form.isInRepairs,
    };

    let assetId;
    if (assetModal.mode === 'edit') {
      assetId = assetModal.asset.id;
      await api.updateAsset(assetId, fields);
      for (const imgId of form.imageIdsToDelete) await api.deleteAssetImage(imgId);
    } else {
      const created = await api.createAsset({ companyId: selectedId, ...fields });
      assetId = created.id;
    }
    if (form.imagesToAdd?.length) await api.uploadAssetImages(assetId, form.imagesToAdd);
    setAssetModal(null);
    await loadCompanyDetail(selectedId);
    await loadCompanies();
  }

  async function handleDeleteAsset(asset) {
    if (!(await confirmDialog({
      title: `Delete "${asset.name}"?`,
      tone: 'danger',
      confirmLabel: 'Delete asset',
    }))) return;
    await api.deleteAsset(asset.id);
    await loadCompanyDetail(selectedId);
    await loadCompanies();
  }

  async function handleAllocate(asset, employeeId) {
    await api.updateAsset(asset.id, { ...asset, assignedEmployeeId: employeeId, isInRepairs: asset.isInRepairs });
    await loadCompanyDetail(selectedId);
  }

  async function handleToggleRepairs(asset, isInRepairs) {
    if (isInRepairs) {
      // Going TO repairs — open the capture modal so we can collect problem, supplier, recipients
      setSendToRepairsAsset(asset);
      return;
    }
    // Marking as repaired
    await api.updateAsset(asset.id, { ...asset, assignedEmployeeId: asset.assignedEmployeeId, isInRepairs: false });
    await loadCompanyDetail(selectedId);
    await loadCompanies();
  }

  async function handleSendToRepairsSubmit(payload) {
    await api.sendToRepairs(sendToRepairsAsset.id, payload);
    setSendToRepairsAsset(null);
    await loadCompanyDetail(selectedId);
    await loadCompanies();
  }

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      await api.exportAssets(selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  // ---------- filters ----------
  const filteredAssets = useMemo(() => {
    const s = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (categoryFilter && a.category !== categoryFilter) return false;
      if (s) {
        const hay = [a.name, a.type, a.serialNumber, a.assetTag, a.assignedEmployeeName]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [assets, search, categoryFilter]);

  const categoriesPresent = useMemo(() => {
    const set = new Set(assets.map((a) => a.category));
    return Array.from(set).sort();
  }, [assets]);

  const inStorage = filteredAssets.filter((a) => getAssetStatus(a) === 'storage');
  const allocated = filteredAssets.filter((a) => getAssetStatus(a) === 'allocated');
  const inRepairs = filteredAssets.filter((a) => getAssetStatus(a) === 'repairs');

  if (loading) return <div className="page"><div className="muted">Loading…</div></div>;

  // Drill-down
  if (selectedCompany) {
    const brandStyle = selectedCompany.brandColor ? { '--co-brand': selectedCompany.brandColor } : undefined;
    const totals = {
      total: assets.length,
      storage: assets.filter((a) => getAssetStatus(a) === 'storage').length,
      allocated: assets.filter((a) => getAssetStatus(a) === 'allocated').length,
      repairs: assets.filter((a) => getAssetStatus(a) === 'repairs').length,
    };

    return (
      <div className="page" style={brandStyle} data-brand={selectedCompany.brandColor || undefined}>
        <header className="page-header company-header">
          <div className="company-detail-head">
            {/* The back link was a band of its own above the header. */}
            <button
              type="button"
              className="company-back"
              onClick={() => setSelectedId(null)}
              title="All companies"
              aria-label="Back to all companies"
            >
              <i className="fas fa-arrow-left" aria-hidden="true" />
            </button>
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
              <p className="muted">{totals.total} asset{totals.total === 1 ? '' : 's'} · {totals.storage} in storage · {totals.allocated} allocated · {totals.repairs} in repairs</p>
            </div>
          </div>
          <div className="page-actions">
            {canEditAssets && <button className="btn-primary" onClick={() => setAssetModal({ mode: 'create' })}>+ Add Asset</button>}
            {canEditAssets && (
              <button
                className="btn-ghost"
                onClick={() => setShowCategoryDefaults(true)}
                title="Set default depreciation and useful life per category"
              >
                ⚙ Category defaults
              </button>
            )}
            <button
              className="btn-ghost"
              onClick={handleExport}
              disabled={exporting || assets.length === 0}
              title={assets.length === 0 ? 'No assets to export' : 'Download as Excel'}
            >
              {exporting ? 'Exporting…' : '⬇ Export to Excel'}
            </button>
            {canEditCompanies && <button className="btn-ghost danger" onClick={() => handleDeleteCompany(selectedCompany)}>Delete</button>}
          </div>
        </header>

        {!canEditAssets && <ReadOnlyBanner label="Asset Control" />}
        {error && <div className="error">{error}</div>}

        {companyModal && (
          <CompanyModal mode={companyModal.mode} company={companyModal.company} onClose={() => setCompanyModal(null)} onSave={handleSaveCompany} />
        )}

        {assets.length === 0 ? (
          <div className="empty-state">
            <p>No assets yet for {selectedCompany.name}.</p>
            {canEditAssets && (
              <button className="btn-primary" onClick={() => setAssetModal({ mode: 'create' })}>+ Add the first asset</button>
            )}
          </div>
        ) : (
          <>
            <div className="filters-bar">
              <input
                type="search"
                className="filters-search"
                placeholder="Search by name, serial, tag, type, assignee…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="filters-category"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {categoriesPresent.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {(search || categoryFilter) && (
                <button className="btn-ghost filters-clear" onClick={() => { setSearch(''); setCategoryFilter(''); }}>
                  Clear
                </button>
              )}
              <span className="muted filters-count">
                Showing {filteredAssets.length} of {assets.length}
              </span>
            </div>

            <AssetSection title="In Storage" count={inStorage.length} expanded={expanded.storage} onToggle={() => toggleSection('storage')}>
              <div className="asset-grid">
                {inStorage.map((a) => (
                  <AssetCard
                    key={a.id} asset={a} employees={employees}
                    onEdit={() => setAssetModal({ mode: 'edit', asset: a })}
                    onDelete={() => handleDeleteAsset(a)}
                    onAllocate={(empId) => handleAllocate(a, empId)}
                    onToggleRepairs={(v) => handleToggleRepairs(a, v)}
                    readOnly={!canEditAssets}
                  />
                ))}
              </div>
            </AssetSection>

            <AssetSection title="Allocated" count={allocated.length} expanded={expanded.allocated} onToggle={() => toggleSection('allocated')}>
              <div className="asset-grid">
                {allocated.map((a) => (
                  <AssetCard
                    key={a.id} asset={a} employees={employees}
                    onEdit={() => setAssetModal({ mode: 'edit', asset: a })}
                    onDelete={() => handleDeleteAsset(a)}
                    onAllocate={(empId) => handleAllocate(a, empId)}
                    onToggleRepairs={(v) => handleToggleRepairs(a, v)}
                    readOnly={!canEditAssets}
                  />
                ))}
              </div>
            </AssetSection>

            <AssetSection title="In Repairs" count={inRepairs.length} expanded={expanded.repairs} onToggle={() => toggleSection('repairs')}>
              <div className="asset-grid">
                {inRepairs.map((a) => (
                  <AssetCard
                    key={a.id} asset={a} employees={employees}
                    onEdit={() => setAssetModal({ mode: 'edit', asset: a })}
                    onDelete={() => handleDeleteAsset(a)}
                    onAllocate={(empId) => handleAllocate(a, empId)}
                    onToggleRepairs={(v) => handleToggleRepairs(a, v)}
                    readOnly={!canEditAssets}
                  />
                ))}
              </div>
            </AssetSection>
          </>
        )}

        {assetModal && (
          <AssetModal
            mode={assetModal.mode}
            asset={assetModal.asset}
            employees={employees}
            companies={companies}
            currentCompanyId={selectedId}
            categoryDefaults={categoryDefaults}
            onClose={() => setAssetModal(null)}
            onSave={handleSaveAsset}
            onTransfer={(a) => { setAssetModal(null); setTransferAsset(a); }}
          />
        )}

        {transferAsset && (
          <TransferAssetModal
            asset={transferAsset}
            companies={companies}
            onClose={() => setTransferAsset(null)}
            onTransferred={async () => {
              await loadCompanies();
              await loadCompanyDetail(selectedId);
            }}
          />
        )}

        {showCategoryDefaults && (
          <CategoryDefaultsModal
            companyId={selectedId}
            companyName={selectedCompany.name}
            onClose={() => setShowCategoryDefaults(false)}
            onSaved={(defs) => setCategoryDefaults(defs)}
          />
        )}

        {sendToRepairsAsset && (
          <SendToRepairsModal
            asset={sendToRepairsAsset}
            onClose={() => setSendToRepairsAsset(null)}
            onDone={handleSendToRepairsSubmit}
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
          <h1>All Asset Overview</h1>
          <p className="muted">Master inventory of every asset across all companies. Click a company to view and manage its assets.</p>
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
          countLabel={(c) => `${c.assetCount ?? 0} asset${(c.assetCount ?? 0) === 1 ? '' : 's'}`}
        />
      )}

      {companyModal && (
        <CompanyModal mode={companyModal.mode} company={companyModal.company} onClose={() => setCompanyModal(null)} onSave={handleSaveCompany} />
      )}
    </div>
  );
}
