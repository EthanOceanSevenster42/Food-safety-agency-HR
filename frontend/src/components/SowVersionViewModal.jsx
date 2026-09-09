import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { diffSowData, wordDiff, htmlToText } from './sow-diff.js';
import { confirmDialog } from '../confirm.js';

// Read-only viewer for a single saved SOW version.
//
// Mirrors the SowEditorModal layout (cover, sections, sub-sections,
// signatures, appendix tables) but every field is rendered as static text
// rather than an input. When the version isn't the very first save, every
// field that differs from the previous version is shown with an inline
// word-diff (red strikethrough for removed words, green for added).
//
// Props:
//   processId  — owner process
//   versionId  — the SowVersions.Id row to display
//   versions   — pre-fetched list (so we can pick the previous version
//                without an extra round-trip)
//   onClose    — modal dismiss

export default function SowVersionViewModal({ processId, versionId, versions, onClose, onSignedChange }) {
  const [current,  setCurrent]  = useState(null);
  const [previous, setPrevious] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState('');
  // Per-modal upload state — separate from version loading so the user
  // can pick a file without re-fetching the whole snapshot.
  const [uploading,   setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState('');

  async function uploadSigned(file) {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const res = await api.uploadSignedVersion(processId, versionId, file);
      setCurrent((c) => (c ? { ...c, signedDocUrl: res?.signedDocUrl || null } : c));
      onSignedChange?.(res?.signedDocUrl || null);
    } catch (e) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  }
  async function removeSigned() {
    if (!(await confirmDialog({
      title: 'Remove the signed copy?',
      body: 'The version stays; only the uploaded signed document is removed.',
      tone: 'danger',
      confirmLabel: 'Remove copy',
    }))) return;
    setUploading(true);
    setUploadError('');
    try {
      await api.deleteSignedVersion(processId, versionId);
      setCurrent((c) => (c ? { ...c, signedDocUrl: null } : c));
      onSignedChange?.(null);
    } catch (e) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  }

  // Index of this version inside the (newest-first) list. The "previous"
  // version is the one immediately *older* — i.e. index + 1.
  const idx = useMemo(
    () => (Array.isArray(versions) ? versions.findIndex((v) => v.id === versionId) : -1),
    [versions, versionId],
  );
  const isFirstSave = idx === -1
    ? false
    : (idx === versions.length - 1); // oldest entry = first ever save

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    const prevEntry = (idx >= 0 && versions[idx + 1]) ? versions[idx + 1] : null;
    Promise.all([
      api.getSowVersion(processId, versionId),
      prevEntry ? api.getSowVersion(processId, prevEntry.id) : Promise.resolve(null),
    ])
      .then(([cur, prev]) => {
        if (cancelled) return;
        setCurrent(cur);
        setPrevious(prev);
      })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [processId, versionId, idx, versions]);

  const title = current
    ? `SOW · V${current.version} · ${formatWhenLong(current.createdAt)}`
    : 'SOW version';

  return (
    <Modal title={title} onClose={onClose}>
      <div className="sow-view">
        {loading && <div className="muted">Loading…</div>}
        {!loading && err && <div className="error">{err}</div>}
        {!loading && !err && current && (
          <SowVersionViewBody
            current={current}
            previous={previous}
            isFirstSave={isFirstSave}
            onClose={onClose}
            uploading={uploading}
            uploadError={uploadError}
            onUploadSigned={uploadSigned}
            onRemoveSigned={removeSigned}
          />
        )}
      </div>
    </Modal>
  );
}

