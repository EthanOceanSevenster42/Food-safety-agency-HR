import { useState } from 'react';
import { api } from '../api.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, useFsa } from './Ui.jsx';

const STAGE_KIND = { 1: 'na', 2: 'warn', 3: 'info', 4: 'ok' };

const PACK = [
  ['PackIjd', 'packIjd', 'Inspector job description (IJD)', 'Duties, mandate, reporting line and the registration the placement requires.'],
  ['PackKpi', 'packKpi', 'KPI and KPA schedule', 'Measurable targets — facilities per day, sampling volumes, reporting deadlines.'],
  ['PackEdp', 'packEdp', 'Employee development plan (EDP)', 'The Red to Green route for this role, with the department template that applies.'],
];

const EMPTY = {
  role: '', dept: 'APS', site: '', contract: 'Permanent',
  posts: '1', targetStart: '', reason: 'New post — growth', motivation: '',
};

export default function RequisitionsPage() {
  const { data, error, loading, reload } = useFsa(() => api.fsaRequisitions());
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [openRef, setOpenRef] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const r = await api.fsaCreateRequisition(form);
      setForm({ ...EMPTY, dept: form.dept });
      setMsg(r.message);
      reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function togglePack(req, field) {
    try {
      await api.fsaUpdateRequisition(req.Id, { [field]: !req[PACK.find((p) => p[1] === field)[0]] });
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function advance(req) {
    try {
      await api.fsaUpdateRequisition(req.Id, { stage: Math.min(4, req.Stage + 1) });
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  }

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  return (
    <div className="aps-page">
      <PageHead
        crumb="People · Role requisitions"
        title="From a request to a live vacancy"
        sub="A manager requests the role. HR develops the employee pack — inspector job description, KPI and KPA schedule, employee development plan. Marketing publishes it. Once published the requisition moves into the recruitment pipeline and its applicants count towards its own buckets."
      />

      {/* The four fixed stages */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        {data.method.map((m) => (
          <div key={m.n} className="aps-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', background: '#007890', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 700, flex: 'none',
              }}>{m.n}</span>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#111827' }}>{m.title}</div>
            </div>
            <div className="aps-meta" style={{ marginBottom: 6 }}>{m.owner}</div>
            <p className="aps-note" style={{ margin: '0 0 10px' }}>{m.body}</p>
            <Badge kind="info">{m.count}</Badge>
          </div>
        ))}
      </div>

      <div className="aps-two-col">
        <Card title="Open requisitions" note={`${data.rows.length} in the register`}>
          <div className="aps-stack">
            {data.rows.map((r) => {
              const open = openRef === r.Ref;
              return (
                <div key={r.Ref} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div className="aps-td-strong" style={{ fontSize: '0.9rem' }}>{r.Role}</div>
                      <div className="aps-meta">{r.Dept} · {r.Site}</div>
                    </div>
                    <Badge kind={STAGE_KIND[r.Stage]}>{r.StageLabel}</Badge>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, margin: '12px 0' }}>
                    {[
                      ['Reference', r.Ref],
                      ['Requested by', r.RequestedBy || '—'],
                      ['Target start', r.TargetStart || '—'],
                      ['Contract', `${r.Contract} · ${r.Posts} post${r.Posts === '1' ? '' : 's'}`],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div className="aps-meta">{k}</div>
                        <div style={{ fontSize: '0.8rem', color: '#374151' }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="aps-meta" style={{ marginBottom: 10 }}>Reason — {r.Reason}</div>

                  <button
                    className="aps-btn aps-btn--ghost"
                    onClick={() => setOpenRef(open ? null : r.Ref)}
                  >
                    <i className={`fas fa-chevron-${open ? 'up' : 'down'}`} />
                    Employee pack — HR
                  </button>

                  {open && (
                    <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                      {PACK.map(([col, field, title, body]) => (
                        <label
                          key={field}
                          style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            checked={!!r[col]}
                            onChange={() => togglePack(r, field)}
                            style={{ marginTop: 3, accentColor: '#007890', width: 16, height: 16 }}
                          />
                          <span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#111827' }}>{title}</span>
                            <span className="aps-note" style={{ display: 'block' }}>{body}</span>
                          </span>
                        </label>
                      ))}

                      {r.Blocked ? (
                        <div className="aps-note" style={{ color: '#b45309' }}>
                          <i className="fas fa-triangle-exclamation" />{' '}
                          All three pack documents must be complete before marketing publishes.
                        </div>
                      ) : r.Stage < 4 ? (
                        <button className="aps-btn aps-btn--primary" onClick={() => advance(r)}>
                          Advance to {['', 'employee pack', 'marketing', 'the pipeline', ''][r.Stage]}
                        </button>
                      ) : (
                        <div className="aps-note" style={{ color: '#059669' }}>
                          <i className="fas fa-circle-check" /> Published by marketing — live in the pipeline.
                        </div>
                      )}

                      <div>
                        <div className="aps-meta" style={{ marginBottom: 6 }}>Published on</div>
                        <div className="aps-chip-row">
                          {data.channels.map((c) => <span key={c} className="aps-badge aps-badge--info">{c}</span>)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Request a role">
          <form onSubmit={submit}>
            <div className="aps-field">
              <label className="aps-label">Role title</label>
              <input className="aps-input" value={form.role} onChange={set('role')} placeholder="e.g. Meat inspector" />
            </div>
            <div className="aps-field-row">
              <div className="aps-field">
                <label className="aps-label">Department</label>
                <select className="aps-select" value={form.dept} onChange={set('dept')}>
                  {data.departments.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="aps-field">
                <label className="aps-label">Contract</label>
                <select className="aps-select" value={form.contract} onChange={set('contract')}>
                  {data.contracts.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="aps-field">
              <label className="aps-label">Site or region</label>
              <input className="aps-input" value={form.site} onChange={set('site')} placeholder="e.g. Rustenburg abattoir" />
            </div>
            <div className="aps-field-row">
              <div className="aps-field">
                <label className="aps-label">Posts</label>
                <input className="aps-input" value={form.posts} onChange={set('posts')} />
              </div>
              <div className="aps-field">
                <label className="aps-label">Target start</label>
                <input className="aps-input" type="date" value={form.targetStart} onChange={set('targetStart')} />
              </div>
            </div>
            <div className="aps-field">
              <label className="aps-label">Reason for the request</label>
              <select className="aps-select" value={form.reason} onChange={set('reason')}>
                {data.reasons.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="aps-field">
              <label className="aps-label">Motivation</label>
              <textarea className="aps-textarea" rows={3} value={form.motivation} onChange={set('motivation')} />
            </div>

            <button className="aps-btn aps-btn--primary" disabled={busy} style={{ width: '100%' }}>
              <i className="fas fa-paper-plane" /> {busy ? 'Sending…' : 'Send to HR'}
            </button>
            <div className="aps-meta" style={{ marginTop: 8 }}>
              {msg || 'HR receives the request the same working day.'}
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
