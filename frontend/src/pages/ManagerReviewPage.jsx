import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { AssessGroups, RatingFields, scoreLabel } from '../components/AssessGroups.jsx';

// Manager review for one report's review: the employee's answers are shown
// read-only; the manager adds their own 1–5 + comment, then submits and sets
// a session password to share at the meeting. Read-only once submitted.
export default function ManagerReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [showSubmit, setShowSubmit] = useState(false);
  const [sessionPassword, setSessionPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getManagerAssessment(id)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const kpis = d.kpis || [];
        const mine = d.managerRatings || [];
        setRatings(kpis.map((_, i) => ({ rating: mine[i]?.rating ?? null, comment: mine[i]?.comment ?? '', data: mine[i]?.data ?? '' })));
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const editable = !!data?.editable;
  const total = (data?.kpis || []).length;
  const completeCount = ratings.filter((r) => r.rating != null).length;
  const pct = total ? Math.round((completeCount / total) * 100) : 0;

  function setRating(i, val) { setRatings((p) => p.map((r, idx) => (idx === i ? { ...r, rating: val } : r))); }
  function setComment(i, val) { setRatings((p) => p.map((r, idx) => (idx === i ? { ...r, comment: val } : r))); }
  function setDataField(i, val) { setRatings((p) => p.map((r, idx) => (idx === i ? { ...r, data: val } : r))); }

  async function saveDraft() {
    setError(''); setNotice(''); setSaving(true);
    try { await api.saveManagerAssessment(id, { ratings, submit: false }); setNotice('Draft saved.'); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function doSubmit() {
    setError('');
    if (sessionPassword.length < 4) { setError('Session password must be at least 4 characters.'); return; }
    if (sessionPassword !== confirmPw) { setError('Passwords do not match.'); return; }
    setSaving(true);
    try {
      await api.saveManagerAssessment(id, { ratings, submit: true, sessionPassword });
      navigate('/team-reviews', { replace: true });
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="page"><div className="muted">Loading…</div></div>;
  if (!data) return <div className="page"><div className="error">{error || 'Review not found.'}</div></div>;

  return (
    <div className="page assess-page">
      <header className="page-header">
        <div>
          <h1>Manager Review — {data.employeeName}</h1>
          <p className="muted">{data.periodLabel}</p>
        </div>
      </header>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {notice && <div className="notice-banner">{notice}</div>}
      {!editable && (
        <div className="notice-banner">
          {data.status === 'employee_pending'
            ? 'Waiting for the employee to submit their self-assessment.'
            : 'You have submitted this review — share the session password with the employee at your meeting.'}
        </div>
      )}

      {editable && (
        <div className="assess-summary">
          <p className="muted" style={{ margin: 0 }}>
            The employee's answers are shown for reference. Add your rating, the supporting data, and a comment for each KPI.
          </p>
          <div className="assess-progress">
            <div className="assess-progress-track"><div className="assess-progress-fill" style={{ width: `${pct}%` }} /></div>
            <span className="assess-progress-label">{completeCount} of {total} rated</span>
          </div>
        </div>
      )}

      <AssessGroups kpis={data.kpis}>
        {(k, index, ki) => (
          <div key={index} className="assess-kpi">
            <div className="assess-kpi-head">
              <span className="assess-kpi-num">KPI {ki + 1}</span>
              {ratings[index]?.rating != null && (
                <span className="assess-kpi-rated">Rated {ratings[index].rating}/5</span>
              )}
            </div>
            <div className="assess-kpi-desc">{k.kpiDescription}</div>
            {Array.isArray(k.measures) && k.measures.length > 0 && (
              <div className="muted assess-kpi-measures">How it's measured: {k.measures.join(' · ')}</div>
            )}

            <div className="mgr-employee-answer">
              <div className="mgr-answer-title">Employee's self-assessment</div>
              <div className="mgr-answer-line">
                <span className="mgr-answer-key">Rating</span>
                <span className="mgr-answer-val">
                  {data.employeeRatings?.[index]?.rating != null
                    ? `${data.employeeRatings[index].rating} · ${scoreLabel(data.employeeRatings[index].rating)}`
                    : '—'}
                </span>
              </div>
              <div className="mgr-answer-line">
                <span className="mgr-answer-key">Data for review</span>
                <span className="mgr-answer-val">{data.employeeRatings?.[index]?.data || '—'}</span>
              </div>
              <div className="mgr-answer-line">
                <span className="mgr-answer-key">Comment</span>
                <span className="mgr-answer-val">{data.employeeRatings?.[index]?.comment || '—'}</span>
              </div>
            </div>

            <RatingFields
              value={ratings[index]}
              editable={editable}
              name={`m-${index}`}
              onRating={(v) => setRating(index, v)}
              onComment={(v) => setComment(index, v)}
              onData={(v) => setDataField(index, v)}
            />
          </div>
        )}
      </AssessGroups>

      {editable ? (
        showSubmit ? (
          <div className="assess-actions mgr-submit-box">
            <div className="mgr-submit-fields">
              <p className="muted">
                Set a session password to share with {data.employeeName} at your meeting — they'll need it to open the combined review.
              </p>
              <div className="field">
                <label htmlFor="sp">Session password</label>
                <input id="sp" type="text" value={sessionPassword}
                  onChange={(e) => setSessionPassword(e.target.value)} placeholder="At least 4 characters" />
              </div>
              <div className="field">
                <label htmlFor="sp2">Confirm password</label>
                <input id="sp2" type="text" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
              </div>
            </div>
            <div className="assess-actions-btns">
              <button className="btn-ghost" disabled={saving} onClick={() => setShowSubmit(false)}>Back</button>
              <button className="btn-primary" disabled={saving} onClick={doSubmit}>
                {saving ? 'Submitting…' : 'Submit & lock session'}
              </button>
            </div>
          </div>
        ) : (
          <div className="assess-actions">
            <span className="muted">{completeCount}/{total} rated</span>
            <div className="assess-actions-btns">
              <button className="btn-ghost" disabled={saving} onClick={saveDraft}>Save draft</button>
              <button className="btn-primary" disabled={saving || completeCount < total} onClick={() => setShowSubmit(true)}>
                Submit…
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="assess-actions">
          <button className="btn-ghost" onClick={() => navigate('/team-reviews')}>Back to team reviews</button>
        </div>
      )}
    </div>
  );
}
