import { api } from '../api.js';
import { Badge, Bar, Card, PageHead, Spinner, ErrorNote, StatRow, useFsa } from './Ui.jsx';

// Severity -> stylesheet class, and the order a reader should work down the
// list. Both name presentation, not content.
const WATCH_CLASS = {
  bad: 'aps-alert--bad',
  warn: 'aps-alert--warn',
  info: 'aps-alert--info',
  ok: 'aps-alert--na',
  na: 'aps-alert--na',
};
const WATCH_RANK = { bad: 0, warn: 1, info: 2, ok: 3, na: 4 };

function SectionHead({ title, note }) {
  return (
    <div className="aps-section-head">
      <h2>{title}</h2>
      {note && <span className="aps-section-note">{note}</span>}
    </div>
  );
}

function Figure({ figure, tone }) {
  if (!figure) return null;
  return (
    <div className={`aps-figure aps-figure--${tone}`}>
      <div className="aps-figure-label">{figure.label}</div>
      <div className="aps-figure-value">{figure.value}</div>
      {figure.basis && <div className="aps-figure-basis">{figure.basis}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { data, error, loading, reload } = useFsa(() => api.fsaDashboard());

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  const watch = [...(data.watch ?? [])].sort(
    (a, b) => (WATCH_RANK[a.TagKind] ?? 9) - (WATCH_RANK[b.TagKind] ?? 9)
  );

  // Utilisation thresholds are configuration (FsaSettings), not constants
  // compiled into this page, so the target can be changed without a deploy.
  const utilGood = data.thresholds?.utilGood ?? 90;
  const utilFair = data.thresholds?.utilFair ?? 85;

  const decision = data.decision;
  const org = data.org ?? {};

  // "Cost to fill two posts — R 96k, against R 214 800 relief spend" states
  // exactly the comparison the decision block makes in full, so it appeared
  // on the page twice in two shapes. Dropping it lets the rest breathe.
  const stats = (data.stats ?? []).filter((s) => !/cost to fill/i.test(s.Label));

  // The service rows should account for the headline headcount; totalling them
  // lets a reader confirm that rather than assume it.
  const services = data.services ?? [];
  const totalStaff = services.reduce((n, s) => n + (Number(s.Staff) || 0), 0);
  const totalVacancies = services.reduce((n, s) => n + (Number(s.Vacancies) || 0), 0);
  const headcount = Number(String(data.stats?.[0]?.Value ?? '').replace(/\D/g, ''));

  return (
    <div className="aps-page">
      <PageHead
        crumb="Overview · Management view"
        title="People performance"
        sub="One page for the directors' meeting. Every figure is drawn from the placement, competence and leave registers on the previous screens."
      />

      {/* The ask leads the page; everything below it is the evidence. */}
      {decision && (
        <div className="aps-decision">
          <div className="aps-decision-label">{decision.title}</div>
          <p className="aps-decision-ask">{decision.body}</p>

          {(decision.against || decision.for) && (
            <div className="aps-figures">
              <Figure figure={decision.against} tone="against" />
              <Figure figure={decision.for} tone="for" />
            </div>
          )}

          {decision.detail && (
            <p className="aps-note" style={{ margin: 0 }}>{decision.detail}</p>
          )}
        </div>
      )}

      <SectionHead title="The numbers" note={data.period} />

      <StatRow
        stats={stats}
        icons={[
          'fas fa-users',
          'fas fa-location-dot',
          'fas fa-certificate',
          'fas fa-person-walking-arrow-right',
        ]}
      />

      <SectionHead title="Where the people are" />

      <div className="aps-two-col">
        <Card
          title="Headcount by service area"
          note={`Utilisation: ${utilGood}%+ on target`}
          flush
        >
          <div className="aps-table-wrap">
            <table className="aps-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Staff</th>
                  <th>Vacancies</th>
                  <th>Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.Name}>
                    <td className="aps-td-strong">{s.Name}</td>
                    <td className="aps-td-mono">{s.Staff}</td>
                    {/* A zero here is good news; printing it in the same
                        weight as a 4 made a full establishment read as
                        identical to four open posts. */}
                    <td className="aps-td-mono">
                      {Number(s.Vacancies) === 0
                        ? <span style={{ color: '#9ca3af' }}>—</span>
                        : s.Vacancies}
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Bar
                          pct={s.Pct}
                          color={s.Pct >= utilGood ? '#007890' : s.Pct >= utilFair ? '#6b7280' : '#b45309'}
                        />
                        <span className="aps-td-mono" style={{ minWidth: 38, textAlign: 'right' }}>
                          {s.Utilisation}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>All services</td>
                  <td className="aps-td-mono">{totalStaff}</td>
                  <td className="aps-td-mono">{totalVacancies}</td>
                  <td className="aps-meta" style={{ fontWeight: 400 }}>
                    {totalStaff === headcount
                      ? 'Matches headcount above'
                      : 'Does not match headcount above'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <div className="aps-stack">
          {/* Same left-edge severity treatment as the alerts on HR home, so
              "something to watch" looks the same wherever it appears. */}
          <Card title="Watch list" note="Most serious first">
            <div className="aps-stack">
              {watch.map((w) => (
                <div key={w.Title} className={`aps-alert ${WATCH_CLASS[w.TagKind] || WATCH_CLASS.na}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#111827' }}>{w.Title}</span>
                    <Badge kind={w.TagKind}>{w.Tag}</Badge>
                  </div>
                  <p className="aps-note" style={{ margin: '4px 0 0' }}>{w.Body}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Whose page this is and how it may be handled. Entity details come
          from FsaSettings, so they are not baked into the build. */}
      <footer className="aps-page-foot">
        {org.legalName && <span className="aps-page-foot-name">{org.legalName}</span>}
        {org.directors && <span>Directors: {org.directors}</span>}
        {(org.email || org.phone) && (
          <span>{[org.email, org.phone].filter(Boolean).join(' · ')}</span>
        )}
        {org.handling && <span className="aps-page-foot-mark">{org.handling}</span>}
      </footer>
    </div>
  );
}
