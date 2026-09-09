import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Card, PageHead, Spinner, ErrorNote, Table, useFsa } from './Ui.jsx';

// Registration state -> the words a reader sees. The column used to hold one
// free-text field carrying three different sentence shapes ("Valid to
// 2027-04-30", "Expires 2026-10-14", "Expired 2026-08-31", "Not applicable"),
// which could be neither scanned nor sorted.
const REG_STATE = {
  bad: { label: 'Expired', cls: 'aps-badge--bad', lead: 'Lapsed' },
  warn: { label: 'Expires soon', cls: 'aps-badge--warn', lead: 'Expires' },
  ok: { label: 'Valid', cls: 'aps-badge--ok', lead: 'Valid to' },
  na: { label: 'Not required', cls: 'aps-badge--na', lead: null },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 2026-08-31 -> 31 Aug 2026. An ISO date in a table is a lookup, not a read.
function niceDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return null;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export default function DirectoryPage() {
  const [service, setService] = useState('All');
  const [sort, setSort] = useState('attention');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');

  // Debounce the search. The query is a dependency of the fetch, so typing
  // "Rustenburg" previously fired ten requests.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const { data, error, loading, reload } = useFsa(
    () => api.fsaStaff({ service, q, sort }),
    [service, q, sort]
  );

  const fieldServices = new Set(data?.fieldServices || []);
  const expired = data?.attention?.expired ?? 0;
  const expiring = data?.attention?.expiring ?? 0;
  const filtered = service !== 'All' || q !== '';

  return (
    <div className="aps-page">
      <PageHead
        crumb="People"
        title="Directory &amp; site placements"
        sub="Every employee is shown against the site they are currently placed at, so HR and management read the same record when a placement changes."
      />

      {/* Registration problems block a placement, so they lead the screen
          rather than waiting to be spotted in a table cell. Counted across the
          whole register, so a filter cannot hide them. */}
      <div className="aps-standing">
        {expired + expiring === 0 ? (
          <span className="aps-standing-item">
            <i className="fas fa-circle-check" style={{ color: '#1f7a52' }} />
            Every registration on the register is valid.
          </span>
        ) : (
          <>
            {expired > 0 && (
              <span className="aps-standing-item">
                <i className="fas fa-ban" style={{ color: '#ed3237' }} />
                <span>
                  <span className="aps-standing-count">{expired}</span>{' '}
                  {expired === 1 ? 'registration has lapsed' : 'registrations have lapsed'} — placement blocked
                </span>
              </span>
            )}
            {expired > 0 && expiring > 0 && <span className="aps-standing-sep" aria-hidden="true">|</span>}
            {expiring > 0 && (
              <span className="aps-standing-item">
                <i className="fas fa-hourglass-half" style={{ color: '#b06a00' }} />
                <span>
                  <span className="aps-standing-count">{expiring}</span> expiring within 60 days
                </span>
              </span>
            )}
            <Link
              to="/competence"
              className="aps-standing-item"
              style={{ marginLeft: 'auto', textDecoration: 'none', color: '#007890', fontWeight: 600 }}
            >
              Competence register <i className="fas fa-arrow-right" style={{ fontSize: '0.7rem' }} />
            </Link>
          </>
        )}
      </div>

      <Card
        title="Placement register"
        note={data ? `${data.rows.length}${filtered ? ` of ${data.total}` : ''} employees` : null}
        flush
      >
        <div style={{ padding: '14px 20px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
            <i
              className="fas fa-magnifying-glass"
              style={{ position: 'absolute', left: 10, top: 10, color: '#9ca3af', fontSize: '0.75rem' }}
            />
            <input
              className="aps-input"
              style={{ paddingLeft: 30 }}
              placeholder="Search name, staff no., role, site…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
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

          {/* Sort orders come from the reference data, and the keys match the
              server's whitelist. */}
          {data?.sorts?.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
              <span className="aps-meta">Order</span>
              <select
                className="aps-select"
                style={{ width: 'auto' }}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                {data.sorts.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {loading && <Spinner />}
        {error && <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div>}

        {data && !loading && (
          <Table
            columns={['Employee', 'Role & service', 'Placement', 'Registration', 'Contract']}
            isEmpty={data.rows.length === 0}
            empty="No employee matches that search."
          >
            {data.rows.map((p) => {
              const reg = REG_STATE[p.RegKind] || REG_STATE.na;
              const when = niceDate(p.RegExpiry);
              return (
                <tr key={p.StaffNo}>
                  <td>
                    <div className="aps-td-strong">{p.Name}</div>
                    <div className="aps-meta aps-td-mono">{p.StaffNo}</div>
                  </td>

                  {/* Role and service were two columns saying one thing. The
                      service badge was also rendered in the FSA red, which in
                      this app means "blocked" — so every field inspector
                      looked like a problem. It is a quiet label now. */}
                  <td>
                    <div>{p.Role}</div>
                    <div className="aps-meta">
                      {fieldServices.has(p.Service) && (
                        <i
                          className="fas fa-location-dot"
                          title="Field service — carries site placements"
                          style={{ color: '#007890', marginRight: 5, fontSize: '0.7rem' }}
                        />
                      )}
                      {p.Service}
                    </div>
                  </td>

                  <td>{p.Site}</td>

                  {/* Status first, then the date underneath. */}
                  <td>
                    <span className={`aps-badge ${reg.cls}`}>{reg.label}</span>
                    {when && (
                      <div className="aps-meta" style={{ marginTop: 3 }}>
                        {reg.lead} {when}
                      </div>
                    )}
                  </td>

                  <td>{p.Contract}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
