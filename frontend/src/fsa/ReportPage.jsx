import { useState } from 'react';
import { api } from '../api.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, useFsa } from './Ui.jsx';

// Handoff §5.3. This screen is a document, not a dashboard: it is tabled at the
// directors' meeting and printed. The only interaction is ticking a next-step
// commitment, which is done live in the meeting.

const STATUS = {
  ok: { kind: 'ok', label: 'On target' },
  observation: { kind: 'warn', label: 'Observation' },
  finding: { kind: 'bad', label: 'Finding' },
};

// Evidence class carries meaning, so the left border colour is the class.
const EVIDENCE = {
  Finding: { cls: 'aps-alert--bad', kind: 'bad' },
  Observation: { cls: 'aps-alert--warn', kind: 'warn' },
  Recommendation: { cls: 'aps-alert--info', kind: 'info' },
  Note: { cls: 'aps-alert--na', kind: 'na' },
};

const PRIOR_STATE = {
  done: { kind: 'ok', label: 'Done' },
  'in progress': { kind: 'warn', label: 'In progress' },
  'not started': { kind: 'bad', label: 'Not started' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ISO in technical contexts, long-form in prose (§3). Dates in these tables sit
// next to references and owners, so they stay short and unambiguous.
function shortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return '—';
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function SectionHead({ n, title, note }) {
  return (
    <div className="aps-section-head">
      <h2>{n}. {title}</h2>
      {note && <span className="aps-section-note">{note}</span>}
    </div>
  );
}

// Every table states where its figures came from (§5.3).
function Source({ note }) {
  return note ? <p className="report-source">{note}</p> : null;
}

export default function ReportPage() {
  const [period, setPeriod] = useState('');
  const { data, error, loading, reload } = useFsa(() => api.fsaReport(period), [period]);
  const [busyId, setBusyId] = useState(null);
  const [tickError, setTickError] = useState('');

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  const r = data.report;
  const s = data.summary;

  async function toggle(action) {
    setBusyId(action.Id);
    setTickError('');
    try {
      await api.fsaTickCommitment(action.Id, !action.Ticked);
      reload();
    } catch (err) {
      setTickError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="aps-page report-page">
      <PageHead
        crumb="Overview · Management view"
        title="Monthly management report"
        sub={`For the period ${r.PeriodLabel}. Tabled at the directors' meeting; commitments are ticked in the meeting.`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {data.periods.length > 1 && (
              <select
                className="aps-select"
                style={{ width: 'auto' }}
                value={period || r.Period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                {data.periods.map((p) => (
                  <option key={p.Period} value={p.Period}>{p.PeriodLabel}</option>
                ))}
              </select>
            )}
            <button className="aps-btn aps-btn--primary" onClick={() => window.print()}>
              <i className="fas fa-print" /> Print
            </button>
          </div>
        }
      />

      {/* 1. Position statement — one paragraph, outcome first. */}
      <SectionHead n="1" title="Position statement" />
      <div className="aps-decision" style={{ marginBottom: 8 }}>
        <p className="report-position">{r.PositionStatement}</p>
      </div>
      <Source note={r.SourceNote} />

      {/* 2. Indicators — actual against target, with a status class. */}
      <SectionHead
        n="2"
        title="Indicators"
        note={`${s.onTarget} on target · ${s.observations} observations · ${s.findingsCount} findings`}
      />
      <Card flush>
        <div className="aps-table-wrap">
          <table className="aps-table aps-table--dense">
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Actual</th>
                <th>Target</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {data.indicators.map((i) => {
                const st = STATUS[i.StatusKind] || STATUS.observation;
                return (
                  <tr key={i.Name}>
                    <td className="aps-td-strong">{i.Name}</td>
                    <td className="aps-td-mono">{i.Actual}</td>
                    <td className="aps-td-mono" style={{ color: '#6b7280' }}>{i.Target}</td>
                    <td><Badge kind={st.kind}>{st.label}</Badge></td>
                    <td className="aps-note">{i.Note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Source note={r.SourceNote} />

      {/* 3. Findings and recommendations — evidence, then corrective action. */}
      <SectionHead n="3" title="Findings and recommendations" note={`${data.findings.length} raised`} />
      <div className="aps-stack">
        {data.findings.map((f) => {
          const ev = EVIDENCE[f.Kind] || EVIDENCE.Note;
          return (
            <div key={f.Ref} className={`aps-alert ${ev.cls}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Badge kind={ev.kind}>{f.Kind}</Badge>
                <span className="aps-alert-ref aps-td-mono">{f.Ref}</span>
              </div>
              <div className="aps-alert-title">{f.Title}</div>
              <p className="aps-note" style={{ margin: '0 0 8px' }}>{f.Evidence}</p>
              {f.CorrectiveAction && (
                <div className="report-corrective">
                  <span className="report-corrective-label">Corrective action</span>
                  <p className="aps-note" style={{ margin: '2px 0 0' }}>{f.CorrectiveAction}</p>
                </div>
              )}
              <div className="aps-alert-foot" style={{ marginTop: 8 }}>
                <span className="aps-meta">Owner: {f.Owner || '—'}</span>
                <span className="aps-meta">Due {shortDate(f.DueDate)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. Progress on prior actions. */}
      <SectionHead n="4" title="Progress on prior actions" note="Committed to last month" />
      <Card flush>
        <div className="aps-table-wrap">
          <table className="aps-table aps-table--dense">
            <thead>
              <tr>
                <th>Action</th>
                <th>Owner</th>
                <th>Due</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {data.priorActions.map((a) => {
                const st = PRIOR_STATE[a.State] || { kind: 'na', label: a.State || '—' };
                return (
                  <tr key={a.Id}>
                    <td>{a.Body}</td>
                    <td className="aps-nowrap">{a.Owner || '—'}</td>
                    <td className="aps-td-mono aps-nowrap">{shortDate(a.DueDate)}</td>
                    <td><Badge kind={st.kind}>{st.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 5. Next-step commitments — the one interactive part of the screen. */}
      <SectionHead
        n="5"
        title="Next-step commitments"
        note={`${s.commitmentsTicked} of ${s.commitmentsTotal} agreed in the meeting`}
      />
      {tickError && <div className="aps-alert aps-alert--bad" style={{ marginBottom: 10 }}>{tickError}</div>}
      <Card flush>
        <div className="aps-table-wrap">
          <table className="aps-table aps-table--dense">
            <thead>
              <tr>
                <th style={{ width: 44 }}>Agreed</th>
                <th>Commitment</th>
                <th>Owner</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {data.commitments.map((a) => (
                <tr key={a.Id} className={a.Ticked ? 'report-ticked' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      className="report-tick"
                      checked={Boolean(a.Ticked)}
                      disabled={busyId === a.Id}
                      onChange={() => toggle(a)}
                      aria-label={`Agree: ${a.Body}`}
                    />
                  </td>
                  <td>
                    {a.Body}
                    {a.Ticked && a.TickedBy && (
                      <div className="aps-meta">Agreed by {a.TickedBy}</div>
                    )}
                  </td>
                  <td className="aps-nowrap">{a.Owner || '—'}</td>
                  <td className="aps-td-mono aps-nowrap">{shortDate(a.DueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 6. Decisions requested — phrased as a decision the directors can take. */}
      <SectionHead n="6" title="Decisions requested" note={`${data.decisions.length} for this meeting`} />
      <div className="aps-two-col">
        {data.decisions.map((d) => (
          <div key={d.Title} className="aps-decision" style={{ marginBottom: 0 }}>
            <div className="aps-decision-label">Decision requested</div>
            <p className="aps-decision-ask">{d.Title}</p>
            <p className="aps-note" style={{ margin: 0 }}>{d.Body}</p>
          </div>
        ))}
      </div>

      {/* 7. Sign-off lines. */}
      <SectionHead n="7" title="Sign-off" />
      <Card>
        <div className="report-signoff">
          {[
            ['Compiled by', r.CompiledBy, r.CompiledAt],
            ['Reviewed by', r.ReviewedBy, r.ReviewedAt],
            ['Accepted by', r.AcceptedBy, r.AcceptedAt],
          ].map(([label, who, when]) => (
            <div key={label} className="report-signoff-line">
              <span className="report-signoff-label">{label}</span>
              <span className="report-signoff-rule">{who || ''}</span>
              <span className="report-signoff-date aps-td-mono">
                {when ? String(when).slice(0, 10) : ''}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <footer className="aps-page-foot">
        <span className="aps-page-foot-name">Food Safety Agency (Pty) Ltd</span>
        <span>Monthly management report · {r.PeriodLabel}</span>
        <span className="aps-page-foot-mark">Internal use only</span>
      </footer>
    </div>
  );
}
