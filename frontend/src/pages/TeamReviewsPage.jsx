import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const STATUS_LABEL = {
  employee_pending:   'Awaiting employee',
  employee_submitted: 'Action needed — your review',
  manager_submitted:  'Done — session locked',
  unlocked:           'In session',
  completed:          'Completed',
};

// Manager landing page: reviews for their direct reports.
export default function TeamReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.listTeamKpiReviews()
      .then((r) => { if (!cancelled) setReviews(Array.isArray(r) ? r : []); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Team KPI Reviews</h1>
          <p className="muted">Review your direct reports' self-assessments and add your own ratings.</p>
        </div>
      </header>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : reviews.length === 0 ? (
        <div className="empty-state"><p>No reviews for your team yet.</p></div>
      ) : (
        <ul className="my-review-list">
          {reviews.map((rv) => (
            <li key={rv.id} className={'my-review-item kpi-review-' + rv.status}>
              <div className="my-review-main">
                <div className="my-review-period">{rv.employeeName} · {rv.periodLabel}</div>
                <div className="muted">{rv.kpiCount} KPI{rv.kpiCount === 1 ? '' : 's'}</div>
                <div className={'my-review-status kpi-review-badge kpi-review-' + rv.status}>
                  {STATUS_LABEL[rv.status] || rv.status}
                </div>
              </div>
              <div className="my-review-actions">
                {rv.status === 'employee_submitted' ? (
                  <Link className="btn-primary" to={`/team-review/${rv.id}`}>Review now</Link>
                ) : (rv.status === 'manager_submitted' || rv.status === 'unlocked') ? (
                  <Link className="btn-primary" to={`/review-session/${rv.id}`}>Open session</Link>
                ) : rv.status === 'completed' ? (
                  <Link className="btn-ghost" to={`/review-session/${rv.id}`}>View outcome</Link>
                ) : (
                  <Link className="btn-ghost" to={`/team-review/${rv.id}`}>View</Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
