import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { AssessGroups, ratingText } from '../components/AssessGroups.jsx';
import { confirmDialog } from '../confirm.js';

// The joint review session: employee vs manager ratings side by side. The
// employee is locked out until they enter the manager's session password;
// the manager/admin can finalise, which stores the review under the
// employee's KPIs.
export default function ReviewSessionPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState([]);       // per-KPI discussion notes
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try { setData(await api.getReviewSession(id)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);

  // Sync the editable notes to the loaded snapshot.
  useEffect(() => {
    if (data?.kpis) setNotes(data.kpis.map((_, i) => data.sessionNotes?.[i] ?? ''));
  }, [data]);

  function setNote(i, val) { setNotes((prev) => prev.map((n, idx) => (idx === i ? val : n))); }

  async function unlock(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api.unlockReviewSession(id, password); setPassword(''); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function saveNotes() {
    setBusy(true); setError(''); setNotice('');
    try { await api.saveSessionNotes(id, notes); setNotice('Discussion notes saved.'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function acknowledge(party) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.acknowledgeReview(id, party);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function finalize() {
    if (!(await confirmDialog({
      title: 'Finalise this review?',
      body: 'It is saved under the employee’s KPIs and cannot be changed afterwards.',
      confirmLabel: 'Finalise',
    }))) return;
    setBusy(true); setError('');
    try {
      if (data.canEditNotes) { try { await api.saveSessionNotes(id, notes); } catch { /* keep going */ } }
      await api.completeReview(id);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="page"><div className="muted">Loading…</div></div>;
  if (!data) return <div className="page"><div className="error">{error || 'Review not found.'}</div></div>;

  if (data.notReady) {
    return (
      <div className="page">
        <header className="page-header"><div><h1>KPI Review Session</h1><p className="muted">{data.periodLabel}</p></div></header>
        <div className="notice-banner">This review isn't ready for a joint session yet.</div>
      </div>
    );
  }

  if (data.locked) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <h1>KPI Review Session</h1>
            <p className="muted">{data.periodLabel}{data.managerName ? ` · Manager: ${data.managerName}` : ''}</p>
          </div>
        </header>
        <div className="session-lock">
          <p>This combined review is locked. Ask your manager for the session password to open it together at your meeting.</p>
          {error && <div className="error" onClick={() => setError('')}>{error}</div>}
          <form onSubmit={unlock} className="session-lock-form">
            <div className="field">
              <label htmlFor="sp">Session password</label>
              <input id="sp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </div>
            <button className="btn-primary" type="submit" disabled={busy || !password}>
              {busy ? 'Unlocking…' : 'Unlock session'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const kpis = data.kpis || [];
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>KPI Review — {data.employeeName}</h1>
          <p className="muted">{data.periodLabel}{data.managerName ? ` · Manager: ${data.managerName}` : ''}</p>
        </div>
      </header>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {notice && <div className="notice-banner">{notice}</div>}
      {data.status === 'completed' && (
        <div className="notice-banner">
          This review is completed.{' '}
          {data.completedDocumentUrl && (
            <a href={data.completedDocumentUrl} target="_blank" rel="noreferrer">Open the saved PDF</a>
          )}
        </div>
      )}
      {data.canEditNotes && (
        <p className="muted assess-intro">
          Review each KPI together. You can add a <strong>discussion note</strong> per KPI to record what was agreed,
          then finalise to store the signed KPI document.
        </p>
      )}

      {data.overall != null && (
        <div className="session-overall">
          Overall (manager): <strong>{data.overall.toFixed(1)} / 5</strong> ({data.overallPct}%)
        </div>
      )}

      <AssessGroups kpis={kpis}>
        {(k, index, ki) => (
          <div key={index} className="assess-kpi">
            <div className="assess-kpi-head"><span className="assess-kpi-num">KPI {ki + 1}</span></div>
            <div className="assess-kpi-desc">{k.kpiDescription}</div>
            <div className="session-compare">
              <div className="session-side">
                <div className="session-side-label">Employee</div>
                <div className="session-side-score">{ratingText(data.employeeRatings?.[index]?.rating)}</div>
                {data.employeeRatings?.[index]?.data && (
                  <div className="session-side-data"><b>Data for review:</b> {data.employeeRatings[index].data}</div>
                )}
                {data.employeeRatings?.[index]?.comment && (
                  <div className="session-side-comment">“{data.employeeRatings[index].comment}”</div>
                )}
              </div>
              <div className="session-side">
                <div className="session-side-label">Manager</div>
                <div className="session-side-score">{ratingText(data.managerRatings?.[index]?.rating)}</div>
                {data.managerRatings?.[index]?.data && (
                  <div className="session-side-data"><b>Data for review:</b> {data.managerRatings[index].data}</div>
                )}
                {data.managerRatings?.[index]?.comment && (
                  <div className="session-side-comment">“{data.managerRatings[index].comment}”</div>
                )}
              </div>
            </div>
            {data.canEditNotes ? (
              <div className="session-note-edit">
                <label className="assess-field-label">Discussion note <span className="muted">— agreed at the meeting (optional)</span></label>
                <textarea
                  className="assess-comment"
                  rows={2}
                  placeholder="What was discussed or agreed for this KPI"
                  value={notes[index] ?? ''}
                  onChange={(e) => setNote(index, e.target.value)}
                />
              </div>
            ) : data.sessionNotes?.[index] ? (
              <div className="session-note-view"><b>Discussion note:</b> {data.sessionNotes[index]}</div>
            ) : null}
          </div>
        )}
      </AssessGroups>

      {['manager_submitted', 'unlocked'].includes(data.status) && (
        <div className="signoff">
          <h3 className="signoff-title">Confirm the feedback was discussed</h3>
          <p className="muted signoff-sub">
            Both sides confirm the feedback session took place before the review can be finalised.
          </p>
          <div className="signoff-rows">
            <AckRow
              label="Manager confirmation"
              desc="I confirm I have discussed this feedback with the employee."
              at={data.managerAckAt}
              canAck={data.canAckManager}
              busy={busy}
              onAck={() => acknowledge('manager')}
            />
            <AckRow
              label="Employee confirmation"
              desc="I confirm this feedback has been discussed with me."
              at={data.employeeAckAt}
              canAck={data.canAckEmployee}
              busy={busy}
              onAck={() => acknowledge('employee')}
            />
          </div>
        </div>
      )}

      {(data.canFinalize || data.canEditNotes) && (
        <div className="assess-actions">
          <span className="muted">
            {data.canFinalize && !data.bothAcknowledged
              ? 'Both confirmations above are required before you can finalise.'
              : 'Add any discussion notes, then finalise to store the signed KPI document under the employee.'}
          </span>
          <div className="assess-actions-btns">
            {data.canEditNotes && (
              <button className="btn-ghost" disabled={busy} onClick={saveNotes}>Save notes</button>
            )}
            {data.canFinalize && (
              <button className="btn-primary" disabled={busy || !data.bothAcknowledged} onClick={finalize}
                title={data.bothAcknowledged ? '' : 'Both parties must confirm the feedback was discussed first'}>
                {busy ? 'Finalising…' : 'Finalise review'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AckRow({ label, desc, at, canAck, busy, onAck }) {
  return (
    <div className={'signoff-row' + (at ? ' is-done' : '')}>
      <div className="signoff-row-main">
        <div className="signoff-row-label">
          {at ? <span className="signoff-check" aria-hidden>✓</span> : <span className="signoff-dot" aria-hidden />}
          {label}
        </div>
        <div className="signoff-row-desc muted">{desc}</div>
      </div>
      <div className="signoff-row-action">
        {at ? (
          <span className="signoff-done-at">Confirmed {new Date(at).toLocaleString()}</span>
        ) : canAck ? (
          <button className="btn-primary" disabled={busy} onClick={onAck}>Confirm</button>
        ) : (
          <span className="muted signoff-await">Awaiting confirmation</span>
        )}
      </div>
    </div>
  );
}
