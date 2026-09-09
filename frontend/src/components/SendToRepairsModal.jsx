import { useState } from 'react';
import Modal from './Modal.jsx';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function parseEmails(input) {
  return input
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function SendToRepairsModal({ asset, onClose, onDone }) {
  const [problem, setProblem] = useState('');
  const [supplier, setSupplier] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const parsed = parseEmails(recipientsText);
  const invalid = parsed.filter((e) => !EMAIL_RE.test(e));

  async function submit(e) {
    e.preventDefault();
    if (!problem.trim()) { setErr('Describe what is wrong.'); return; }
    if (invalid.length) { setErr(`Invalid email${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}`); return; }
    setBusy(true);
    setErr('');
    try {
      await onDone({
        problem: problem.trim(),
        supplier: supplier.trim() || null,
        recipients: parsed,
      });
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Send "${asset.name}" to Repairs`} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}

        <div className="repair-asset-summary">
          <div className="muted small">{asset.category}{asset.type ? ' · ' + asset.type : ''}</div>
          <div className="repair-asset-summary-name">{asset.name}</div>
          <div className="muted small">
            {asset.serialNumber && <>SN <span className="mono">{asset.serialNumber}</span> · </>}
            {asset.assetTag && <>Tag <span className="mono">{asset.assetTag}</span> · </>}
            {asset.assignedEmployeeName ? `Owner: ${asset.assignedEmployeeName}` : 'In storage'}
          </div>
        </div>

        <div className="field">
          <label htmlFor="problem">What is wrong?</label>
          <textarea
            id="problem"
            rows={4}
            required
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            placeholder="Describe the fault, symptoms, when it started, anything you have already tried…"
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="supplier">Supplier (optional)</label>
          <input
            id="supplier"
            type="text"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="e.g. Dell Premier Support"
          />
        </div>

        <div className="field">
          <label htmlFor="recipients">Notify these email addresses (optional)</label>
          <textarea
            id="recipients"
            rows={3}
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            placeholder="One per line or comma-separated. The asset's owner is notified automatically."
          />
          {parsed.length > 0 && (
            <div className="email-chips">
              {parsed.map((email, i) => (
                <span key={i} className={'email-chip' + (EMAIL_RE.test(email) ? '' : ' invalid')}>
                  {email}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="muted small repair-modal-hint">
          A repair docket PDF will be generated and emailed to recipients (and the asset's owner).
          You can re-print and add notes from the Repairs page later.
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Booking in…' : 'Book in for repair'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
