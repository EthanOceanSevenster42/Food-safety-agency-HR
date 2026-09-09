import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { CATEGORY_SUGGESTIONS, TYPE_SUGGESTIONS } from '../utils/assetMath.js';
import { api } from '../api.js';

const STAGE_LABELS = {
  booked_in: 'Booked In',
  out_for_dispatch: 'Out for Dispatch',
  at_supplier: 'At Supplier',
  received_back: 'Received Back',
  returned: 'Returned to storage',
};

function fmtDateShort(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AssetModal({ mode, asset, employees, companies = [], currentCompanyId, categoryDefaults = [], onClose, onSave, onTransfer }) {
  const [category, setCategory] = useState(asset?.category ?? '');
  const [type, setType] = useState(asset?.type ?? '');
  const [name, setName] = useState(asset?.name ?? '');
  const [serialNumber, setSerialNumber] = useState(asset?.serialNumber ?? '');
  const [assetTag, setAssetTag] = useState(asset?.assetTag ?? '');
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDate ? asset.purchaseDate.slice(0, 10) : '');
  const [purchaseValue, setPurchaseValue] = useState(asset?.purchaseValue ?? '');
  const [depreciationPercentPerYear, setDepreciation] = useState(asset?.depreciationPercentPerYear ?? '');
  const [usefulLifeYears, setUsefulLifeYears] = useState(asset?.usefulLifeYears ?? '');
  const [notes, setNotes] = useState(asset?.notes ?? '');
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(asset?.assignedEmployeeId ?? '');
  const [isInRepairs, setIsInRepairs] = useState(!!asset?.isInRepairs);

  const [existingImages, setExistingImages] = useState(asset?.images ?? []);
  const [imagesToAdd, setImagesToAdd] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [imageIdsToDelete, setImageIdsToDelete] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!historyOpen || history !== null || !asset?.id) return;
    setHistoryLoading(true);
    api.getRepairHistory(asset.id)
      .then((rows) => setHistory(rows))
      .catch((e) => setErr(e.message))
      .finally(() => setHistoryLoading(false));
  }, [historyOpen, history, asset?.id]);

  const canRestore = !!(asset?.lastAssignedEmployeeId && !assignedEmployeeId);
  const lastAssignedEmployee = employees.find((e) => e.id === asset?.lastAssignedEmployeeId);
  const transferableCompanies = companies.filter((c) => c.id !== (currentCompanyId ?? asset?.companyId));

  // Track the last default values we applied so we can update only fields the
  // user hasn't manually overridden when they switch category. (Create mode only.)
  const lastAppliedDefaultsRef = useRef({ depr: '', life: '' });
  useEffect(() => {
    if (mode !== 'create' || !category) return;
    const def = categoryDefaults.find((d) => d.category === category);
    if (!def) return;

    const newDepr = def.depreciationPercent == null ? '' : String(def.depreciationPercent);
    const newLife = def.usefulLifeYears == null ? '' : String(def.usefulLifeYears);

    setDepreciation((prev) => (prev === '' || prev === lastAppliedDefaultsRef.current.depr ? newDepr : prev));
    setUsefulLifeYears((prev) => (prev === '' || prev === lastAppliedDefaultsRef.current.life ? newLife : prev));

    lastAppliedDefaultsRef.current = { depr: newDepr, life: newLife };
  }, [category, mode, categoryDefaults]);

  // Look up the current category's default for the helper text under the inputs
  const activeDefault = categoryDefaults.find((d) => d.category === category) || null;

  function handlePickFiles(files) {
    const fileArr = Array.from(files);
    setImagesToAdd((prev) => [...prev, ...fileArr]);
    const urls = fileArr.map((f) => URL.createObjectURL(f));
    setPreviewUrls((prev) => [...prev, ...urls]);
  }

  function removeNewFile(idx) {
    URL.revokeObjectURL(previewUrls[idx]);
    setPreviewUrls((prev) => prev.filter((_, i) => i !== idx));
    setImagesToAdd((prev) => prev.filter((_, i) => i !== idx));
  }

  function removeExistingImage(image) {
    setImageIdsToDelete((prev) => [...prev, image.id]);
    setExistingImages((prev) => prev.filter((i) => i.id !== image.id));
  }

  async function submit(e) {
    e.preventDefault();
    if (!category.trim() || !name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await onSave({
        category: category.trim(),
        type: type.trim(),
        name: name.trim(),
        serialNumber: serialNumber.trim(),
        assetTag: assetTag.trim(),
        purchaseDate: purchaseDate || null,
        purchaseValue: purchaseValue === '' ? null : Number(purchaseValue),
        depreciationPercentPerYear: depreciationPercentPerYear === '' ? null : Number(depreciationPercentPerYear),
        usefulLifeYears: usefulLifeYears === '' ? null : Number(usefulLifeYears),
        notes: notes.trim(),
        assignedEmployeeId: assignedEmployeeId === '' ? null : Number(assignedEmployeeId),
        isInRepairs,
        imagesToAdd,
        imageIdsToDelete,
      });
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === 'edit' ? 'Edit Asset' : 'Add Asset'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}

        <div className="field-row">
          <div className="field">
            <label htmlFor="cat">Category</label>
            <input
              id="cat"
              type="text"
              required
              list="cat-suggestions"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Electronics"
              autoFocus
            />
            <datalist id="cat-suggestions">
              {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="type">Type</label>
            <input
              id="type"
              type="text"
              list="type-suggestions"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g. Laptop"
            />
            <datalist id="type-suggestions">
              {TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
        </div>

        <div className="field">
          <label htmlFor="aname">Name / Model</label>
          <input
            id="aname"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dell Latitude 7420"
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="serial">Serial number</label>
            <input id="serial" type="text" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tag">Asset tag</label>
            <input id="tag" type="text" value={assetTag} onChange={(e) => setAssetTag(e.target.value)} placeholder="e.g. LC-0042" />
          </div>
        </div>

        <div className="modal-section-title">Lifecycle &amp; cost</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pdate">Purchase date</label>
            <input id="pdate" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pvalue">Purchase value</label>
            <span className="input-affix">
              <span className="input-affix-symbol">R</span>
              <input id="pvalue" type="number" min="0" step="0.01" value={purchaseValue} onChange={(e) => setPurchaseValue(e.target.value)} placeholder="18 500.00" />
            </span>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="depr">Depreciation per year</label>
            <span className="input-affix affix-suffix">
              <input id="depr" type="number" min="0" max="100" step="0.1" value={depreciationPercentPerYear} onChange={(e) => setDepreciation(e.target.value)} placeholder="20" />
              <span className="input-affix-symbol">%</span>
            </span>
            {mode === 'create' && activeDefault?.depreciationPercent != null && (
              <small className="muted">Default for {category}: {activeDefault.depreciationPercent}%</small>
            )}
          </div>
          <div className="field">
            <label htmlFor="life">Useful life</label>
            <span className="input-affix affix-suffix">
              <input id="life" type="number" min="0" step="1" value={usefulLifeYears} onChange={(e) => setUsefulLifeYears(e.target.value)} placeholder="5" />
              <span className="input-affix-symbol">yrs</span>
            </span>
            {mode === 'create' && activeDefault?.usefulLifeYears != null && (
              <small className="muted">Default for {category}: {activeDefault.usefulLifeYears} yrs</small>
            )}
          </div>
        </div>

        <div className="modal-section-title">Status &amp; allocation</div>
        <div className="field">
          <label htmlFor="assignee">Allocate to</label>
          <select
            id="assignee"
            value={assignedEmployeeId ?? ''}
            onChange={(e) => setAssignedEmployeeId(e.target.value)}
          >
            <option value="">— In storage —</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}{emp.title ? ` · ${emp.title}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="checkbox-row">
            <input type="checkbox" checked={isInRepairs} onChange={(e) => setIsInRepairs(e.target.checked)} />
            <span>Currently in repairs</span>
          </label>
          <small className="muted">When the repair resolves, the asset moves to storage and remembers who it was last allocated to.</small>
        </div>

        {canRestore && (
          <div className="restore-allocation">
            <div>
              <strong>Last allocated to {asset.lastAssignedEmployeeName || 'a previous employee'}</strong>
              {asset.lastAssignedEmployeeTitle && <span className="muted"> · {asset.lastAssignedEmployeeTitle}</span>}
              <div className="muted small">Asset is in storage following a repair.</div>
            </div>
            {lastAssignedEmployee && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setAssignedEmployeeId(asset.lastAssignedEmployeeId)}
              >
                Restore allocation
              </button>
            )}
          </div>
        )}

        {mode === 'edit' && onTransfer && transferableCompanies.length > 0 && (
          <div className="field">
            <button
              type="button"
              className="btn-ghost"
              disabled={asset?.isInRepairs}
              title={asset?.isInRepairs ? 'Resolve the repair before transferring' : ''}
              onClick={() => onTransfer(asset)}
            >
              ↪ Transfer to another company…
            </button>
          </div>
        )}

        <div className="modal-section-title">Photos</div>
        <div className="field">
          <div className="image-grid">
            {existingImages.map((img) => (
              <div key={img.id} className="image-thumb">
                <img src={img.url} alt="" />
                <button type="button" className="image-thumb-remove" onClick={() => removeExistingImage(img)} aria-label="Remove">×</button>
              </div>
            ))}
            {previewUrls.map((url, i) => (
              <div key={`new-${i}`} className="image-thumb image-thumb-new">
                <img src={url} alt="" />
                <button type="button" className="image-thumb-remove" onClick={() => removeNewFile(i)} aria-label="Remove">×</button>
              </div>
            ))}
            <label className="image-add" htmlFor="img-upload">
              <span>+</span>
              <small>Add photos</small>
            </label>
            <input
              id="img-upload"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={(e) => { handlePickFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
          <small className="muted">PNG, JPEG, WebP or GIF · max 5 MB each</small>
        </div>

        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
        </div>

        {mode === 'edit' && (
          <div className="repair-history">
            <button
              type="button"
              className="repair-history-toggle"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
            >
              <span>Repair history{history ? ` · ${history.length}` : ''}</span>
              <span aria-hidden>{historyOpen ? '▾' : '▸'}</span>
            </button>
            {historyOpen && (
              <div className="repair-history-list">
                {historyLoading && <div className="muted small">Loading…</div>}
                {history && history.length === 0 && <div className="muted small">No previous repairs on record.</div>}
                {history && history.map((h) => (
                  <div key={h.id} className="repair-history-item">
                    <div className="repair-history-item-head">
                      <strong>{h.problem ? h.problem.split('\n')[0] : 'Repair'}</strong>
                      <span className="repair-history-ref">{h.reference}</span>
                    </div>
                    <div className="muted small">
                      Booked {fmtDateShort(h.bookedInAt)} · Resolved {fmtDateShort(h.resolvedAt)}
                      {h.supplier ? ` · ${h.supplier}` : ''}
                      {h.ownerName ? ` · for ${h.ownerName}` : ''}
                    </div>
                    {h.stages?.length > 0 && (
                      <div className="repair-history-stages">
                        {h.stages.map((s, i) => (
                          <span key={i}>{STAGE_LABELS[s.stage] || s.stage}: {fmtDateShort(s.enteredAt)}</span>
                        ))}
                      </div>
                    )}
                    {/* Notes from when the repair was active. Rendered
                        inline (not collapsed) so they're visible at a
                        glance — the timeline of stages + the notes
                        together tell the story of what happened. */}
                    {h.notes?.length > 0 ? (
                      <div className="repair-history-notes">
                        <div className="repair-history-notes-title">
                          {h.notes.length} note{h.notes.length === 1 ? '' : 's'}
                        </div>
                        <ul className="notes-timeline">
                          {h.notes.map((n, i) => (
                            <li key={i} className="note-item">
                              <div className="note-meta">
                                <strong>{n.author || 'Unknown'}</strong>
                                <span className="muted small">{fmtDateShort(n.createdAt)}</span>
                              </div>
                              <div className="note-body">{n.message}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="muted small repair-history-no-notes">No notes were recorded during this repair.</div>
                    )}
                    {h.docketUrl && (
                      <a className="btn-ghost" href={h.docketUrl} target="_blank" rel="noreferrer" style={{ marginTop: 6, display: 'inline-block' }}>
                        ⬇ Docket PDF
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add asset'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
