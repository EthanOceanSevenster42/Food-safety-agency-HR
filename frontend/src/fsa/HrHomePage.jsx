import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { auth } from '../auth.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, StatRow, useFsa } from './Ui.jsx';

const ALERT_KIND = {
  Finding: { cls: 'aps-alert--bad', badge: 'bad' },
  Observation: { cls: 'aps-alert--warn', badge: 'warn' },
  Recommendation: { cls: 'aps-alert--info', badge: 'info' },
  Note: { cls: 'aps-alert--na', badge: 'na' },
};

// Where each alert's call to action leads.
const ALERT_LINK = {
  'Open competence register': '/competence',
  'View expiry schedule': '/competence',
  'Confirm the on-site day': '/leave',
  'Prepare renewals': '/directory',
};

const QUICK = [
  { to: '/leave', icon: 'fas fa-calendar-check', title: 'Approve leave', sub: 'Decided against site coverage' },
  { to: '/directory', icon: 'fas fa-map-location-dot', title: 'Change a placement', sub: 'Move an inspector between sites' },
  { to: '/red-to-green', icon: 'fas fa-traffic-light', title: 'Start onboarding', sub: 'Red to Green programme' },
  { to: '/recruitment', icon: 'fas fa-user-plus', title: 'Recruitment pipeline', sub: '3 candidates at offer stage' },
];

const dayName = () =>
  new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export default function HrHomePage() {
  const { data, error, loading, reload } = useFsa(() => api.fsaHome());
  const user = auth.getUser();
  const firstName = (user?.displayName || user?.email || '').split(/[\s@.]/)[0];
  const who = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : 'there';

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  const pendingLabel = data.pending > 0
    ? `${data.pending} awaiting a decision`
    : 'Nothing awaiting you';

  return (
    <div className="aps-page">
      <PageHead
        crumb="Overview"
        title={`${greeting()}, ${who}`}
        sub={`${dayName()} · ${pendingLabel}. Placement coverage is complete at every site except Rustenburg, where one inspector is on unplanned leave.`}
        actions={
          <Link to="/requisitions" className="aps-btn aps-btn--primary" style={{ textDecoration: 'none' }}>
            <i className="fas fa-plus" /> New request
          </Link>
        }
      />

      <StatRow
        stats={data.stats}
        icons={['fas fa-users', 'fas fa-location-dot', 'fas fa-calendar-day', 'fas fa-certificate']}
      />

      <div style={{ marginBottom: 16 }}>
        <Card title="Quick actions">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {QUICK.map((q) => (
              <Link
                key={q.to}
                to={q.to}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: 14,
                  border: '1px solid #e5e7eb', borderRadius: 10, textDecoration: 'none',
                  background: '#fff', color: 'inherit',
                }}
              >
                <div className="aps-stat-icon" style={{ background: '#e0f2f5' }}>
                  <i className={q.icon} style={{ color: '#007890' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#111827' }}>{q.title}</div>
                  <div className="aps-meta">{q.sub}</div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="aps-two-col">
        <Card title="Attention required" note="Updated 07:40">
          <div className="aps-stack">
            {data.alerts.map((a) => {
              const k = ALERT_KIND[a.Kind] || ALERT_KIND.Note;
              const to = ALERT_LINK[a.Action];
              return (
                <div key={a.Ref} className={`aps-alert ${k.cls}`}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <Badge kind={k.badge}>{a.Kind}</Badge>
                    <span className="aps-meta aps-td-mono">{a.Ref}</span>
                  </div>
                  <div className="aps-alert-title">{a.Title}</div>
                  <p className="aps-note" style={{ margin: '0 0 10px' }}>{a.Body}</p>
                  {to ? (
                    <Link to={to} className="aps-btn aps-btn--ghost" style={{ textDecoration: 'none' }}>
                      {a.Action} <i className="fas fa-arrow-right" style={{ fontSize: '0.7rem' }} />
                    </Link>
                  ) : (
                    <span className="aps-meta">{a.Action}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="aps-stack">
          <Card title="Notices">
            <div className="aps-stack" style={{ gap: 14 }}>
              {data.notices.map((n) => (
                <div key={n.Title}>
                  <div className="aps-meta aps-td-mono">
                    {String(n.NoticeDate).slice(0, 10)}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#111827', margin: '2px 0 3px' }}>
                    {n.Title}
                  </div>
                  <p className="aps-note" style={{ margin: 0 }}>{n.Body}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card title="This week">
            <div className="aps-stack" style={{ gap: 10 }}>
              {data.week.map((w) => (
                <div key={w.Body} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span
                    className="aps-badge aps-badge--info"
                    style={{ minWidth: 44, justifyContent: 'center' }}
                  >
                    {w.DayLabel}
                  </span>
                  <span className="aps-note">{w.Body}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
