import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, PHASE_COLOR, useFsa } from './Ui.jsx';

const STATE_KIND = { done: 'ok', current: 'info', future: 'na' };
const STATE_LABEL = { done: 'Passed', current: 'In progress', future: 'Not started' };

export default function ProgrammePage() {
  const { code } = useParams();
  const { data, error, loading, reload } = useFsa(() => api.fsaProgramme(code), [code]);
  const [busyKey, setBusyKey] = useState(null);

  async function toggle(phase, item) {
    const key = String(item.ActivityId);
    setBusyKey(key);
    try {
      await api.fsaSetCheck(code, { activityId: item.ActivityId, done: !item.Done });
      reload();
    } catch (err) {
      // Surface it rather than silently dropping the sign-off.
      window.alert(err.message);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  const p = data.person;
  const behind = p.StatusKind === 'bad';

  return (
    <div className="aps-page">
      <PageHead
        crumb={`Onboarding · Individual progress · ${p.Dept}`}
        title={p.Name}
        sub={`${p.Role} · ${p.Site}`}
        actions={
          <Link to="/red-to-green" className="aps-btn aps-btn--ghost" style={{ textDecoration: 'none' }}>
            <i className="fas fa-arrow-left" /> Back to the tracker
          </Link>
        }
      />

      <div className="aps-two-col" style={{ marginBottom: 16 }}>
        <Card title="Programme">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14, marginBottom: 14 }}>
            {[
              ['Start date', String(p.StartDate || '').slice(0, 10)],
              ['Green mentor', p.Mentor],
              ['Day', p.DayLabel],
              ['Phase', p.PhaseLabel],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="aps-meta">{k}</div>
                <div style={{ fontSize: '0.82rem', color: '#374151' }}>{v || '—'}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
            {[[p.P1, 1], [p.P2, 2], [p.P3, 3]].map(([pct, ph]) => (
              <span key={ph} style={{ flex: 1, height: 10, background: '#f3f4f6', borderRadius: 2, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: PHASE_COLOR[ph] }} />
              </span>
            ))}
          </div>
          <div className="aps-meta">{p.Pct}% of the programme · activities signed off below</div>

          <hr className="aps-hair" />

          <div className={`aps-alert ${behind ? 'aps-alert--bad' : 'aps-alert--info'}`} style={{ boxShadow: 'none' }}>
            <Badge kind={behind ? 'bad' : 'info'}>{behind ? 'Finding' : 'On plan'}</Badge>
            <div className="aps-alert-title">
              {behind ? 'Two activities are open past their week' : 'No open activities past their week'}
            </div>
            <p className="aps-note" style={{ margin: 0 }}>
              {behind
                ? 'Sampling procedure and the compositional checklist are still open in week 2 while the programme is in week 4. The written test is booked for 2026-09-25. Either move the test or close the two activities with the green mentor this week.'
                : `The programme is running to plan. The next gate is ${String(p.Gate || '').toLowerCase()}.`}
            </p>
          </div>
        </Card>

        <div className="aps-stack">
          <Card title="Clearance to green">
            <p className="aps-note" style={{ margin: '0 0 12px' }}>
              A green inspector signs off every completed phase before independent operation in a
              region is granted. Clearance stays locked until both written gates are passed.
            </p>
            <div className="aps-stack" style={{ gap: 10 }}>
              {data.gates.map((g) => (
                <div key={g.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#111827' }}>{g.label}</div>
                    <div className="aps-meta">{g.value}</div>
                  </div>
                  <Badge kind={g.tag === 'Passed' || g.tag === 'Signed' ? 'ok' : g.tag === 'Locked' ? 'na' : 'info'}>
                    {g.tag}
                  </Badge>
                </div>
              ))}
            </div>
            <hr className="aps-hair" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="aps-btn aps-btn--primary" disabled title="Both written gates must pass first">
                Clear as green
              </button>
              <button className="aps-btn aps-btn--ghost">Extend phase</button>
            </div>
          </Card>

          <Card title="Manager notes">
            <div className="aps-stack" style={{ gap: 12 }}>
              {data.notes.length === 0 && <div className="aps-meta">No notes recorded yet.</div>}
              {data.notes.map((n, i) => (
                <div key={i}>
                  <div className="aps-meta">
                    <span className="aps-td-mono">{String(n.NoteDate).slice(0, 10)}</span> · {n.Author}
                  </div>
                  <p className="aps-note" style={{ margin: '3px 0 0' }}>{n.Body}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Phase checklists */}
      <div className="aps-stack">
        {data.phases.map((ph) => {
          const done = ph.items.filter((i) => i.Done).length;
          return (
            <Card
              key={ph.phase}
              title={ph.title}
              note={ph.phase === 0
                ? 'Before the programme starts'
                : `${ph.meta} · ${done} of ${ph.items.length} activities signed off`}
            >
              <span style={{
                display: 'block', width: 34, height: 6, marginBottom: 12,
                background: PHASE_COLOR[ph.phase], transform: 'skewX(-11deg)',
              }} />
              <div style={{ marginBottom: 12 }}>
                <Badge kind={STATE_KIND[ph.state]}>
                  {ph.phase === 0 && ph.state === 'done' ? 'Complete' : STATE_LABEL[ph.state]}
                </Badge>
              </div>

              <div className="aps-stack" style={{ gap: 10 }}>
                {ph.items.map((it) => {
                  const key = String(it.ActivityId);
                  return (
                    <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <button
                        onClick={() => toggle(ph.phase, it)}
                        disabled={busyKey === key}
                        title={it.Done ? 'Signed off — click to reopen' : 'Sign this activity off'}
                        style={{
                          width: 22, height: 22, flex: 'none', borderRadius: 4, cursor: 'pointer',
                          border: `1px solid ${it.Done ? '#059669' : '#c3c4c6'}`,
                          background: it.Done ? '#059669' : '#fff',
                          color: '#fff', fontSize: '0.7rem', fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                        }}
                      >
                        {it.Done ? '✓' : ''}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: '0.82rem', lineHeight: 1.5,
                          color: it.Done ? '#9ca3af' : '#1f2937',
                        }}>
                          {it.Body}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                          <span className="aps-meta">Week {it.Week} · {it.Owner}</span>
                          <Badge kind={it.IsMaster ? 'na' : 'info'}>
                            {it.IsMaster ? 'Group method' : p.Dept}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
