import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import AttentionPill from './AttentionPill.jsx';
import { api } from '../api.js';

// Read-only viewer for a single saved EDP version. Mirrors the editor's
// card layout — description, then each EDP block with its WIG + lead
// measures — but as plain text.
export default function EdpVersionViewModal({ processId, versionId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    api.getEdpVersion(processId, versionId)
      .then((res) => { if (!cancelled) setSnapshot(res); })
      .catch((e)   => { if (!cancelled) setErr(e.message); })
      .finally(()  => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [processId, versionId]);

  const d = snapshot?.data || {};
  const edps = Array.isArray(d.edps) ? d.edps : [];

  return (
    <Modal
      title={snapshot ? `EDP Alignment — V${snapshot.version}` : 'EDP version'}
      onClose={onClose}
    >
      {loading ? (
        <div className="muted">Loading…</div>
      ) : err ? (
        <div className="error">{err}</div>
      ) : snapshot ? (
        <div className="edp-version-view">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Saved {formatWhen(snapshot.createdAt)}
            {snapshot.createdBy && <> by {snapshot.createdBy}</>}
          </div>

          {d.description && (
            <>
              <div className="modal-section-title jd-section-head">
                <span>Description</span>
                <AttentionPill status={d.sectionStatus?.description} editable={false} />
              </div>
              <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 12px' }}>{d.description}</p>
            </>
          )}

          <div className="modal-section-title">EDPs</div>
          {edps.length === 0 ? (
            <div className="muted">No EDPs recorded in this version.</div>
          ) : (
            <div className="edp-list">
              {edps.map((edp, idx) => {
                // Promote legacy { wig, leadMeasures } shape into a
                // single-element wigs array so the renderer stays simple.
                const wigs = Array.isArray(edp.wigs) && edp.wigs.length
                  ? edp.wigs
                  : [{ text: edp.wig || '', leadMeasures: Array.isArray(edp.leadMeasures) ? edp.leadMeasures : [] }];
                return (
                  <div key={idx} className="edp-card">
                    <div className="edp-card-head edp-card-head-readonly">
                      <span className="edp-card-num">EDP {idx + 1}</span>
                      <div className="edp-version-header">{edp.header || <span className="muted">—</span>}</div>
                      <AttentionPill status={edp.status} editable={false} />
                    </div>
                    <div className="edp-wigs">
                      <div className="edp-sublabel">WIGs</div>
                      {wigs.map((wig, wi) => (
                        <div key={wi} className="edp-wig-card">
                          <div className="edp-wig-head edp-wig-head-readonly">
                            <span className="edp-wig-num">WIG {wi + 1}</span>
                            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{wig.text || <span className="muted">—</span>}</p>
                          </div>
                          <div className="edp-leads">
                            <div className="edp-sublabel">Lead Measures</div>
                            {Array.isArray(wig.leadMeasures) && wig.leadMeasures.filter(Boolean).length > 0 ? (
                              <ul className="jd-version-list">
                                {wig.leadMeasures.filter(Boolean).map((m, mi) => <li key={mi}>{m}</li>)}
                              </ul>
                            ) : <span className="muted">—</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(',', ' ·');
}
