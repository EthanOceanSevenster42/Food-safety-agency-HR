import { useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

export default function TransferAssetModal({ asset, companies, onClose, onTransferred }) {
  const targets = companies.filter((c) => c.id !== asset.companyId);
  const [companyId, setCompanyId] = useState(targets[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!companyId) return;
    setBusy(true);
    setErr('');
    try {
      await api.transferAsset(asset.id, Number(companyId));
      onTransferred?.();
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Transfer "${asset.name}"`} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}

        <p className="muted" style={{ marginTop: 0 }}>
          Move this asset to a different company. The current allocation will be cleared because employees belong to the source company. The asset's repair history is preserved.
        </p>

        <div className="field">
          <label htmlFor="target-company">Move to company</label>
          <select
            id="target-company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            required
          >
            {targets.length === 0 && <option value="">No other companies available</option>}
            {targets.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {asset.isInRepairs && (
          <div className="error">
            This asset is currently in repairs. Resolve the repair first.
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !companyId || asset.isInRepairs}>
            {busy ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
