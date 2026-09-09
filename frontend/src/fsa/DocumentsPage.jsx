import { useState } from 'react';
import { api } from '../api.js';
import { Badge, Bar, Card, PageHead, Spinner, ErrorNote, StatRow, Table, useFsa } from './Ui.jsx';

export default function DocumentsPage() {
  const [library, setLibrary] = useState('All documents');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useFsa(
    () => api.fsaDocuments({ library, q }),
    [library, q]
  );
  const [newLib, setNewLib] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [msg, setMsg] = useState('');

  async function addLibrary() {
    const name = newLib.trim();
    if (!name) return;
    setMsg('');
    try {
      await api.fsaAddLibrary(name);
      setNewLib('');
      setLibrary(name);
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function saveRename(lib) {
    const name = renameValue.trim();
    if (!name || name === lib.Name) { setRenaming(null); return; }
    setMsg('');
    try {
      await api.fsaRenameLibrary(lib.Id, name);
      if (library === lib.Name) setLibrary(name);
      setRenaming(null);
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <div className="aps-page">
      <PageHead
        crumb="Documents · Controlled documents"
        title="Document depository"
        sub="Every HR document carries an owner, a version, a review date and — where required — a record of who has acknowledged it. A document past its review date is shown as an observation, not hidden."
      />

      {data && <StatRow
        stats={data.stats}
        icons={['fas fa-folder-open', 'fas fa-hourglass-half', 'fas fa-triangle-exclamation', 'fas fa-signature']}
      />}

      {msg && <div className="aps-note" style={{ color: '#dc2626', marginBottom: 12 }}>{msg}</div>}

      <div className="aps-two-col aps-two-col--sidebar">
        <div className="aps-stack">
          <Card title="Libraries">
            <div className="aps-stack" style={{ gap: 2 }}>
              {(data?.libraries || []).map((l) => {
                const active = library === l.Name;
                if (renaming === l.Name) {
                  return (
                    <div key={l.Name} style={{ display: 'flex', gap: 6, padding: '6px 0' }}>
                      <input
                        className="aps-input"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRename(l);
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                      />
                      <button className="aps-btn aps-btn--primary" onClick={() => saveRename(l)}>Save</button>
                    </div>
                  );
                }
                return (
                  <div key={l.Name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      onClick={() => setLibrary(l.Name)}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 8, textAlign: 'left', border: 'none', cursor: 'pointer',
                        padding: '9px 10px', borderRadius: 6, fontFamily: 'inherit',
                        fontSize: '0.8rem', fontWeight: active ? 700 : 400, color: '#1f2937',
                        background: active ? '#e0f2f5' : 'transparent',
                        boxShadow: active ? 'inset 3px 0 0 #007890' : 'none',
                      }}
                    >
                      <span>{l.Name}</span>
                      <span className="aps-meta">{l.Count}</span>
                    </button>
                    {l.Id != null && (
                      <button
                        className="aps-btn aps-btn--ghost"
                        style={{ padding: '4px 7px' }}
                        title="Rename this library"
                        onClick={() => { setRenaming(l.Name); setRenameValue(l.Name); }}
                      >
                        <i className="fas fa-pen" style={{ fontSize: '0.65rem' }} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <hr className="aps-hair" />
            <label className="aps-label">New library</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="aps-input"
                placeholder="e.g. Disciplinary records"
                value={newLib}
                onChange={(e) => setNewLib(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addLibrary()}
              />
              <button className="aps-btn aps-btn--primary" onClick={addLibrary}>
                <i className="fas fa-plus" />
              </button>
            </div>
          </Card>

          <Card title="Acknowledgement tracking">
            <p className="aps-note" style={{ margin: '0 0 12px' }}>
              Where a policy must be read and accepted, the depository records who has done so.
              This is the evidence produced in an audit — not a circulated email.
            </p>
            <div className="aps-stack" style={{ gap: 12 }}>
              {(data?.acknowledgements || []).map((a) => (
                <div key={a.DocName}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#111827' }}>{a.DocName}</div>
                  <div className="aps-meta" style={{ margin: '2px 0 5px' }}>{a.Detail}</div>
                  <Bar pct={a.Pct} color={a.Pct >= 95 ? '#059669' : a.Pct >= 90 ? '#007890' : '#b45309'} />
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card
          title={library}
          note={data
            ? (data.rows.length
              ? `Showing ${data.rows.length} of ${data.total} controlled documents`
              : 'No documents in this library yet.')
            : null}
          flush
        >
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 340 }}>
              <i
                className="fas fa-magnifying-glass"
                style={{ position: 'absolute', left: 10, top: 10, color: '#9ca3af', fontSize: '0.75rem' }}
              />
              <input
                className="aps-input"
                style={{ paddingLeft: 30 }}
                placeholder="Search document, reference, owner…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <button className="aps-btn aps-btn--ghost">
              <i className="fas fa-upload" /> Upload a document
            </button>
          </div>

          {loading && <Spinner />}
          {error && <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div>}

          {data && !loading && (
            <Table
              columns={['Document', 'Version', 'Owner', 'Next review', 'Status']}
              isEmpty={data.rows.length === 0}
              empty="No documents in this library yet. Upload one, or move an existing document into it."
            >
              {data.rows.map((d) => (
                <tr key={d.Ref}>
                  <td>
                    <div className="aps-td-strong">{d.Name}</div>
                    <div className="aps-meta">
                      <span className="aps-td-mono">{d.Ref}</span> · {d.Kind}
                    </div>
                  </td>
                  <td className="aps-td-mono">{d.Version}</td>
                  <td>{d.Owner}</td>
                  <td className="aps-td-mono">{d.NextReview}</td>
                  <td><Badge kind={d.StatusKind}>{d.Status}</Badge></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
