import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { auth } from '../auth.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, StatRow, useFsa } from './Ui.jsx';

// Severity -> stylesheet class. This is the only mapping still in the
// component, because it names CSS rather than content: the words a reader
// sees ("Blocking", "Due soon") and the route each alert's button leads to
// now come from FsaLookups and FsaAlerts.Route.
const KIND_CLS = {
  bad: 'aps-alert--bad',
  warn: 'aps-alert--warn',
  info: 'aps-alert--info',
  na: 'aps-alert--na',
};

// Which icon and colour each standing figure gets. The counts themselves are
// computed server-side and arrive in data.standing.
const STANDING = [
  { key: 'blocking', icon: 'fas fa-triangle-exclamation', colour: '#ed3237', to: '/directory', one: 'placement blocked', many: 'placements blocked' },
  { key: 'pending', icon: 'fas fa-calendar-day', colour: '#b06a00', to: '/leave', one: 'leave request to decide', many: 'leave requests to decide' },
  { key: 'expiring', icon: 'fas fa-certificate', colour: '#b06a00', to: '/competence', one: 'registration expiring', many: 'registrations expiring' },
];

const dayName = () =>
  new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function SectionHead({ title, note }) {
  return (
    <div className="aps-section-head">
      <h2>{title}</h2>
      {note && <span className="aps-section-note">{note}</span>}
    </div>
  );
}

export default function HrHomePage() {
  const { data, error, loading, reload } = useFsa(() => api.fsaHome());
  const user = auth.getUser();
  const firstName = (user?.displayName || user?.email || '').split(/[\s@.]/)[0];
  const who = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : 'there';

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  const alerts = data.alerts ?? [];
  const quickActions = data.quickActions ?? [];

  // Severity wording for each alert kind, keyed by the stored audit term.
  const kindByCode = new Map((data.alertKinds ?? []).map((k) => [k.code, k]));

  const standing = STANDING
    .map((s) => ({ ...s, count: Number(data.standing?.[s.key] ?? 0) }))
    .filter((s) => s.count > 0);

  return (
    <div className="aps-page">
      <PageHead
        crumb="Overview"
        title={`${greeting()}, ${who}`}
        sub={dayName()}
        actions={
          <Link to="/requisitions" className="aps-btn aps-btn--primary" style={{ textDecoration: 'none' }}>
            <i className="fas fa-plus" /> New request
          </Link>
        }
      />

      {/* What is waiting on this person, before anything else on the page.
          Every figure is counted by the API. */}
      <div className="aps-standing">
        {standing.length === 0 ? (
          <span className="aps-standing-item">
            <i className="fas fa-circle-check" style={{ color: '#1f7a52' }} />
            Nothing is waiting on you today.
          </span>
        ) : (
          standing.map((s, i) => (
            <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '8px 18px' }}>
              <Link to={s.to} className="aps-standing-item" style={{ textDecoration: 'none' }}>
                <i className={s.icon} style={{ color: s.colour }} />
                <span>
                  <span className="aps-standing-count">{s.count}</span>{' '}
                  {s.count === 1 ? s.one : s.many}
                </span>
              </Link>
              {i < standing.length - 1 && <span className="aps-standing-sep" aria-hidden="true">|</span>}
            </span>
          ))
        )}
      </div>

      <StatRow
        stats={data.stats}
        icons={['fas fa-users', 'fas fa-location-dot', 'fas fa-calendar-day', 'fas fa-certificate']}
      />

      <SectionHead
        title="Needs you"
        note={alerts.length ? `${plural(alerts.length, 'item', 'items')} open · most urgent first` : undefined}
      />

      <div style={{ marginBottom: 16 }}>
        <Card title="Start a task">
          <div className="aps-quick-grid">
            {quickActions.map((q) => (
              <Link key={q.route} to={q.route} className="aps-quick">
                <div className="aps-stat-icon" style={{ background: '#e0f2f5' }}>
                  <i className={q.icon} style={{ color: '#007890' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="aps-quick-title">{q.title}</div>
                  <div className="aps-meta">{q.sub}</div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Attention required">
        <div className="aps-stack">
          {alerts.map((a) => {
            const k = kindByCode.get(a.Kind);
            const severity = k?.kind || 'na';
            return (
              <div key={a.Ref} className={`aps-alert ${KIND_CLS[severity] || KIND_CLS.na}`}>
                <Badge kind={severity}>
                  {/* The stored audit term is kept in the tooltip for anyone
                      who works in that vocabulary. */}
                  <span title={k?.detail ? `${a.Kind} — ${k.detail}` : a.Kind}>
                    {k?.label || a.Kind}
                  </span>
                </Badge>
                <div className="aps-alert-title">{a.Title}</div>
                <p className="aps-note" style={{ margin: '0 0 10px' }}>{a.Body}</p>
                <div className="aps-alert-foot">
                  {a.Route ? (
                    <Link to={a.Route} className="aps-btn aps-btn--ghost" style={{ textDecoration: 'none' }}>
                      {a.Action} <i className="fas fa-arrow-right" style={{ fontSize: '0.7rem' }} />
                    </Link>
                  ) : (
                    <span className="aps-meta">{a.Action}</span>
                  )}
                  <span className="aps-alert-ref aps-td-mono">{a.Ref}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <SectionHead title="Good to know" note="No action needed" />

      <div className="aps-two-col">
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
  );
}
