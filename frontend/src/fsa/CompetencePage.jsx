import { api } from '../api.js';
import { Card, PageHead, Spinner, ErrorNote, StatRow, useFsa } from './Ui.jsx';

const LEGEND = [
  { kind: 'ok', label: 'Valid' },
  { kind: 'warn', label: 'Expires within 60 days' },
  { kind: 'bad', label: 'Expired — placement blocked' },
  { kind: 'na', label: 'Not required for role' },
];

const CELL_STYLE = {
  ok: { color: '#059669', background: 'rgba(16,185,129,0.12)' },
  warn: { color: '#b45309', background: '#fef3c7' },
  bad: { color: '#dc2626', background: 'rgba(239,68,68,0.12)' },
  na: { color: '#9ca3af', background: '#f3f4f6' },
};

export default function CompetencePage() {
  const { data, error, loading, reload } = useFsa(() => api.fsaCompetence());

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  return (
    <div className="aps-page">
      <PageHead
        crumb="People · FSA Academy competence register"
        title="Competence &amp; registrations"
        sub="A placement is only valid while the registration behind it is valid. This register is the evidence a client or a regulator asks for first."
      />

      <StatRow
        stats={data.stats}
        icons={['fas fa-circle-check', 'fas fa-hourglass-half', 'fas fa-ban', 'fas fa-graduation-cap']}
      />

      <Card title="Registration matrix" flush>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {LEGEND.map((l) => (
            <span key={l.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2, flex: 'none',
                background: CELL_STYLE[l.kind].color,
              }} />
              <span className="aps-meta">{l.label}</span>
            </span>
          ))}
        </div>

        <div className="aps-table-wrap">
          <table className="aps-table">
            <thead>
              <tr>
                <th>Employee</th>
                {data.columns.map((c) => <th key={c} style={{ textAlign: 'center' }}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.Name}>
                  <td>
                    <div className="aps-td-strong">{r.Name}</div>
                    <div className="aps-meta">{r.Site}</div>
                  </td>
                  {r.cells.map((c, i) => (
                    <td key={i} style={{ textAlign: 'center' }}>
                      <span style={{
                        ...CELL_STYLE[c.kind],
                        display: 'inline-block',
                        padding: '6px 10px',
                        borderRadius: 4,
                        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                        fontSize: '0.72rem',
                        fontWeight: c.kind === 'na' ? 400 : 600,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}>
                        {c.text}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
