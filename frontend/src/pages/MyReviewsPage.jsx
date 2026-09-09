import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const STATUS_LABEL = {
  employee_pending:   'Action needed — complete your review',
  employee_submitted: 'Submitted — awaiting your manager',
  manager_submitted:  'Manager done — session locked',
  unlocked:           'Ready to review together',
  completed:          'Completed',
};

// Landing page for staff (employees/managers): their own KPI reviews.
export default function MyReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.listMyKpiReviews()
      .then((r) => { if (!cancelled) setReviews(Array.isArray(r) ? r : []); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>My KPI Reviews</h1>
          <p className="muted">Complete your self-assessment when a review is assigned to you.</p>
        </div>
      </header>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : reviews.length === 0 ? (
        <div className="empty-state"><p>You have no KPI reviews yet.</p></div>
      ) : (
        <ul className="my-review-list">
          {reviews.map((rv) => (
            <li key={rv.id} className={'my-review-item kpi-review-' + rv.status}>
              <div className="my-review-main">
                <div className="my-review-period">{rv.periodLabel}</div>
                <div className="muted">
                  {rv.kpiCount} KPI{rv.kpiCount === 1 ? '' : 's'}
                  {rv.managerName ? ` · Manager: ${rv.managerName}` : ''}
                </div>
                <div className={'my-review-status kpi-review-badge kpi-review-' + rv.status}>
                  {STATUS_LABEL[rv.status] || rv.status}
                </div>
              </div>
              <div className="my-review-actions">
                {rv.status === 'employee_pending' ? (
                  <Link className="btn-primary" to={`/kpi-review/${rv.id}`}>Complete review</Link>
                ) : rv.status === 'employee_submitted' ? (
                  <Link className="btn-ghost" to={`/kpi-review/${rv.id}`}>View</Link>
                ) : rv.status === 'completed' ? (
                  <Link className="btn-ghost" to={`/review-session/${rv.id}`}>View outcome</Link>
                ) : (
                  <Link className="btn-primary" to={`/review-session/${rv.id}`}>Open session</Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
