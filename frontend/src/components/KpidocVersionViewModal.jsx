import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

// Read-only viewer for one saved KPI Document version. Shows the header
// fields + a snapshot table of the editable review rows (static columns
// aren't stored on the version — only what the reviewer typed in).
export default function KpidocVersionViewModal({ processId, versionId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    api.getKpidocVersion(processId, versionId)
      .then((res) => { if (!cancelled) setSnapshot(res); })
      .catch((e)   => { if (!cancelled) setErr(e.message); })
      .finally(()  => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [processId, versionId]);

  const d = snapshot?.data || {};
  const rows = Array.isArray(d.rowsReview) ? d.rowsReview : [];

  return (
    <Modal
      title={snapshot ? `KPI Document — V${snapshot.version}` : 'KPI Document version'}
      onClose={onClose}
    >
      {loading ? (
        <div className="muted">Loading…</div>
      ) : err ? (
        <div className="error">{err}</div>
      ) : snapshot ? (
        <div className="kpidoc-version-view">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Saved {formatWhen(snapshot.createdAt)}
            {snapshot.createdBy && <> by {snapshot.createdBy}</>}
          </div>
          {d.jobTitle && <div><strong>Job title:</strong> {d.jobTitle}</div>}
          {d.periodLabel && <div><strong>Period:</strong> {d.periodLabel}</div>}
          {d.introText && (
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{d.introText}</p>
          )}

          <div className="modal-section-title">Review rows</div>
          {rows.length === 0 ? (
            <div className="muted small">No editable rows captured in this version.</div>
          ) : (
            <div className="kpidoc-table-wrap">
              <table className="kpidoc-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Data For Review</th>
                    <th>Overall KPI Score</th>
                    <th>Weighted score result</th>
                    <th>Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="kpidoc-num">{i + 1}</td>
                      <td className="kpidoc-prewrap">{r.dataSource || ''}</td>
                      <td className="kpidoc-prewrap">{r.dataResult || ''}</td>
                      <td>{r.status || ''}</td>
                      <td className="kpidoc-prewrap">{r.comments || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.declarationText && (
            <>
              <div className="modal-section-title">Declaration</div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{d.declarationText}</p>
            </>
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
