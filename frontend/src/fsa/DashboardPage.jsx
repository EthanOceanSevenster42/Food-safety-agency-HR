import { api } from '../api.js';
import { Badge, Bar, Card, PageHead, Spinner, ErrorNote, StatRow, useFsa } from './Ui.jsx';

export default function DashboardPage() {
  const { data, error, loading, reload } = useFsa(() => api.fsaDashboard());

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  return (
    <div className="aps-page">
      <PageHead
        crumb="Overview · Management view · month to date"
        title="People performance"
        sub="One page for the directors' meeting. Every figure here is drawn from the placement, competence and leave registers on the previous screens."
      />

      <StatRow
        stats={data.stats}
        icons={[
          'fas fa-users',
          'fas fa-location-dot',
          'fas fa-certificate',
          'fas fa-person-walking-arrow-right',
          'fas fa-coins',
        ]}
      />

      <div className="aps-two-col">
        <Card title="Headcount by service area" note={data.period} flush>
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
                {data.services.map((s) => (
                  <tr key={s.Name}>
                    <td className="aps-td-strong">{s.Name}</td>
                    <td className="aps-td-mono">{s.Staff}</td>
                    <td className="aps-td-mono">{s.Vacancies}</td>
                    <td style={{ minWidth: 160 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Bar
                          pct={s.Pct}
                          color={s.Pct >= 90 ? '#007890' : s.Pct >= 85 ? '#6b7280' : '#b45309'}
                        />
                        <span className="aps-td-mono" style={{ minWidth: 38, textAlign: 'right' }}>
                          {s.Utilisation}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="aps-stack">
          <Card title="Watch list">
            <div className="aps-stack" style={{ gap: 14 }}>
              {data.watch.map((w) => (
                <div key={w.Title}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#111827' }}>{w.Title}</span>
                    <Badge kind={w.TagKind}>{w.Tag}</Badge>
                  </div>
                  <p className="aps-note" style={{ margin: '3px 0 0' }}>{w.Body}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card title={data.decision.title}>
            <p style={{ margin: '0 0 8px', fontSize: '0.88rem', fontWeight: 600, color: '#111827', lineHeight: 1.5 }}>
              {data.decision.body}
            </p>
            <p className="aps-note" style={{ margin: 0 }}>{data.decision.detail}</p>
          </Card>

          <Card title="Food Safety Agency (Pty) Ltd">
            <div className="aps-meta">Directors: L. Visagie, H. Nel, EJ. Smit, T. Streicher</div>
            <div className="aps-meta">info@afsq.co.za · (012) 361 1937</div>
            <div className="aps-meta" style={{ marginTop: 6 }}>Internal use only</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
