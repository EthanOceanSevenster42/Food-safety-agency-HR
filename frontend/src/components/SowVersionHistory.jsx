import { useEffect, useState } from 'react';
import { api } from '../api.js';
import SowVersionViewModal from './SowVersionViewModal.jsx';

// Compact version list shown inside the "Version history" card on the
// whiteboard. Each row gives the version pill, when/by, and a PDF download.
// Clicking a row opens SowVersionViewModal — the same layout as the SOW
// editor, but read-only and with an inline word-diff against the previous
// version.

export default function SowVersionHistory({ processId, refreshKey = 0 }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openVersionId, setOpenVersionId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [bumpKey, setBumpKey] = useState(0);
  const [migrating, setMigrating] = useState(false);
  const [migrationReport, setMigrationReport] = useState(null);

  // Called by SowVersionViewModal after the user uploads or removes the
  // signed copy from inside that modal — patches the local versions list
  // so the green outline appears (or disappears) immediately, without a
  // re-fetch.
  function applySignedChange(versionId, signedDocUrl) {
    setVersions((prev) => prev.map((v) => (v.id === versionId ? { ...v, signedDocUrl } : v)));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    api.listSowVersions(processId)
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
    const missing = /invalid object name|sowversions/i.test(err);
    return (
      <div className="sow-versions muted small">
        {missing ? (
          <>
            <div style={{ marginBottom: 6 }}>
              The <code>SowVersions</code> table doesn't exist yet — the auto-migration didn't reach the database.
              Click below to retry without restarting the backend.
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
    return <div className="sow-versions muted small">No saved versions yet — save the SOW to create the first version.</div>;
  }

  const visible = showAll ? versions : versions.slice(0, 5);

  return (
    <>
      <div className="sow-versions">
        <ul className="sow-versions-list">
          {visible.map((v) => (
            <li
              key={v.id}
              // Green outline marks a version that has a signed copy
              // attached — the actual upload control lives inside
              // SowVersionViewModal (one click into the row to see /
              // upload / remove it alongside the change diff).
              className={'sow-versions-item' + (v.signedDocUrl ? ' sow-versions-item--signed' : '')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setOpenVersionId(v.id)}
              title={v.signedDocUrl
                ? 'Click to view this version + signed copy'
                : 'Click to view this version + changes'}
            >
              <div className="sow-versions-row">
                <span className="sow-versions-badge">V{v.version}</span>
                <div className="sow-versions-meta">
                  <div className="sow-versions-when">{formatWhen(v.createdAt)}</div>
                  {v.createdBy && (
                    <div className="sow-versions-by muted small">{formatAuthor(v.createdBy)}</div>
                  )}
                </div>
                {v.docUrl && (
                  <a
                    className="sow-versions-download"
                    href={v.docUrl}
                    target="_blank"
                    rel="noreferrer"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title={`Download V${v.version} PDF`}
                    aria-label={`Download V${v.version}`}
                  >⬇</a>
                )}
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
        <SowVersionViewModal
          processId={processId}
          versionId={openVersionId}
          versions={versions}
          onClose={() => setOpenVersionId(null)}
          onSignedChange={(signedDocUrl) => applySignedChange(openVersionId, signedDocUrl)}
        />
      )}
    </>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // Compact: "12 May 2026 · 13:03"
  return d.toLocaleString(undefined, {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', ' ·');
}

function formatAuthor(raw) {
  // Trim email domains down so the row doesn't wrap — "anthony@eclick.co.za"
  // → "anthony@eclick.co.za" if short enough, otherwise show the user part.
  if (!raw) return '';
  const s = String(raw);
  if (s.length <= 28) return s;
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s.slice(0, 26) + '…';
}
