import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, Table, useFsa } from './Ui.jsx';

// Handoff §5.6. Two levels: a pack-completeness table across the register, and
// one employee's pack — a four-stage cycle with three tabs (IJD, KPI & KPA
// schedule, EDP). Packs are role-templated; the EDP is derived from the KPA
// ratings rather than typed, so areas rated below "Meets" produce the goals.

// The cycle stages and the document states are reference data: both arrive with
// the payload (FsaLookups → /api/fsa/performance) so renaming a stage is an
// edit to the lookup table, not to this file. Only the fallbacks for an empty
// vocabulary live here.
const byCode = (list, code) => (list || []).find((x) => x.code === code);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return '—';
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// The four-stage cycle, with the current stage marked. Thin bars only — the
// skewed device is reserved for step markers like this one.
function StageMarker({ stage, stages }) {
  const at = Math.max(0, (stages || []).findIndex((s) => s.code === stage));
  return (
    <ol className="perf-steps">
      {(stages || []).map((s, i) => (
        <li
          key={s.code}
          className={
            'perf-step'
            + (i < at ? ' is-done' : '')
            + (i === at ? ' is-current' : '')
          }
        >
          <span className="perf-step-bar" aria-hidden="true" />
          <span className="perf-step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function PerformancePage() {
  const { staffNo } = useParams();
  return staffNo ? <Pack staffNo={staffNo} /> : <Overview />;
}

// --- level 1: pack completeness -------------------------------------------
function Overview() {
  const { data, error, loading, reload } = useFsa(() => api.fsaPerformance());

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  const s = data.summary;

  return (
    <div className="aps-page">
      <PageHead
        crumb="People"
        title="Performance management"
        sub="Every employee needs a job description, a KPI and KPA schedule and a development plan on file. This is which of the three each pack still owes."
      />

      {/* Completeness is derived from the three document states, never stored. */}
      <div className="aps-standing">
        {s.outstanding === 0 ? (
          <span className="aps-standing-item">
            <i className="fas fa-circle-check" style={{ color: '#1f7a52' }} />
            All {s.total} packs are complete.
          </span>
        ) : (
          <>
            <span className="aps-standing-item">
              <i className="fas fa-folder-open" style={{ color: '#b06a00' }} />
              <span>
                <span className="aps-standing-count">{s.outstanding}</span> of {s.total} packs
                {' '}incomplete
              </span>
            </span>
            <span className="aps-standing-sep" aria-hidden="true">|</span>
            <span className="aps-standing-item">
              <i className="fas fa-circle-check" style={{ color: '#1f7a52' }} />
              <span><span className="aps-standing-count">{s.complete}</span> complete</span>
            </span>
          </>
        )}
      </div>

      <Card title="Pack completeness" note={`Cycle ${data.rows[0]?.CycleYear ?? ''}`} flush>
        <Table
          columns={['Employee', 'Role', 'Cycle stage', 'Job description', 'KPI & KPA', 'EDP', '']}
          isEmpty={data.rows.length === 0}
          empty="No performance packs yet."
        >
          {data.rows.map((p) => (
            <tr key={p.StaffNo}>
              <td>
                <div className="aps-td-strong">{p.Name || p.StaffNo}</div>
                <div className="aps-meta aps-td-mono">{p.StaffNo}</div>
              </td>
              <td>
                <div>{p.Role}</div>
                <div className="aps-meta">{p.Service}</div>
              </td>
              <td>
                <Badge kind={byCode(data.stages, p.Stage)?.kind || 'na'}>
                  {byCode(data.stages, p.Stage)?.label || p.Stage}
                </Badge>
              </td>
              {['JdState', 'KpiState', 'EdpState'].map((k) => (
                <td key={k}>
                  <Badge kind={byCode(data.docStates, p[k])?.kind || 'na'}>
                    {byCode(data.docStates, p[k])?.label || p[k]}
                  </Badge>
                </td>
              ))}
              <td>
                <Link
                  to={`/performance/${encodeURIComponent(p.StaffNo)}`}
                  className="aps-btn aps-btn--ghost"
                  style={{ textDecoration: 'none' }}
                >
                  Open pack <i className="fas fa-arrow-right" style={{ fontSize: '0.7rem' }} />
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

// --- level 2: one employee's pack -----------------------------------------
function Pack({ staffNo }) {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useFsa(() => api.fsaPerfPack(staffNo), [staffNo]);
  const [tab, setTab] = useState('ijd');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  const p = data.pack;
  const meets = data.ratingMeets;

  async function rate(measure, value) {
    setBusy(measure.Id);
    setMsg('');
    try {
      await api.fsaRateMeasure(staffNo, measure.Id, value === '' ? null : Number(value));
      reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function setStage(stage) {
    setBusy('stage');
    setMsg('');
    try {
      await api.fsaSetPerfStage(staffNo, stage);
      reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(null);
    }
  }

  const TABS = [
    { key: 'ijd', label: 'Inspector job description', n: data.kras.length },
    { key: 'kpa', label: 'KPI & KPA schedule', n: data.measures.length },
    { key: 'edp', label: 'Development plan', n: data.goals.length },
  ];

  return (
    <div className="aps-page">
      <PageHead
        crumb={`People · Performance · cycle ${p.CycleYear}`}
        title={p.Name || p.StaffNo}
        sub={`${p.Role} · ${p.Site || '—'}`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="aps-select"
              style={{ width: 'auto' }}
              value={p.Stage}
              disabled={busy === 'stage'}
              onChange={(e) => setStage(e.target.value)}
            >
              {(data.stages || []).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
            <button className="aps-btn aps-btn--ghost" onClick={() => navigate('/performance')}>
              <i className="fas fa-arrow-left" /> All packs
            </button>
          </div>
        }
      />

      {msg && <div className="aps-alert aps-alert--bad" style={{ marginBottom: 12 }}>{msg}</div>}

      <Card>
        <StageMarker stage={p.Stage} stages={data.stages} />
      </Card>

      <div className="aps-stats" style={{ marginTop: 16 }}>
        <div className="aps-stat">
          <div className="aps-stat-label">Weighted rating</div>
          <div className="aps-stat-value">
            {data.derived.weightedScore ?? '—'}
            {data.derived.weightedScore != null && <span className="perf-of"> / 5</span>}
          </div>
          <div className="aps-meta">
            {data.derived.ratedCount} of {data.derived.measureCount} measures rated
          </div>
        </div>
        <div className="aps-stat">
          <div className="aps-stat-label">Areas below “Meets”</div>
          <div className="aps-stat-value">{data.shortfalls.length}</div>
          <div className="aps-meta">Each one produces a development goal</div>
        </div>
        <div className="aps-stat">
          <div className="aps-stat-label">Registration required</div>
          <div className="aps-stat-value perf-reg">{p.RegType || '—'}</div>
          <div className="aps-meta">{p.Registration || 'Not on the register'}</div>
        </div>
      </div>

      <div className="tab-strip" role="tablist" style={{ marginTop: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={'tab-strip-btn' + (tab === t.key ? ' is-active' : '')}
            onClick={() => setTab(t.key)}
          >
            <span>{t.label}</span>
            <span className="aps-badge aps-badge--na" style={{ marginLeft: 8 }}>{t.n}</span>
          </button>
        ))}
      </div>

      {/* --- IJD: weighted key result areas, mandate, reporting line --- */}
      {tab === 'ijd' && (
        <>
          <Card title="Mandate and reporting line">
            <p className="aps-note" style={{ margin: '0 0 8px' }}>{p.Mandate || '—'}</p>
            <div className="aps-meta">Reports to: {p.ReportsTo || '—'}</div>
            <div className="aps-meta">Registration the placement requires: {p.RegType || 'Not required for role'}</div>
          </Card>

          <Card
            title="Key result areas"
            note={`Weights total ${data.derived.kraWeightTotal}%`}
            flush
          >
            <Table columns={['Key result area', 'Duties', 'Weight']} isEmpty={data.kras.length === 0}>
              {data.kras.map((k) => (
                <tr key={k.Id}>
                  <td className="aps-td-strong">{k.Area}</td>
                  <td className="aps-note">{k.Duties}</td>
                  <td className="aps-td-mono aps-nowrap">{k.Weight}%</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      {/* --- KPA schedule: measures, weights, ratings --- */}
      {tab === 'kpa' && (
        <Card
          title="KPI & KPA schedule"
          note={`Weights total ${data.derived.measureWeightTotal}% · “Meets” is ${meets}`}
          flush
        >
          <Table
            columns={['Measure', 'How it is counted', 'Target', 'Weight', 'Rating']}
            isEmpty={data.measures.length === 0}
          >
            {data.measures.map((m) => {
              const short = m.Rating != null && Number(m.Rating) < meets;
              return (
                <tr key={m.Id} className={short ? 'perf-short' : undefined}>
                  <td className="aps-td-strong">{m.Area}</td>
                  <td className="aps-note">{m.Detail}</td>
                  <td className="aps-td-mono aps-nowrap">{m.Target || '—'}</td>
                  <td className="aps-td-mono aps-nowrap">{m.Weight}%</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <select
                        className="aps-select"
                        style={{ width: 'auto' }}
                        value={m.Rating ?? ''}
                        disabled={busy === m.Id}
                        onChange={(e) => rate(m, e.target.value)}
                        aria-label={`Rating for ${m.Area}`}
                      >
                        <option value="">Not rated</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n} — {data.ratingLabels[String(n)] || ''}
                          </option>
                        ))}
                      </select>
                      {short && <Badge kind="bad">Shortfall</Badge>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {/* --- EDP: goals derived from the shortfalls --- */}
      {tab === 'edp' && (
        <Card
          title="Employee development plan"
          note="Derived from the ratings — not entered by hand"
          flush
        >
          {data.goals.length === 0 ? (
            <div className="aps-table-empty">
              {data.derived.ratedCount === 0
                ? 'Rate the KPI & KPA schedule first — development goals come from the areas rated below “Meets”.'
                : 'No area is rated below “Meets”, so there is nothing to develop this cycle.'}
            </div>
          ) : (
            <Table columns={['Development goal', 'Arising from', 'Provider', 'Dates', 'Sign-off']}>
              {data.goals.map((g) => (
                <tr key={g.Id}>
                  <td className="aps-td-strong">{g.Goal}</td>
                  <td>
                    <div>{g.FromArea || '—'}</div>
                    {g.FromRating != null && (
                      <div className="aps-meta">
                        Rated {g.FromRating} — {data.ratingLabels[String(g.FromRating)] || ''}
                      </div>
                    )}
                  </td>
                  <td>{g.Provider || '—'}</td>
                  <td className="aps-td-mono aps-nowrap">
                    {shortDate(g.StartDate)} – {shortDate(g.EndDate)}
                  </td>
                  <td>
                    {g.SignedBy
                      ? <span className="aps-meta">{g.SignedBy} · {shortDate(g.SignedAt)}</span>
                      : <Badge kind="na">Not signed</Badge>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
