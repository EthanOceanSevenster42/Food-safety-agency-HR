import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, StatRow, PHASE_COLOR, useFsa } from './Ui.jsx';

const PHASE_KIND = { 1: 'bad', 2: 'warn', 3: 'ok', 0: 'na' };

// The three phase bars, skewed the way the FSA mark is.
function PhaseBars({ p1, p2, p3 }) {
  return (
    <div style={{ display: 'flex', gap: 3, width: 130 }}>
      {[[p1, 1], [p2, 2], [p3, 3]].map(([pct, ph]) => (
        <span key={ph} style={{ flex: 1, height: 8, background: '#f3f4f6', borderRadius: 2, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: PHASE_COLOR[ph] }} />
        </span>
      ))}
    </div>
  );
}

export default function RedToGreenPage() {
  const { data, error, loading, reload } = useFsa(() => api.fsaR2g());

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  return (
    <div className="aps-page">
      <PageHead
        crumb="Onboarding · Red to Green"
        title="Who is where in the programme"
        sub="Every department runs the same three-phase method and the same gates. Only the activities inside each phase change. This board shows the phase, the day, the next gate and where someone is falling behind."
        actions={
          <Link to="/department-templates" className="aps-btn aps-btn--ghost" style={{ textDecoration: 'none' }}>
            <i className="fas fa-list-check" /> Department templates
          </Link>
        }
      />

      <StatRow
        stats={data.stats}
        icons={['fas fa-users-line', 'fas fa-triangle-exclamation', 'fas fa-stamp', 'fas fa-stopwatch']}
      />

      <div style={{ marginBottom: 16 }}>
        <Card
          title="The method — fixed for every department"
          note="Three phases · one month each · two written gates · one sign-off"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {data.method.map((m, i) => (
              <div key={m.title}>
                <span style={{
                  display: 'block', width: '100%', height: 6, marginBottom: 10,
                  background: PHASE_COLOR[i], transform: 'skewX(-11deg)',
                }} />
                <div className="aps-meta">{m.phase}</div>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#111827', margin: '2px 0 6px' }}>{m.title}</div>
                <p className="aps-note" style={{ margin: '0 0 8px' }}>{m.body}</p>
                <div className="aps-meta" style={{ fontWeight: 600 }}>{m.gate}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="In the programme" note={`${data.cohort.length} inspectors`} flush>
        <div className="aps-table-wrap">
          <table className="aps-table">
            <thead>
              <tr>
                <th>Inspector</th>
                <th>Phase</th>
                <th>Progress</th>
                <th>Day</th>
                <th>Next gate</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.cohort.map((c) => (
                <tr key={c.Code}>
                  <td>
                    <div className="aps-td-strong">{c.Name}</div>
                    <div className="aps-meta">{c.Role} · {c.Site}</div>
                  </td>
                  <td><Badge kind={PHASE_KIND[c.Phase]}>{c.PhaseLabel}</Badge></td>
                  <td>
                    <PhaseBars p1={c.P1} p2={c.P2} p3={c.P3} />
                    <div className="aps-meta" style={{ marginTop: 4 }}>{c.Pct}% of programme</div>
                  </td>
                  <td className="aps-td-mono">{c.DayLabel}</td>
                  <td>{c.Gate}</td>
                  <td><Badge kind={c.StatusKind}>{c.Status}</Badge></td>
                  <td>
                    <Link to={`/red-to-green/${c.Code}`} className="aps-btn aps-btn--ghost" style={{ textDecoration: 'none' }}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
