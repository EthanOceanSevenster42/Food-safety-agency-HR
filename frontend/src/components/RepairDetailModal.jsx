import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { confirmDialog } from '../confirm.js';

const STAGE_LABEL = {
  booked_in: 'Booked In',
  out_for_dispatch: 'Out for Dispatch',
  at_supplier: 'At Supplier',
  received_back: 'Received Back',
  returned: 'Returned to storage',
};

const STAGES_ORDER = ['booked_in', 'out_for_dispatch', 'at_supplier', 'received_back'];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function RepairDetailModal({ assetId, onClose, onChanged, readOnly = false }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [recipientDraft, setRecipientDraft] = useState('');
  const [busyNote, setBusyNote] = useState(false);
  const [busyRecip, setBusyRecip] = useState(false);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const d = await api.getRepairDetail(assetId);
      setDetail(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [assetId]);

  async function handleAddNote(e) {
    e.preventDefault();
    if (!noteDraft.trim()) return;
    setBusyNote(true);
    setErr('');
    try {
      await api.addRepairNote(assetId, noteDraft.trim());
      setNoteDraft('');
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyNote(false);
    }
  }

  async function handleDeleteNote(noteId) {
    if (!(await confirmDialog({
      title: 'Delete this note?',
      tone: 'danger',
      confirmLabel: 'Delete note',
    }))) return;
    try {
      await api.deleteRepairNote(noteId);
      await load();
    } catch (e) { setErr(e.message); }
  }

  async function handleAddRecipient(e) {
    e.preventDefault();
    const email = recipientDraft.trim();
    if (!EMAIL_RE.test(email)) { setErr('Enter a valid email address'); return; }
    setBusyRecip(true);
    setErr('');
    try {
      await api.addRepairRecipient(assetId, email);
      setRecipientDraft('');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyRecip(false);
    }
  }

  async function handleRemoveRecipient(rid) {
    try {
      await api.deleteRepairRecipient(rid);
      await load();
    } catch (e) { setErr(e.message); }
  }

  if (loading) {
    return (
      <Modal title="Repair Detail" onClose={onClose}>
        <div className="muted">Loading…</div>
      </Modal>
    );
  }

  if (!detail) {
    return (
      <Modal title="Repair Detail" onClose={onClose}>
        <div className="error">{err || 'Failed to load.'}</div>
      </Modal>
    );
  }

  const { asset, company, owner, recipients, notes, stageHistory = [] } = detail;
  const brandStyle = company.brandColor ? { '--co-brand': company.brandColor } : undefined;
  const currentIdx = STAGES_ORDER.indexOf(asset.repairStage);
  const stampMap = new Map();
  for (const h of stageHistory) {
    if (!stampMap.has(h.stage)) stampMap.set(h.stage, h.enteredAt);
  }

  return (
    <Modal title="Repair Detail" onClose={onClose}>
      <div className="repair-detail" style={brandStyle} data-brand={company.brandColor || undefined}>
        {err && <div className="error">{err}</div>}

        <div className="repair-detail-head">
          <div className="repair-detail-asset">
            <div className="muted small">{company.name}</div>
            <div className="repair-detail-asset-name">{asset.name}</div>
            <div className="muted small">
              {asset.category}{asset.type ? ' · ' + asset.type : ''}
              {asset.serialNumber ? <> · SN <span className="mono">{asset.serialNumber}</span></> : null}
              {asset.assetTag ? <> · Tag <span className="mono">{asset.assetTag}</span></> : null}
            </div>
          </div>
          <span className="repair-detail-stage">{STAGE_LABEL[asset.repairStage] || 'In Repairs'}</span>
        </div>

        <div className="repair-detail-grid">
          <div>
            <div className="muted small uppercase">Owner</div>
            <div className="strong">{owner ? `${owner.name}${owner.title ? ' · ' + owner.title : ''}` : 'In storage'}</div>
            {owner?.email && <div className="muted small">{owner.email}</div>}
          </div>
          <div>
            <div className="muted small uppercase">Supplier</div>
            <div className="strong">{asset.repairSupplier || '—'}</div>
          </div>
          <div>
            <div className="muted small uppercase">Booked In</div>
            <div className="strong">{fmtDate(asset.repairBookedInAt)}</div>
          </div>
        </div>

        <div className="modal-section-title">Progress</div>
        <ol className="repair-timeline">
          {STAGES_ORDER.map((key, i) => {
            const reached = i <= currentIdx;
            const isCurrent = i === currentIdx;
            const stamp = stampMap.get(key);
            return (
              <li key={key} className={'repair-timeline-step' + (reached ? ' is-reached' : '') + (isCurrent ? ' is-current' : '')}>
                <span className="repair-timeline-dot" aria-hidden>{reached && !isCurrent ? '✓' : i + 1}</span>
                <div className="repair-timeline-text">
                  <div className="repair-timeline-label">{STAGE_LABEL[key]}</div>
                  <div className="muted small">{stamp ? fmtDate(stamp) : reached ? '—' : 'Pending'}</div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="modal-section-title">Problem reported</div>
        <div className="repair-detail-problem">
          {asset.repairProblem || <span className="muted">No problem description on record.</span>}
        </div>

        {asset.repairDocketUrl && (
          <a
            className="btn-ghost repair-docket-btn"
            href={asset.repairDocketUrl}
            target="_blank"
            rel="noreferrer"
          >
            ⬇ Open / print repair docket (PDF)
          </a>
        )}

        <div className="modal-section-title">Notification recipients</div>
        <div className="email-chips editable">
          {owner?.email && (
            <span className="email-chip locked" title="Owner — automatically notified">
              {owner.email} <small>(owner)</small>
            </span>
          )}
          {recipients.map((r) => (
            <span key={r.id} className="email-chip">
              {r.email}
              {!readOnly && (
                <button
                  type="button"
                  className="email-chip-remove"
                  onClick={() => handleRemoveRecipient(r.id)}
                  aria-label={`Remove ${r.email}`}
                >×</button>
              )}
            </span>
          ))}
        </div>
        {!readOnly && (
          <form className="recipient-add-row" onSubmit={handleAddRecipient}>
            <input
              type="email"
              placeholder="Add an email address"
              value={recipientDraft}
              onChange={(e) => setRecipientDraft(e.target.value)}
            />
            <button type="submit" className="btn-ghost" disabled={busyRecip || !recipientDraft.trim()}>
              {busyRecip ? 'Adding…' : 'Add'}
            </button>
          </form>
        )}

        <div className="modal-section-title">Notes &amp; communication</div>
        {!readOnly && (
          <form className="note-form" onSubmit={handleAddNote}>
            <textarea
              rows={3}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Add a note (e.g. supplier feedback, status update, action taken)…"
            />
            <div className="note-form-foot">
              <span className="muted small">Sending will email the owner and recipients above.</span>
              <button type="submit" className="btn-primary" disabled={busyNote || !noteDraft.trim()}>
                {busyNote ? 'Sending…' : 'Add note &amp; notify'}
              </button>
            </div>
          </form>
        )}

        {notes.length === 0 ? (
          <div className="muted small note-empty">No notes yet.</div>
        ) : (
          <ul className="notes-timeline">
            {notes.map((n) => (
              <li key={n.id} className="note-item">
                <div className="note-meta">
                  <strong>{n.author || 'Unknown'}</strong>
                  <span className="muted small">{fmtDate(n.createdAt)}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="note-delete"
                      onClick={() => handleDeleteNote(n.id)}
                      aria-label="Delete note"
                      title="Delete"
                    >×</button>
                  )}
                </div>
                <div className="note-body">{n.message}</div>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