function SowVersionViewBody({ current, previous, isFirstSave, onClose, uploading, uploadError, onUploadSigned, onRemoveSigned }) {
  const data = current?.data || {};
  const prevData = previous?.data || null;
  const diff = useMemo(() => diffSowData(prevData || {}, data), [prevData, data]);

  const changedCount =
    diff.cover.length +
    diff.sections.filter((s) => s.status !== 'unchanged').length;

  return (
    <div className="sow-view-body">
      {/* Top summary strip — what this version is, what's downloadable, and
          how it compares to the previous one. */}
      <div className="sow-view-header">
        <div className="sow-view-header-meta">
          <span className="sow-versions-badge">V{current.version}</span>
          <span className="muted">Saved {formatWhenLong(current.createdAt)}</span>
          {current.createdBy && <span className="muted">· by {current.createdBy}</span>}
        </div>
        <div className="sow-view-header-actions">
          {current.docUrl && (
            <a className="btn-ghost" href={current.docUrl} target="_blank" rel="noreferrer">⬇ Download PDF</a>
          )}
          {/* Signed-copy controls — upload a counter-signed PDF / scan
              against this specific version. Once attached, the link
              switches to a green download + a "remove" option. The
              parent SowVersionHistory picks up the change via the
              onSignedChange callback and outlines the row green. */}
          {current.signedDocUrl ? (
            <>
              <a
                className="btn-ghost btn-signed-doc"
                href={current.signedDocUrl}
                target="_blank"
                rel="noreferrer"
              >✓ Signed copy</a>
              <button
                type="button"
                className="btn-ghost danger"
                onClick={onRemoveSigned}
                disabled={uploading}
              >Remove signed</button>
            </>
          ) : (
            <label className="btn-ghost upload-trigger">
              {uploading ? 'Uploading…' : '↑ Upload signed copy'}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="upload-input-overlay"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadSigned(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      {uploadError && (
        <div className="error small" style={{ marginTop: 4 }}>{uploadError}</div>
      )}
      {isFirstSave ? (
        <div className="sow-view-firstnote muted small">
          This is the first saved version of this SOW — there's nothing earlier to compare against.
        </div>
      ) : !prevData ? (
        <div className="sow-view-firstnote muted small">
          The previous version's data isn't available — showing this version's content without diff highlights.
        </div>
      ) : (
        <div className="sow-view-summary">
          {changedCount === 0
            ? <span className="muted small">No content differences vs the previous version.</span>
            : <span className="muted small">{changedCount} change{changedCount === 1 ? '' : 's'} since the previous version — highlighted below.</span>}
          <span className="sow-view-legend">
            <span className="diff-add">added</span>
            <span className="diff-remove">removed</span>
          </span>
        </div>
      )}

      {/* COVER PAGE */}
      <h3 className="sow-h3">Cover page</h3>
      <CoverView cover={data.cover || {}} coverChanges={diff.cover} />

      {/* SECTIONS */}
      <h3 className="sow-h3">Sections</h3>
      <SectionsView sections={data.sections || []} sectionDiffs={diff.sections} />

      {/* APPENDICES */}
      <AppendicesView tables={data.tables || {}} />

      {/* SIGNATURES */}
      <h3 className="sow-h3">Signature Control</h3>
      <SignaturesView signatures={data.signatures || {}} />
    </div>
  );
}

// ---------- Cover ----------

function CoverView({ cover, coverChanges }) {
  const changedFields = new Set(coverChanges.map((c) => c.field));
  const Field = ({ label, field }) => {
    const value = cover[field];
    const change = coverChanges.find((c) => c.field === field);
    return (
      <div className="sow-view-field">
        <div className="sow-view-field-label">{label}</div>
        {change ? (
          <div className="sow-view-field-value">
            <span className="diff-remove">{change.prev || <em className="muted">empty</em>}</span>
            <span className="sow-view-arrow">→</span>
            <span className="diff-add">{change.next || <em className="muted">empty</em>}</span>
          </div>
        ) : (
          <div className="sow-view-field-value">{value || <em className="muted">empty</em>}</div>
        )}
      </div>
    );
  };
  return (
    <div className={'sow-view-cover' + (changedFields.size ? ' has-changes' : '')}>
      <Field label="Client name"        field="clientName" />
      <Field label="Subtitle"           field="subtitle" />
      <Field label="Date of submission" field="dateOfSubmission" />
      <Field label="Version"            field="version" />
      <Field label="Revision note"      field="revision" />
    </div>
  );
}

// ---------- Sections / Sub-sections ----------

function SectionsView({ sections, sectionDiffs }) {
  // Match each rendered section to its diff entry. Sections are returned in
  // the new-order; if a removed-only section ended up appended at the end of
  // the diff list, render it too at the bottom.
  const list = (sections || []).map((sec, idx) => {
    const dCandidate = sectionDiffs.find(
      (d) => d.number === idx + 1 && d.status !== 'removed' && (d.title || '') === (sec.title || ''),
    ) || sectionDiffs[idx] || null;
    return { sec, diff: dCandidate, idx };
  });
  const removedOnly = sectionDiffs.filter((d) => d.status === 'removed');
  return (
    <div className="sow-view-sections">
      {list.map(({ sec, diff, idx }) => (
        <SectionView key={sec.id || idx} number={idx + 1} sec={sec} diff={diff} />
      ))}
      {removedOnly.map((d, i) => (
        <RemovedSectionView key={`r-${i}`} diff={d} />
      ))}
    </div>
  );
}

function SectionView({ number, sec, diff }) {
  const status = diff?.status || 'unchanged';
  return (
    <div className={'sow-view-section status-' + status}>
      <div className="sow-view-section-head">
        <span className="sow-view-section-num">{number}.</span>
        <h4 className="sow-view-section-title">{sec.title || <em className="muted">(untitled)</em>}</h4>
        {status !== 'unchanged' && (
          <span className={'sow-diff-status status-' + status}>{statusLabel(status)}</span>
        )}
      </div>
      <BodyView
        html={sec.body}
        prevHtml={diff?.prevBody}
        bodyChanged={diff?.bodyChanged}
        status={status}
      />
      {Array.isArray(sec.subsections) && sec.subsections.map((sub, i) => {
        const subDiff = diff?.subsections?.[i];
        return (
          <SubsectionView
            key={i}
            number={`${number}.${i + 1}`}
            sub={sub}
            diff={subDiff}
          />
        );
      })}
      {diff?.subsections?.filter((s) => s.status === 'removed').map((s, i) => (
        <RemovedSubsectionView key={`rs-${i}`} number={`${number}.×`} sub={s} />
      ))}
    </div>
  );
}

function SubsectionView({ number, sub, diff }) {
  const status = diff?.status || 'unchanged';
  return (
    <div className={'sow-view-subsection status-' + status}>
      <div className="sow-view-subsection-head">
        <span className="sow-view-section-num">{number}</span>
        <h5 className="sow-view-section-title">{sub.title || <em className="muted">(untitled)</em>}</h5>
        {status !== 'unchanged' && (
          <span className={'sow-diff-status status-' + status}>{statusLabel(status)}</span>
        )}
      </div>
      <BodyView
        html={sub.body}
        prevHtml={diff?.prevBody}
        bodyChanged={diff?.bodyChanged}
        status={status}
      />
      {Array.isArray(sub.subsubsections) && sub.subsubsections.map((ss, j) => {
        const ssDiff = diff?.subsubsections?.[j];
        return (
          <SubsubsectionView
            key={j}
            number={`${number}.${j + 1}`}
            ss={ss}
            diff={ssDiff}
          />
        );
      })}
    </div>
  );
}

function SubsubsectionView({ number, ss, diff }) {
  const status = diff?.status || 'unchanged';
  return (
    <div className={'sow-view-subsubsection status-' + status}>
      <div className="sow-view-subsection-head">
        <span className="sow-view-section-num">{number}</span>
        <h6 className="sow-view-section-title">{ss.title || <em className="muted">(untitled)</em>}</h6>
        {status !== 'unchanged' && (
          <span className={'sow-diff-status status-' + status}>{statusLabel(status)}</span>
        )}
      </div>
      <BodyView
        html={ss.body}
        prevHtml={diff?.prevBody}
        bodyChanged={diff?.bodyChanged}
        status={status}
      />
    </div>
  );
}

function RemovedSectionView({ diff }) {
  return (
    <div className="sow-view-section status-removed">
      <div className="sow-view-section-head">
        <span className="sow-view-section-num">×</span>
        <h4 className="sow-view-section-title">{diff.title || <em className="muted">(untitled)</em>}</h4>
        <span className="sow-diff-status status-removed">Removed</span>
      </div>
      <BodyView html="" prevHtml={diff.prevBody} bodyChanged={true} status="removed" />
    </div>
  );
}
function RemovedSubsectionView({ number, sub }) {
  return (
    <div className="sow-view-subsection status-removed">
      <div className="sow-view-subsection-head">
        <span className="sow-view-section-num">{number}</span>
        <h5 className="sow-view-section-title">{sub.title || <em className="muted">(untitled)</em>}</h5>
        <span className="sow-diff-status status-removed">Removed</span>
      </div>
      <BodyView html="" prevHtml={sub.prevBody} bodyChanged={true} status="removed" />
    </div>
  );
}

// ---------- Body rendering with optional inline word-diff ----------

function BodyView({ html, prevHtml, bodyChanged, status }) {
  const showDiff = bodyChanged || status === 'added' || status === 'removed';
  const text     = htmlToText(html || '');
  const prevText = htmlToText(prevHtml || '');

  if (!showDiff) {
    if (!text) return <div className="sow-view-body muted small"><em>(empty)</em></div>;
    return <pre className="sow-view-body">{text}</pre>;
  }
  if (status === 'added' && !prevText) {
    return (
      <pre className="sow-view-body">
        <span className="diff-add">{text}</span>
      </pre>
    );
  }
  if (status === 'removed' && !text) {
    return (
      <pre className="sow-view-body">
        <span className="diff-remove">{prevText}</span>
      </pre>
    );
  }
  const segments = wordDiff(prevText, text);
  if (segments.length === 0) {
    return <pre className="sow-view-body">{text}</pre>;
  }
  return (
    <pre className="sow-view-body">
      {segments.map((s, i) => {
        if (s.type === 'add')    return <span key={i} className="diff-add">{s.text}</span>;
        if (s.type === 'remove') return <span key={i} className="diff-remove">{s.text}</span>;
        return <span key={i}>{s.text}</span>;
      })}
    </pre>
  );
}

// ---------- Tables ----------

// Read-only view of the unified appendices array. Falls back to the legacy
// `appendixA` / `monthlyServiceAllocation` keys so older versions still
// render something meaningful when opened from version history.
function AppendicesView({ tables }) {
  const list = Array.isArray(tables.appendices) && tables.appendices.length > 0
    ? tables.appendices
    : legacyAppendicesFromTables(tables);
  if (list.length === 0) {
    return (
      <>
        <h3 className="sow-h3">Appendices</h3>
        <div className="muted small">No appendices were saved with this version.</div>
      </>
    );
  }
  return (
    <>
      {list.map((appx, idx) => {
        const letter = String.fromCharCode(65 + idx);
        const title  = (appx.title || '').trim() || 'Untitled';
        return (
          <div key={appx.id || idx} className="sow-view-appendix">
            <h3 className="sow-h3">Appendix {letter} · {title}</h3>
            {appx.type === 'milestones' ? (
              <MilestonesView projects={Array.isArray(appx.projects) ? appx.projects : []} />
            ) : (
              <CustomAppendixView blocks={Array.isArray(appx.blocks) ? appx.blocks : []} />
            )}
          </div>
        );
      })}
    </>
  );
}

function MilestonesView({ projects }) {
  if (projects.length === 0) return <div className="muted small">(no milestones)</div>;
  return (
    <div className="sow-view-milestones">
      {projects.map((p, i) => (
        <div key={i} className="sow-view-milestone-project">
          <div className="sow-view-field-label">
            P{i + 1}{p.phase ? ` · Phase ${p.phase}` : ''} — {p.name || '—'}
          </div>
          <TableView grid={[
            ['Week', 'Hours', 'Tariff', 'Description'],
            ...((Array.isArray(p.milestones) ? p.milestones : []).map((m) => [
              `W${m.week || 1}`,
              String(m.hours ?? ''),
              m.tariff != null ? `R${m.tariff}` : '',
              m.description || '',
            ])),
          ]} />
        </div>
      ))}
    </div>
  );
}

function CustomAppendixView({ blocks }) {
  if (blocks.length === 0) return <div className="muted small">(empty)</div>;
  return (
    <div className="sow-view-appendix-blocks">
      {blocks.map((blk, i) => (
        <div key={i} className="sow-view-appendix-block">
          {blk.heading && <div className="sow-view-h2">{blk.heading}</div>}
          {blk.type === 'text' ? (
            <div
              className="sow-view-body"
              dangerouslySetInnerHTML={{ __html: blk.body || '' }}
            />
          ) : (
            <>
              {blk.description?.trim() && (
                <div className="sow-view-body">{blk.description}</div>
              )}
              <TableView grid={blk.grid} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function legacyAppendicesFromTables(t) {
  const out = [];
  if (t.appendixA && typeof t.appendixA === 'object') {
    out.push({
      title: 'Detailed Milestone Breakdown, Cost & Timeline Allocation',
      type: 'milestones',
      projects: Array.isArray(t.appendixA.projects) ? t.appendixA.projects : [],
    });
  }
  if (Array.isArray(t.extraAppendices)) {
    for (const a of t.extraAppendices) out.push({ ...a, type: 'custom' });
  } else if (Array.isArray(t.monthlyServiceAllocation) && t.monthlyServiceAllocation.length > 0) {
    out.push({
      title: 'SLA Monthly Fee and Service Allocation',
      type: 'custom',
      blocks: [{ type: 'table', heading: 'SLA Monthly Fee and Service Allocation Summary', grid: t.monthlyServiceAllocation }],
    });
  }
  return out;
}

function TableView({ grid }) {
  if (!Array.isArray(grid) || grid.length === 0) {
    return <div className="muted small">(empty)</div>;
  }
  const cols = grid.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
  return (
    <table className="sow-view-table">
      <tbody>
        {grid.map((row, i) => (
          <tr key={i} className={i === 0 ? 'sow-view-table-head' : ''}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}>{Array.isArray(row) ? (row[c] || '') : ''}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Signatures ----------

function SignaturesView({ signatures }) {
  const parties = Array.isArray(signatures.parties)
    ? signatures.parties
    // Legacy { client, provider } shape — promote to a list so the rest of
    // this view just iterates uniformly. Older snapshots saved before the
    // parties refactor still render correctly here.
    : [
        { kind: 'client',   title: 'Client',           ...(signatures.client   || {}) },
        { kind: 'provider', title: 'Service Provider', ...(signatures.provider || {}) },
      ];
  if (parties.length === 0) {
    return <div className="muted small">No signature parties were saved with this version.</div>;
  }
  return (
    <div className="sow-view-signatures">
      {parties.map((p, i) => (
        <SignaturePartyView
          key={p.id || i}
          title={(p.title || '').trim() || (p.kind === 'client' ? 'Client' : p.kind === 'provider' ? 'Service Provider' : 'Party')}
          party={p}
        />
      ))}
    </div>
  );
}

function SignaturePartyView({ title, party }) {
  const rows = Array.isArray(party.rows) ? party.rows : [];
  return (
    <div className="sow-view-sigparty">
      <div className="sow-view-sigparty-title"><strong>{title}:</strong> {party.company || <em className="muted">—</em>}</div>
      {rows.length === 0 ? (
        <div className="muted small">No rows</div>
      ) : (
        <table className="sow-view-sigtable">
          <tbody>
            {rows.map((r, i) => {
              const isSig = (r.label || '').toLowerCase() === 'signature';
              return (
                <tr key={i}>
                  <td className="sow-view-sigtable-label"><strong>{r.label || ''}</strong></td>
                  <td>:</td>
                  <td>
                    {isSig && r.signatureFile
                      ? <img src={`/uploads/${r.signatureFile}`} alt="Signature" className="sow-view-sig-image" />
                      : (r.value || <em className="muted">—</em>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Helpers ----------

function statusLabel(s) {
  if (s === 'added')    return 'Added';
  if (s === 'removed')  return 'Removed';
  if (s === 'modified') return 'Modified';
  return 'Unchanged';
}

function formatWhenLong(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
