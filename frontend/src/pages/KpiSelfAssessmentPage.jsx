import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { AssessGroups, RatingFields } from '../components/AssessGroups.jsx';

// Employee self-assessment form for one review (reached from the invite
// email or the "My KPI Reviews" list). Read-only once submitted.
export default function KpiSelfAssessmentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [ratings, setRatings] = useState([]); // [{ rating, comment, data }]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getEmployeeAssessment(id)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const kpis = d.kpis || [];
        const existing = d.ratings || [];
        setRatings(kpis.map((_, i) => ({
          rating: existing[i]?.rating ?? null,
          comment: existing[i]?.comment ?? '',
          data: existing[i]?.data ?? '',
        })));
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const editable = !!data?.editable;
  const total = (data?.kpis || []).length;
  const completeCount = ratings.filter((r) => r.rating != null).length;
  const pct = total ? Math.round((completeCount / total) * 100) : 0;

  function setRating(i, val)  { setRatings((p) => p.map((r, idx) => (idx === i ? { ...r, rating: val } : r))); }
  function setComment(i, val) { setRatings((p) => p.map((r, idx) => (idx === i ? { ...r, comment: val } : r))); }
  function setDataField(i, v) { setRatings((p) => p.map((r, idx) => (idx === i ? { ...r, data: v } : r))); }

  async function save(submit) {
    setError(''); setNotice(''); setSaving(true);
    try {
      await api.saveEmployeeAssessment(id, { ratings, submit });
      if (submit) navigate('/my-reviews', { replace: true });
      else setNotice('Draft saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page"><div className="muted">Loading…</div></div>;
  if (!data) return <div className="page"><div className="error">{error || 'Review not found.'}</div></div>;

  return (
    <div className="page assess-page">
      <header className="page-header">
        <div>
          <h1>KPI Self-Assessment</h1>
          <p className="muted">
            {data.periodLabel}{data.managerName ? ` · Manager: ${data.managerName}` : ''}
          </p>
        </div>
      </header>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {notice && <div className="notice-banner">{notice}</div>}
      {!editable && (
        <div className="notice-banner">You've submitted this review — it's now with your manager.</div>
      )}

      {editable && (
        <div className="assess-summary">
          <p className="muted" style={{ margin: 0 }}>
            Rate each KPI 1 (Unsatisfactory) – 5 (Outstanding), add the data that backs it up, and any comment.
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
            <RatingFields
              value={ratings[index]}
              editable={editable}
              name={`r-${index}`}
              onRating={(v) => setRating(index, v)}
              onComment={(v) => setComment(index, v)}
              onData={(v) => setDataField(index, v)}
            />
          </div>
        )}
      </AssessGroups>

      {editable ? (
        <div className="assess-actions">
          <span className="muted">{completeCount}/{total} rated</span>
          <div className="assess-actions-btns">
            <button className="btn-ghost" disabled={saving} onClick={() => save(false)}>Save draft</button>
            <button
              className="btn-primary"
              disabled={saving || completeCount < total}
              onClick={() => save(true)}
            >
              {saving ? 'Submitting…' : 'Submit to manager'}
            </button>
          </div>
        </div>
      ) : (
        <div className="assess-actions">
          <button className="btn-ghost" onClick={() => navigate('/my-reviews')}>Back to my reviews</button>
        </div>
      )}
    </div>
  );
}
