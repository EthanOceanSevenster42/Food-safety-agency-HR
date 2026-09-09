import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

// Editor for a Pack task. Pack tasks store no data — they're a render-
// time composition of the project's sibling JD / KPI Doc / EDP tasks.
// The editor shows which sources are present and a Preview PDF button.
//
// There's no Save action: the underlying task has nothing to mutate.
// Clicking Preview opens the combined PDF in the same overlay used by
// the JD / KPI Doc preview flows.
export default function PackEditorModal({ processId, processName, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');
  const [data, setData]       = useState(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    api.getPack(processId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e)   => { if (!cancelled) setErr(e.message || 'Failed to load'); })
      .finally(()  => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [processId]);

  function sourceRow(label, src) {
    if (!src) {
      return (
        <li className="pack-source pack-source-missing">
          <span className="pack-source-status" aria-hidden>✗</span>
          <div>
            <strong>{label}</strong>
            <div className="muted small">Not found — add this task to the project to include it in the pack.</div>
          </div>
        </li>
      );
    }
    if (!src.hasData) {
      return (
        <li className="pack-source pack-source-empty">
          <span className="pack-source-status" aria-hidden>!</span>
          <div>
            <strong>{label}</strong> · <span className="muted">{src.name}</span>
            <div className="muted small">Task exists but no data has been saved yet — open it and save before generating the pack.</div>
          </div>
        </li>
      );
    }
    return (
      <li className="pack-source pack-source-ok">
        <span className="pack-source-status" aria-hidden>✓</span>
        <div>
          <strong>{label}</strong> · <span className="muted">{src.name}</span>
          <div className="muted small">Ready to include.</div>
        </div>
      </li>
    );
  }

  const sources = data?.sources || {};
  // The preview is allowed when at least the JD or KPI Doc is present
  // (anything less and the pack is just a cover page).
  const anyReady = (sources.jd?.hasData) || (sources.kpidoc?.hasData) || (sources.edp?.hasData);

  return (
    <Modal title={processName || 'Role, KPI & EDP Pack'} onClose={onClose}>
      {err && <div className="error">{err}</div>}
      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        <div className="pack-editor">
          <p className="muted" style={{ marginTop: 0 }}>
            This task compiles the project's <strong>Job Description</strong>, <strong>KPI Document</strong> and <strong>EDP Alignment Notes</strong> into one branded PDF. Nothing is captured here — open any source task to edit its content.
          </p>

          <div className="modal-section-title">Source documents</div>
          <ul className="pack-source-list">
            {sourceRow('Job Description',       sources.jd)}
            {sourceRow('KPI Document',          sources.kpidoc)}
            {sourceRow('EDP Alignment Notes',   sources.edp)}
          </ul>
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setPreviewing(true)}
          disabled={loading || !anyReady}
          title={anyReady ? 'Render the combined Pack PDF' : 'Add at least one source task with saved data before previewing'}
        >
          Preview Pack PDF
        </button>
      </div>

      {previewing && (
        <PackPreview
          processId={processId}
          processName={processName}
          onClose={() => {
            setPreviewing(false);
            // Treat a successful preview as a "saved" signal so the
            // whiteboard flips the card label without a refresh — the
            // Pack task itself has no save action.
            onSaved?.();
          }}
        />
      )}
    </Modal>
  );
}

function PackPreview({ processId, processName, onClose }) {
  const [blobUrl, setBlobUrl] = useState('');
  const [pdfBlob, setPdfBlob] = useState(null);
  const [filename, setFilename] = useState('Document Pack.pdf');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let createdUrl = '';
    setStatus('loading');
    setError('');
    (async () => {
      try {
        const { blob, filename: name } = await api.previewPackPdf(processId);
        if (cancelled) return;
        setPdfBlob(blob);
        setFilename(name || 'Document Pack.pdf');
        createdUrl = window.URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setError(e.message);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) window.URL.revokeObjectURL(createdUrl);
    };
  }, [processId]);

  // Download with the descriptive name the server supplied (the browser's
  // in-viewer download button can only use the opaque blob URL, so we give
  // people an explicit, correctly-named download here).
  function handleDownload() {
    if (!pdfBlob) return;
    const url = window.URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'Document Pack.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 1500);
  }

  return (
    <div className="sow-preview-overlay" onMouseDown={onClose}>
      <div className="sow-preview-shell" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sow-preview-toolbar">
          <strong>{processName ? `${processName} · Preview` : 'Role, KPI & EDP Pack Preview'}</strong>
          <span className="muted small">Combined PDF — Job Description, KPI Document, EDP Alignment Notes.</span>
          {status === 'ready' && (
            <button type="button" className="btn-primary" onClick={handleDownload}>Download PDF</button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose}>Close preview</button>
        </div>
        <div className="sow-preview-pages">
          {status === 'loading' && <div className="sow-preview-loading muted">Generating combined PDF…</div>}
          {status === 'error'   && <div className="sow-preview-loading"><div className="error">{error}</div></div>}
          {status === 'ready' && blobUrl && (
            <iframe src={blobUrl} title="Pack PDF preview" className="sow-preview-iframe" />
          )}
        </div>
      </div>
    </div>
  );
}
