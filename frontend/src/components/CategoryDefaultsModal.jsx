import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

export default function CategoryDefaultsModal({ companyId, companyName, onClose, onSaved }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const out = await api.getCategoryDefaults(companyId);
      setRows(out.map((r) => ({
        category: r.category,
        depreciationPercent: r.depreciationPercent ?? '',
        usefulLifeYears: r.usefulLifeYears ?? '',
      })));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [companyId]);

  function update(idx, key, value) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const items = rows.map((r) => ({
        category: r.category,
        depreciationPercent: r.depreciationPercent === '' ? null : Number(r.depreciationPercent),
        usefulLifeYears: r.usefulLifeYears === '' ? null : Number(r.usefulLifeYears),
      }));
      const updated = await api.updateCategoryDefaults(companyId, items);
      onSaved?.(updated);
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Category defaults · ${companyName || ''}`} onClose={onClose}>
      <form onSubmit={save}>
        {err && <div className="error">{err}</div>}

        <p className="muted" style={{ marginTop: 0 }}>
          When you add a new asset under this company, the depreciation and useful life will pre-fill from these values based on the chosen category.
          Leave a field blank to use no default.
        </p>

        {loading ? (
          <div className="muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 20px' }}>
            <p>No categories yet.</p>
            <small className="muted">Add an asset to a category, then come back here to set its defaults. New categories appear here automatically.</small>
          </div>
        ) : (
          <table className="cat-defaults-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Depreciation</th>
                <th className="num">Useful life</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.category}>
                  <td>{r.category}</td>
                  <td>
                    <span className="input-affix affix-suffix cat-defaults-input">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={r.depreciationPercent}
                        onChange={(e) => update(i, 'depreciationPercent', e.target.value)}
                        placeholder="—"
                      />
                      <span className="input-affix-symbol">%</span>
                    </span>
                  </td>
                  <td>
                    <span className="input-affix affix-suffix cat-defaults-input">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={r.usefulLifeYears}
                        onChange={(e) => update(i, 'usefulLifeYears', e.target.value)}
                        placeholder="—"
                      />
                      <span className="input-affix-symbol">yrs</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || loading}>
            {busy ? 'Saving…' : 'Save defaults'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
