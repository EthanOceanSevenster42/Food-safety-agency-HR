import { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function RepairCoordinatorBanner({ readOnly = false }) {
  const [coordinator, setCoordinator] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function load() {
    setLoading(true);
    try {
      const s = await api.getSettings();
      setCoordinator(s.repairCoordinator || { email: null, name: null });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startEdit() {
    setEmailDraft(coordinator?.email || '');
    setNameDraft(coordinator?.name || '');
    setError('');
    setInfo('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError('');
  }

  async function save(e) {
    e.preventDefault();
    const email = emailDraft.trim();
    if (!EMAIL_RE.test(email)) { setError('Enter a valid email address'); return; }
    setSaving(true);
    setError('');
    try {
      const result = await api.updateRepairCoordinator({ email, name: nameDraft.trim() });
      setCoordinator(result.repairCoordinator);
      const n = result.docketsRegenerated || 0;
      setInfo(n > 0 ? `Saved. ${n} active docket${n === 1 ? '' : 's'} reprinted with the new contact.` : 'Saved.');
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="coordinator-banner">
      <div className="coordinator-banner-icon" aria-hidden>📨</div>
      <div className="coordinator-banner-body">
        <div className="coordinator-banner-label">Repair coordinator (printed on every docket as “Notify on updates”)</div>

        {!editing ? (
          <div className="coordinator-banner-row">
            <div className="coordinator-banner-value">
              <strong>{coordinator?.email || '— not set —'}</strong>
              {coordinator?.name && <span className="muted"> · {coordinator.name}</span>}
            </div>
            {!readOnly && <button type="button" className="btn-ghost" onClick={startEdit}>Change</button>}
          </div>
        ) : (
          <form className="coordinator-banner-form" onSubmit={save}>
            <input
              type="email"
              required
              autoFocus
              placeholder="email@company.com"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
            />
            <input
              type="text"
              placeholder="Display name (optional)"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save & reprint dockets'}
            </button>
            <button type="button" className="btn-ghost" onClick={cancelEdit} disabled={saving}>Cancel</button>
          </form>
        )}

        {error && <div className="coordinator-banner-error">{error}</div>}
        {info && !editing && <div className="coordinator-banner-info">{info}</div>}
      </div>
    </div>
  );
}
