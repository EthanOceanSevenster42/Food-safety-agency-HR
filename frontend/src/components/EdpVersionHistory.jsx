import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EdpVersionViewModal from './EdpVersionViewModal.jsx';

// Compact version list rendered inside the "Version history" card below
// each EDP-kind task on the whiteboard. Mirrors JdVersionHistory.
export default function EdpVersionHistory({ processId, refreshKey = 0 }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openVersionId, setOpenVersionId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [bumpKey, setBumpKey] = useState(0);
  const [migrating, setMigrating] = useState(false);
  const [migrationReport, setMigrationReport] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    api.listEdpVersions(processId)
      .then((list) => { if (!cancelled) setVersions(Array.isArray(list) ? list : []); })
      .catch((e)   => { if (!cancelled) setErr(e.message); })
      .finally(()  => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [processId, refreshKey, bumpKey]);

  async function runMigrations(e) {
    e?.stopPropagation();
    setMigrating(true);
    setMigrationReport(null);
    try {
      const res = await api.runProjectMigrations();
      setMigrationReport(res?.results || []);
      setBumpKey((k) => k + 1);
    } catch (e2) {
      setMigrationReport([{ name: 'request', status: 'failed', error: e2.message }]);
    } finally {
      setMigrating(false);
    }
  }

  if (loading) return <div className="sow-versions muted small">Loading versions…</div>;
  if (err) {
    const missing = /invalid object name|edpversions/i.test(err);
    return (
      <div className="sow-versions muted small">
        {missing ? (
          <>
            <div style={{ marginBottom: 6 }}>
              The <code>EdpVersions</code> table doesn't exist yet — the auto-migration didn't reach the database.
            </div>
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={runMigrations}
              disabled={migrating}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {migrating ? 'Running…' : 'Run migration now'}
            </button>
            {migrationReport && (
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: 11 }}>
                {migrationReport.map((m, i) => (
                  <li key={i} style={{ color: m.status === 'failed' ? '#b71c1c' : 'inherit' }}>
                    <strong>{m.name}</strong>: {m.status}
                    {m.error && <> — <em>{m.error}</em></>}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <span className="error small">{err}</span>
        )}
      </div>
    );
  }
  if (versions.length === 0) {
    return <div className="sow-versions muted small">No saved versions yet — save the EDP to create the first version.</div>;
  }

  const visible = showAll ? versions : versions.slice(0, 5);

  return (
    <>
      <div className="sow-versions">
        <ul className="sow-versions-list">
          {visible.map((v) => (
            <li
              key={v.id}
              className="sow-versions-item"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setOpenVersionId(v.id)}
              title="Click to view this version"
            >
              <div className="sow-versions-row">
                <span className="sow-versions-badge">V{v.version}</span>
                <div className="sow-versions-meta">
                  <div className="sow-versions-when">{formatWhen(v.createdAt)}</div>
                  {v.createdBy && (
                    <div className="sow-versions-by muted small">{formatAuthor(v.createdBy)}</div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {versions.length > 5 && (
          <button
            type="button"
            className="sow-versions-more"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setShowAll((s) => !s); }}
          >
            {showAll ? 'Show fewer' : `Show all (${versions.length})`}
          </button>
        )}
      </div>
      {openVersionId != null && (
        <EdpVersionViewModal
          processId={processId}
          versionId={openVersionId}
          onClose={() => setOpenVersionId(null)}
        />
      )}
    </>
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

function formatAuthor(raw) {
  if (!raw) return '';
  const s = String(raw);
  if (s.length <= 28) return s;
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s.slice(0, 26) + '…';
}
