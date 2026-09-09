import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { auth } from '../auth.js';
import { canEdit as canEditSeg } from '../roles.js';
import RepairCard from '../components/RepairCard.jsx';
import RepairDetailModal from '../components/RepairDetailModal.jsx';
import RepairCoordinatorBanner from '../components/RepairCoordinatorBanner.jsx';
import ReadOnlyBanner from '../components/ReadOnlyBanner.jsx';
import { confirmDialog } from '../confirm.js';

const STAGES = [
  { key: 'booked_in',        label: 'Booked In',        subtitle: 'At repair department' },
  { key: 'out_for_dispatch', label: 'Out for Dispatch', subtitle: 'Paperwork complete' },
  { key: 'at_supplier',      label: 'At Supplier',      subtitle: 'Awaiting feedback' },
  { key: 'received_back',    label: 'Received Back',    subtitle: 'Back at department' },
];

export default function RepairsPage() {
  const canEdit = canEditSeg(auth.getUser(), 'asset_repairs');
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [detailAssetId, setDetailAssetId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      setAssets(await api.listAllRepairs());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const companiesPresent = useMemo(() => {
    const map = new Map();
    assets.forEach((a) => map.set(a.companyName, a.companyBrandColor));
    return Array.from(map.entries()).map(([name, color]) => ({ name, color })).sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  const categoriesPresent = useMemo(() => {
    const set = new Set(assets.map((a) => a.category));
    return Array.from(set).sort();
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const s = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (companyFilter && a.companyName !== companyFilter) return false;
      if (categoryFilter && a.category !== categoryFilter) return false;
      if (s) {
        const hay = [a.name, a.type, a.serialNumber, a.assetTag, a.assignedEmployeeName, a.companyName]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [assets, search, companyFilter, categoryFilter]);

  const filtersActive = !!(search || companyFilter || categoryFilter);

  // Group by stage (default any null/unknown stages to 'booked_in')
  const byStage = useMemo(() => {
    const map = new Map(STAGES.map((s) => [s.key, []]));
    filteredAssets.forEach((a) => {
      const stage = STAGES.some((s) => s.key === a.repairStage) ? a.repairStage : 'booked_in';
      map.get(stage).push(a);
    });
    return map;
  }, [filteredAssets]);

  async function moveToStage(asset, stage) {
    if (!asset || asset.repairStage === stage) return;
    // Optimistic
    setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, repairStage: stage } : a)));
    try {
      await api.updateAsset(asset.id, {
        category: asset.category,
        name: asset.name,
        assignedEmployeeId: asset.assignedEmployeeId,
        isInRepairs: true,
        repairStage: stage,
      });
    } catch (err) {
      setError(err.message);
      await load();
    }
  }

  async function markAsRepaired(asset) {
    if (!(await confirmDialog({
      title: `Mark "${asset.name}" as repaired?`,
      body: `It returns to ${asset.assignedEmployeeName || 'storage'}.`,
      confirmLabel: 'Mark repaired',
    }))) return;
    try {
      await api.updateAsset(asset.id, {
        category: asset.category,
        name: asset.name,
        assignedEmployeeId: asset.assignedEmployeeId,
        isInRepairs: false,
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDragStart(id) { setDraggedId(id); }
  function handleDragEnd() { setDraggedId(null); setDropTarget(null); }
  function handleDragOverColumn(stageKey, e) {
    if (draggedId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== stageKey) setDropTarget(stageKey);
  }
  function handleDropColumn(stageKey, e) {
    e.preventDefault();
    const id = draggedId;
    setDraggedId(null);
    setDropTarget(null);
    if (id == null) return;
    const asset = assets.find((a) => a.id === id);
    if (asset) moveToStage(asset, stageKey);
  }

  if (loading) return <div className="page"><div className="muted">Loading…</div></div>;

  return (
    <div className="page repairs-page">
      <header className="page-header">
        <div>
          <h1>Repairs</h1>
          <p className="muted">All items currently in repair across all companies. Drag a card between columns to advance the workflow.</p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={assets.length === 0}
            onClick={async () => {
              try { await api.exportRepairs(); } catch (e) { setError(e.message); }
            }}
          >
            ⬇ Export to Excel
          </button>
        </div>
      </header>

      {!canEdit && <ReadOnlyBanner label="Repairs" />}
      {error && <div className="error">{error}</div>}

      <RepairCoordinatorBanner readOnly={!canEdit} />

      {assets.length === 0 ? (
        <div className="empty-state">
          <p>No items currently in repair.</p>
        </div>
      ) : (
        <>
          <div className="filters-bar">
            <input
              type="search"
              className="filters-search"
              placeholder="Search by name, serial, tag, type, person, company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="filters-category"
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              aria-label="Filter by company"
            >
              <option value="">All companies</option>
              {companiesPresent.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select
              className="filters-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categoriesPresent.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {filtersActive && (
              <button className="btn-ghost filters-clear" onClick={() => { setSearch(''); setCompanyFilter(''); setCategoryFilter(''); }}>
                Clear
              </button>
            )}
            <span className="muted filters-count">
              Showing {filteredAssets.length} of {assets.length} items
            </span>
          </div>

          <div className="kanban">
            {STAGES.map((stage, idx) => {
              const items = byStage.get(stage.key) ?? [];
              const isLast = idx === STAGES.length - 1;
              const isTarget = dropTarget === stage.key && draggedId != null;
              return (
                <div
                  key={stage.key}
                  className={'kanban-col stage-' + stage.key + (isTarget ? ' is-drop-target' : '')}
                  onDragOver={(e) => handleDragOverColumn(stage.key, e)}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      if (dropTarget === stage.key) setDropTarget(null);
                    }
                  }}
                  onDrop={(e) => handleDropColumn(stage.key, e)}
                >
                  <header className="kanban-col-head">
                    <div>
                      <h2>{stage.label}</h2>
                      <div className="kanban-col-sub muted">{stage.subtitle}</div>
                    </div>
                    <span className="kanban-col-count">{items.length}</span>
                  </header>
                  <div className="kanban-col-body">
                    {items.length === 0 ? (
                      <div className="kanban-empty muted">Drop items here</div>
                    ) : (
                      items.map((a) => (
                        <RepairCard
                          key={a.id}
                          asset={a}
                          isLastStage={isLast}
                          isDragging={draggedId === a.id}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onMarkRepaired={markAsRepaired}
                          onOpenDetails={(asset) => setDetailAssetId(asset.id)}
                          readOnly={!canEdit}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {detailAssetId != null && (
        <RepairDetailModal
          assetId={detailAssetId}
          onClose={() => setDetailAssetId(null)}
          onChanged={() => load()}
          readOnly={!canEdit}
        />
      )}
    </div>
  );
}
