import { useState } from 'react';
import { api } from '../api.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, Table, useFsa } from './Ui.jsx';

// Field services carry the FSA red; office/technical services carry the teal.
const FIELD_SERVICES = new Set(['IMI', 'APS']);

export default function DirectoryPage() {
  const [service, setService] = useState('All');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useFsa(
    () => api.fsaStaff({ service, q }),
    [service, q]
  );

  return (
    <div className="aps-page">
      <PageHead
        crumb="People"
        title="Directory &amp; site placements"
        sub="Every employee is shown against the site they are currently placed at, so HR and management read the same record when a placement changes."
      />

      <Card
        title="Placement register"
        note={data ? `Showing ${data.rows.length} of ${data.total} employees` : null}
        flush
      >
        <div style={{ padding: '14px 20px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
            <i
              className="fas fa-magnifying-glass"
              style={{ position: 'absolute', left: 10, top: 10, color: '#9ca3af', fontSize: '0.75rem' }}
            />
            <input
              className="aps-input"
              style={{ paddingLeft: 30 }}
              placeholder="Search name, role, site…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="aps-chip-row">
            {(data?.services || ['All']).map((s) => (
              <button
                key={s}
                className={'aps-chip' + (service === s ? ' active' : '')}
                onClick={() => setService(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {loading && <Spinner />}
        {error && <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div>}

        {data && !loading && (
          <Table
            columns={['Employee', 'Role', 'Service', 'Placement', 'Registration', 'Contract']}
            isEmpty={data.rows.length === 0}
            empty="No employee matches that search."
          >
            {data.rows.map((p) => (
              <tr key={p.StaffNo}>
                <td>
                  <div className="aps-td-strong">{p.Name}</div>
                  <div className="aps-meta aps-td-mono">{p.StaffNo}</div>
                </td>
                <td>{p.Role}</td>
                <td>
                  <Badge kind={FIELD_SERVICES.has(p.Service) ? 'bad' : 'info'}>{p.Service}</Badge>
                </td>
                <td>{p.Site}</td>
                <td>
                  <span className={`aps-badge ${
                    { ok: 'aps-badge--ok', warn: 'aps-badge--warn', bad: 'aps-badge--bad', na: 'aps-badge--na' }[p.RegKind]
                  }`} style={{ textTransform: 'none', letterSpacing: 0, fontFamily: "'IBM Plex Mono', monospace" }}>
                    {p.Registration}
                  </span>
                </td>
                <td>{p.Contract}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
