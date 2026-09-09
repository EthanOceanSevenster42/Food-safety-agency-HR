// Department method templates.
//
// The old version listed all 41 activities per department, of which 37 were
// locked group-standard rows repeating "Locked — group standard". The two or
// three things a department can actually change were buried in it.
//
// This leads with what is editable — the department's own activities, which can
// be added, reworded, moved between weeks, turned off or removed — and keeps
// the locked group method one click away per phase.
import { useCallback, useState } from 'react';
import { api } from '../api.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, PHASE_COLOR, useFsa } from './Ui.jsx';

const WEEKS = [1, 2, 3, 4, 5];

const EMPTY_DRAFT = { body: '', owner: 'Manager', week: 1 };

export default function TemplatesPage() {
  const [dept, setDept] = useState('APS');
  const load = useCallback(() => api.fsaTemplates(dept), [dept]);
  const { data, error, loading, reload } = useFsa(load, [dept]);

  const [showLocked, setShowLocked] = useState({});
  const [draftPhase, setDraftPhase] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editing, setEditing] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY_DRAFT);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      reload();
      return true;
    } catch (err) {
      setMsg(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addActivity(phase) {
    if (!draft.body.trim()) { setMsg('Describe the activity before adding it.'); return; }
    const ok = await run(() => api.fsaAddActivity({ dept, phase, ...draft }));
    if (ok) { setDraft(EMPTY_DRAFT); setDraftPhase(null); }
  }

  async function saveEdit(id) {
    const ok = await run(() => api.fsaUpdateActivity(id, editDraft));
    if (ok) setEditing(null);
  }

  const totals = data?.totals;

  return (
    <div className="aps-page">
      <PageHead
        crumb="Onboarding · Method templates"
        title="One method, adjusted per department"
        sub="Every department runs the same phases, durations, pass marks and sign-off. Each one adds the activities its own field of operations needs."
      />

      {/* What is locked, stated once instead of on every row. */}
      <div className="aps-stats">
        {(data?.locked || []).map((l) => (
          <div key={l.label} className="aps-stat">
            <div className="aps-stat-top">
              <span className="aps-stat-label">{l.label}</span>
              <div className="aps-stat-icon" style={{ background: '#f3f4f6' }}>
                <i className="fas fa-lock" style={{ color: '#9ca3af', fontSize: '0.8rem' }} />
              </div>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#374151', marginTop: 10, lineHeight: 1.45 }}>
              {l.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="aps-chip-row">
          {(data?.departments || []).map((d) => (
            <button
              key={d}
              className={'aps-chip' + (dept === d ? ' active' : '')}
              onClick={() => { setDept(d); setEditing(null); setDraftPhase(null); setMsg(''); }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className="aps-card" style={{ padding: '12px 16px', marginBottom: 12, borderLeft: '3px solid #dc2626' }}>
          <span className="aps-note">{msg}</span>
        </div>
      )}

      {loading && <Spinner />}
      {error && <ErrorNote error={error} onRetry={reload} />}

      {data && !loading && (
        <div className="aps-two-col">
          <div className="aps-stack">
            {/* One plain sentence in place of four counts scattered per phase. */}
            <Card title={`${dept} — what this department adds`}>
              <p className="aps-note" style={{ margin: 0 }}>
                <strong>{dept}</strong> adds{' '}
                <strong>{totals.ownActive} {totals.ownActive === 1 ? 'activity' : 'activities'}</strong>
                {totals.own !== totals.ownActive && ` (${totals.own - totals.ownActive} turned off)`}
                {' '}to the group method’s <strong>{totals.locked}</strong>, so a new starter here works
                through <strong>{totals.inChecklist}</strong> activities in total.
              </p>
              {totals.runningProgrammes > 0 && (
                <p className="aps-note" style={{ margin: '10px 0 0', color: '#6b7280' }}>
                  <i className="fas fa-circle-info" style={{ color: '#007890' }} />{' '}
                  {totals.runningProgrammes} {totals.runningProgrammes === 1 ? 'person is' : 'people are'} part-way
                  through this programme. They keep the checklist they started on — changes here apply to
                  new starters only.
                </p>
              )}
            </Card>

            {data.phases.map((ph) => {
              const lockedOpen = !!showLocked[ph.phase];
              return (
                <Card
                  key={ph.phase}
                  title={ph.title}
                  note={ph.ownCount === 0
                    ? 'Group method only'
                    : `${ph.ownActive} of ${ph.ownCount} department ${ph.ownCount === 1 ? 'activity' : 'activities'} on`}
                >
                  <span style={{
                    display: 'block', width: 34, height: 6, marginBottom: 14,
                    background: PHASE_COLOR[ph.phase], transform: 'skewX(-11deg)',
                  }} />

                  {/* The department's own activities — the editable part. */}
                  {ph.own.length === 0 && (
                    <div className="aps-note" style={{ marginBottom: 12 }}>
                      {dept} adds nothing to this phase yet.
                    </div>
                  )}

                  <div className="aps-stack" style={{ gap: 8 }}>
                    {ph.own.map((it) => (
                      editing === it.Id ? (
                        <div key={it.Id} style={{ border: '1px solid #007890', borderRadius: 8, padding: 12, background: '#f8feff' }}>
                          <div className="aps-field">
                            <label className="aps-label">Activity</label>
                            <input
                              className="aps-input"
                              value={editDraft.body}
                              autoFocus
                              onChange={(e) => setEditDraft((d) => ({ ...d, body: e.target.value }))}
                            />
                          </div>
                          <div className="aps-field-row">
                            <div className="aps-field">
                              <label className="aps-label">Week</label>
                              <select
                                className="aps-select"
                                value={editDraft.week}
                                onChange={(e) => setEditDraft((d) => ({ ...d, week: Number(e.target.value) }))}
                              >
                                {WEEKS.map((w) => <option key={w} value={w}>Week {w}</option>)}
                              </select>
                            </div>
                            <div className="aps-field">
                              <label className="aps-label">Signed off by</label>
                              <select
                                className="aps-select"
                                value={editDraft.owner}
                                onChange={(e) => setEditDraft((d) => ({ ...d, owner: e.target.value }))}
                              >
                                {data.owners.map((o) => <option key={o}>{o}</option>)}
                              </select>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="aps-btn aps-btn--primary" disabled={busy} onClick={() => saveEdit(it.Id)}>
                              Save
                            </button>
                            <button className="aps-btn aps-btn--ghost" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          key={it.Id}
                          style={{
                            display: 'flex', gap: 10, alignItems: 'flex-start',
                            border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px',
                            opacity: it.Enabled ? 1 : 0.6,
                          }}
                        >
                          <button
                            onClick={() => run(() => api.fsaUpdateActivity(it.Id, { enabled: !it.Enabled }))}
                            disabled={busy}
                            title={it.Enabled ? 'On for new starters — click to turn off' : 'Off — click to turn on'}
                            style={{
                              width: 22, height: 22, flex: 'none', borderRadius: 4, cursor: 'pointer',
                              border: `1px solid ${it.Enabled ? '#007890' : '#c3c4c6'}`,
                              background: it.Enabled ? '#007890' : '#fff',
                              color: '#fff', fontSize: '0.7rem', fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                            }}
                          >
                            {it.Enabled ? '✓' : ''}
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: '0.82rem', lineHeight: 1.5, color: it.Enabled ? '#1f2937' : '#9ca3af',
                              textDecoration: it.Enabled ? 'none' : 'line-through',
                            }}>
                              {it.Body}
                            </div>
                            <div className="aps-meta">Week {it.Week} · {it.Owner}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                            <button
                              className="aps-btn aps-btn--ghost"
                              style={{ padding: '4px 8px' }}
                              title="Edit"
                              onClick={() => { setEditing(it.Id); setEditDraft({ body: it.Body, owner: it.Owner, week: it.Week }); }}
                            >
                              <i className="fas fa-pen" style={{ fontSize: '0.65rem' }} />
                            </button>
                            <button
                              className="aps-btn aps-btn--danger"
                              style={{ padding: '4px 8px' }}
                              title="Remove"
                              disabled={busy}
                              onClick={() => run(() => api.fsaRemoveActivity(it.Id))}
                            >
                              <i className="fas fa-trash" style={{ fontSize: '0.65rem' }} />
                            </button>
                          </div>
                        </div>
                      )
                    ))}
                  </div>

                  {/* Add */}
                  {draftPhase === ph.phase ? (
                    <div style={{ border: '1px dashed #007890', borderRadius: 8, padding: 12, marginTop: 10 }}>
                      <div className="aps-field">
                        <label className="aps-label">New activity for {dept}</label>
                        <input
                          className="aps-input"
                          autoFocus
                          placeholder="e.g. Cooler-box handling and sample integrity"
                          value={draft.body}
                          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && addActivity(ph.phase)}
                        />
                      </div>
                      <div className="aps-field-row">
                        <div className="aps-field">
                          <label className="aps-label">Week</label>
                          <select
                            className="aps-select"
                            value={draft.week}
                            onChange={(e) => setDraft((d) => ({ ...d, week: Number(e.target.value) }))}
                          >
                            {WEEKS.map((w) => <option key={w} value={w}>Week {w}</option>)}
                          </select>
                        </div>
                        <div className="aps-field">
                          <label className="aps-label">Signed off by</label>
                          <select
                            className="aps-select"
                            value={draft.owner}
                            onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))}
                          >
                            {data.owners.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="aps-btn aps-btn--primary" disabled={busy} onClick={() => addActivity(ph.phase)}>
                          <i className="fas fa-plus" /> Add
                        </button>
                        <button className="aps-btn aps-btn--ghost" onClick={() => { setDraftPhase(null); setDraft(EMPTY_DRAFT); }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="aps-btn aps-btn--ghost"
                      style={{ marginTop: 10 }}
                      onClick={() => { setDraftPhase(ph.phase); setDraft(EMPTY_DRAFT); setEditing(null); }}
                    >
                      <i className="fas fa-plus" /> Add an activity
                    </button>
                  )}

                  {/* The locked group method — present, but not shouting. */}
                  <hr className="aps-hair" />
                  <button
                    className="aps-btn aps-btn--ghost"
                    style={{ width: '100%' }}
                    onClick={() => setShowLocked((s) => ({ ...s, [ph.phase]: !s[ph.phase] }))}
                  >
                    <i className={`fas fa-chevron-${lockedOpen ? 'up' : 'down'}`} />
                    {lockedOpen ? 'Hide' : 'Show'} the {ph.lockedCount} locked group activities
                  </button>

                  {lockedOpen && (
                    <div className="aps-stack" style={{ gap: 7, marginTop: 12 }}>
                      {ph.locked.map((it) => (
                        <div key={it.Id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                          <i className="fas fa-lock" style={{ color: '#c3c4c6', fontSize: '0.62rem', marginTop: 4, flex: 'none' }} />
                          <div>
                            <div style={{ fontSize: '0.8rem', lineHeight: 1.5, color: '#6b7280' }}>{it.Body}</div>
                            <div className="aps-meta">Week {it.Week} · {it.Owner}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <TargetsCard dept={dept} targets={data.targets} onChanged={reload} />
        </div>
      )}
    </div>
  );
}

// Phase 3 volume targets — the one part of the method a department sets, so
// they are editable here rather than read-only.
function TargetsCard({ dept, targets, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', value: '' });
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      onChanged();
      return true;
    } catch (err) {
      setMsg(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aps-stack">
      <Card title="Phase 3 targets" note={dept}>
        <p className="aps-note" style={{ margin: '0 0 14px' }}>
          Volume targets are the one part of the method each department sets for itself, because the
          work is not comparable across fields of operation.
        </p>

        {msg && <div className="aps-note" style={{ color: '#dc2626', marginBottom: 10 }}>{msg}</div>}

        {targets.length === 0 && <div className="aps-meta">No targets set for {dept} yet.</div>}

        <div className="aps-stack" style={{ gap: 9 }}>
          {targets.map((t) => (
            <div key={t.Id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="aps-note" style={{ flex: 1, minWidth: 0 }}>{t.Label}</span>
              {editing === t.Id ? (
                <>
                  <input
                    className="aps-input"
                    style={{ width: 64, textAlign: 'right' }}
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') run(() => api.fsaUpdateTarget(t.Id, { value: editValue })).then((ok) => ok && setEditing(null));
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <button
                    className="aps-btn aps-btn--primary"
                    style={{ padding: '4px 8px' }}
                    disabled={busy}
                    onClick={() => run(() => api.fsaUpdateTarget(t.Id, { value: editValue })).then((ok) => ok && setEditing(null))}
                  >
                    <i className="fas fa-check" style={{ fontSize: '0.65rem' }} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setEditing(t.Id); setEditValue(t.Value); }}
                    title="Change this target"
                    style={{
                      border: 'none', background: 'none', cursor: 'pointer', padding: 0,
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      fontWeight: 700, color: '#007890', fontSize: '0.95rem',
                    }}
                  >
                    {t.Value}
                  </button>
                  <button
                    className="aps-btn aps-btn--danger"
                    style={{ padding: '4px 7px' }}
                    title="Remove"
                    disabled={busy}
                    onClick={() => run(() => api.fsaRemoveTarget(t.Id))}
                  >
                    <i className="fas fa-trash" style={{ fontSize: '0.6rem' }} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <hr className="aps-hair" />

        {adding ? (
          <div>
            <div className="aps-field">
              <label className="aps-label">Target</label>
              <input
                className="aps-input"
                autoFocus
                placeholder="e.g. Cold stores inspected"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              />
            </div>
            <div className="aps-field">
              <label className="aps-label">Number</label>
              <input
                className="aps-input"
                placeholder="e.g. 10"
                value={draft.value}
                onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="aps-btn aps-btn--primary"
                disabled={busy}
                onClick={() => run(() => api.fsaAddTarget({ dept, ...draft }))
                  .then((ok) => { if (ok) { setDraft({ label: '', value: '' }); setAdding(false); } })}
              >
                <i className="fas fa-plus" /> Add target
              </button>
              <button className="aps-btn aps-btn--ghost" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="aps-btn aps-btn--ghost" style={{ width: '100%' }} onClick={() => setAdding(true)}>
            <i className="fas fa-plus" /> Add a target
          </button>
        )}
      </Card>

      <Card title="When changes take effect">
        <p className="aps-note" style={{ margin: 0 }}>
          Edits here apply to <strong>new starters</strong> from the moment you make them. Anyone
          already part-way through keeps the checklist they started on, so a sign-off never moves to a
          different activity.
        </p>
        <p className="aps-note" style={{ margin: '10px 0 0', color: '#6b7280' }}>
          The phases, durations, pass marks and sign-off above are set for the whole agency and cannot
          be changed per department.
        </p>
      </Card>
    </div>
  );
}
