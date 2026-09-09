import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

// Read-only viewer for a single saved KPA version. Renders the snapshotted
// employee + KPA cards exactly as the editor showed them at save time —
// but with no inputs, no save button, no reordering.
export default function KpaVersionViewModal({ processId, versionId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    api.getKpaVersion(processId, versionId)
      .then((res) => { if (!cancelled) setSnapshot(res); })
      .catch((e)   => { if (!cancelled) setErr(e.message); })
      .finally(()  => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [processId, versionId]);

  const total = (snapshot?.kpas || []).reduce((s, r) => {
    const n = Number(r.weight);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <Modal
      title={snapshot ? `KPA — V${snapshot.version}` : 'KPA version'}
      onClose={onClose}
    >
      {loading ? (
        <div className="muted">Loading…</div>
      ) : err ? (
        <div className="error">{err}</div>
      ) : snapshot ? (
        <div className="kpa-version-view">
          <div className="muted small kpa-version-meta">
            {snapshot.employeeName ? <><strong>{snapshot.employeeName}</strong> · </> : null}
            Saved {formatWhen(snapshot.createdAt)}
            {snapshot.createdBy && <> by {snapshot.createdBy}</>}
          </div>

          <div className="kpa-cards kpa-cards-readonly">
            {(snapshot.kpas || []).length === 0 && (
              <div className="muted">No KPAs recorded in this version.</div>
            )}
            {(snapshot.kpas || []).map((r, idx) => (
              <div key={idx} className="kpa-card">
                <div className="kpa-card-head kpa-card-head-readonly">
                  <div className="kpa-readonly-weight">{Number(r.weight || 0).toFixed(2)}%</div>
                  <div className="kpa-readonly-area">{r.name || (r.department || '—')}</div>
                  <div className="kpa-cv">
                    <span className="kpa-cv-label">Core values</span>
                    <div className="kpa-cv-chips">
                      {(r.coreValues || []).length === 0
                        ? <span className="muted small">—</span>
                        : (r.coreValues || []).map((cv) => (
                            <span key={cv} className="kpa-cv-chip is-on" aria-pressed="true">{cv}</span>
                          ))
                      }
                    </div>
                  </div>
                </div>

                <div className="kpa-kpis">
                  <div className="kpa-kpis-label">KPIs</div>
                  {(r.kpis || []).length === 0 && (
                    <div className="muted small">No KPIs recorded.</div>
                  )}
                  {(r.kpis || []).map((kk, kIdx) => (
                    <div key={kIdx} className="kpa-kpi">
                      <div className="kpa-kpi-head kpa-kpi-head-readonly">
                        <span className="kpa-kpi-num">{kIdx + 1}.</span>
                        <div className="kpa-readonly-kpi">{kk.description || <span className="muted">—</span>}</div>
                      </div>
                      <div className="kpa-measures">
                        <label className="kpa-measures-label">How we measure</label>
                        {(kk.measures || []).length === 0 ? (
                          <div className="muted small" style={{ paddingLeft: 4 }}>—</div>
                        ) : (
                          <ul className="kpa-readonly-measures">
                            {kk.measures.map((m, mIdx) => (
                              <li key={mIdx}>{m}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="kpa-total kpa-total-ok">
            <span className="muted">Total weight at save</span>
            <strong>{total.toFixed(2)}%</strong>
          </div>
        </div>
      ) : null}

      <div className="modal-actions">
        <button type="button" className="btn-primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', ' ·');
}
