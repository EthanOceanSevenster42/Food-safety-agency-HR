import { useState } from 'react';
import { api } from '../api.js';
import { Badge, Card, PageHead, Spinner, ErrorNote, useFsa } from './Ui.jsx';

export default function RecruitmentPage() {
  const { data, error, loading, reload } = useFsa(() => api.fsaPipeline());
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [msg, setMsg] = useState('');

  async function drop(stageIndex) {
    setOverStage(null);
    const id = dragId;
    setDragId(null);
    if (id == null) return;
    try {
      await api.fsaMoveCandidate(id, stageIndex);
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  }

  if (loading) return <div className="aps-page"><Spinner /></div>;
  if (error) return <div className="aps-page"><ErrorNote error={error} onRetry={reload} /></div>;

  const total = data.stages.reduce((n, s) => n + s.cards.length, 0);

  return (
    <div className="aps-page">
      <PageHead
        crumb="People"
        title="Recruitment pipeline"
        sub={`${total} open roles, all tied to a site and a service. A candidate cannot reach onboarding without a verified registration or a training plan to obtain one.`}
      />

      <Card
        title="Pipeline"
        note="Drag a card between stages to move a candidate. Moves are recorded against the requisition."
      >
        {msg && <div className="aps-note" style={{ color: '#dc2626', marginBottom: 10 }}>{msg}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.stages.length}, minmax(190px, 1fr))`, gap: 12, overflowX: 'auto' }}>
          {data.stages.map((stage, si) => (
            <div
              key={stage.label}
              onDragOver={(e) => { e.preventDefault(); if (overStage !== si) setOverStage(si); }}
              onDragLeave={() => { if (overStage === si) setOverStage(null); }}
              onDrop={(e) => { e.preventDefault(); drop(si); }}
              style={{
                display: 'flex', flexDirection: 'column', gap: 10, padding: 8, minHeight: 140,
                borderRadius: 8,
                background: overStage === si && dragId != null ? '#e0f2f5' : 'transparent',
                outline: overStage === si && dragId != null ? '2px solid #007890' : 'none',
                outlineOffset: -2,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280' }}>
                  {stage.label}
                </span>
                <span className="aps-meta">{stage.cards.length}</span>
              </div>

              {stage.cards.length === 0 && (
                <div className="aps-meta" style={{ border: '1px dashed #e5e7eb', borderRadius: 8, padding: 14, textAlign: 'center' }}>
                  Drop a candidate here
                </div>
              )}

              {stage.cards.map((c) => (
                <div
                  key={c.Id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(c.Id);
                    try { e.dataTransfer.setData('text/plain', String(c.Id)); e.dataTransfer.effectAllowed = 'move'; } catch { /* older browsers */ }
                  }}
                  onDragEnd={() => { setDragId(null); setOverStage(null); }}
                  style={{
                    background: '#fff',
                    border: `1px solid ${dragId === c.Id ? '#007890' : '#e5e7eb'}`,
                    borderTop: '3px solid #007890',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex', flexDirection: 'column', gap: 6,
                    cursor: 'grab',
                    opacity: dragId === c.Id ? 0.5 : 1,
                  }}
                >
                  <div className="aps-td-strong" style={{ fontSize: '0.82rem' }}>{c.Role}</div>
                  <div className="aps-meta">{c.Site}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Badge kind={c.TagKind}>{c.Tag}</Badge>
                    <span className="aps-meta aps-td-mono">{c.Ref}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
