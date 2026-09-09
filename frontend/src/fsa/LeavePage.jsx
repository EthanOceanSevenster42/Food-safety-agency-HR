// Leave & site coverage.
//
// Built as a work queue rather than a list of cards: at agency scale the
// pending pile runs to thousands, so this screen filters, sorts and pages
// against the database and only ever holds one page of rows.
//
// The long "what happens to the site if you approve this" sentence is reduced
// to a one-glance verdict in the table and kept in full on the expanded row —
// nobody reads a paragraph per row 25 rows at a time.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Bar, Card, PageHead, Spinner, ErrorNote, KIND_COLOR, useFsa } from './Ui.jsx';

const STATUS_TABS = [
  { key: 'pending', label: 'To decide', countKey: 'pending' },
  { key: 'approved', label: 'Approved', countKey: 'approved' },
  { key: 'declined', label: 'Declined', countKey: 'declined' },
  { key: 'All', label: 'All', countKey: 'all' },
];

// Plain-language verdicts instead of a paragraph.
const COVERAGE = {
  bad: { kind: 'bad', label: 'Site short' },
  warn: { kind: 'warn', label: 'Runs tight' },
  ok: { kind: 'ok', label: 'No impact' },
};

const SORTS = [
  { key: 'urgent', label: 'Most urgent' },
  { key: 'soonest', label: 'Starts soonest' },
  { key: 'latest', label: 'Starts latest' },
  { key: 'longest', label: 'Longest first' },
  { key: 'name', label: 'Employee A–Z' },
  { key: 'site', label: 'Site A–Z' },
];

const STATUS_BADGE = {
  pending: { kind: 'na', label: 'To decide' },
  approved: { kind: 'ok', label: 'Approved' },
  declined: { kind: 'bad', label: 'Declined' },
};

const DEFAULTS = {
  status: 'pending', site: 'All', service: 'All', type: 'All',
  coverage: 'All', q: '', sort: 'urgent', page: 1, pageSize: 25,
};

const fmtDays = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${v === 1 ? 'day' : 'days'}`;
};

// "27 Jul – 1 Aug 2026" reads faster in a dense table than two ISO dates, and
// fits on one line.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtRange = (start, end) => {
  if (!start) return '—';
  const [sy, sm, sd] = String(start).slice(0, 10).split('-');
  const day = (d) => String(Number(d));
  const from = `${day(sd)} ${MONTHS[Number(sm) - 1]}`;
  if (!end) return `${from} ${sy}`;
  const [ey, em, ed] = String(end).slice(0, 10).split('-');
  const to = `${day(ed)} ${MONTHS[Number(em) - 1]}`;
  return sy === ey ? `${from} – ${to} ${ey}` : `${from} ${sy} – ${to} ${ey}`;
};

export default function LeavePage() {
  const [query, setQuery] = useState(DEFAULTS);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [openRow, setOpenRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Typing shouldn't fire a request per keystroke against a table this size.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery((prev) => (prev.q === search ? prev : { ...prev, q: search, page: 1 }));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadQueue = useCallback(() => api.fsaLeave(query), [query]);
  const { data, error, loading, reload } = useFsa(loadQueue, [query]);

  const set = (patch) => {
    setSelected(new Set());
    setOpenRow(null);
    setQuery((prev) => ({ ...prev, page: 1, ...patch }));
  };

  const goPage = (page) => {
    setSelected(new Set());
    setOpenRow(null);
    setQuery((prev) => ({ ...prev, page }));
  };

  function toggleRow(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    const ids = (data?.rows || []).map((r) => r.Id);
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected(allOn ? new Set() : new Set(ids));
  }

  async function decide(id, decision) {
    setBusy(true);
    setMsg('');
    try {
      await api.fsaLeaveDecision(id, decision);
      reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function decideSelected(decision) {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await api.fsaLeaveBulkDecision(ids, decision);
      setSelected(new Set());
      setMsg(`${r.updated} request${r.updated === 1 ? '' : 's'} ${decision}.`);
      reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const counts = data?.counts;
  const rows = data?.rows || [];
  const pageIds = rows.map((r) => r.Id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const showDecide = query.status === 'pending' || query.status === 'All';

  return (
    <div className="aps-page">
      <PageHead
        crumb="Time &amp; attendance"
        title="Leave &amp; site coverage"
        sub="Approve leave against what it leaves the site with, not against a calendar."
      />

      {/* Summary — also the quickest way to filter. */}
      <div className="aps-stats">
        <SummaryTile
          label="To decide" value={counts ? counts.pending : '—'}
          icon="fas fa-inbox" kind="info"
          active={query.status === 'pending' && query.coverage === 'All'}
          onClick={() => set({ status: 'pending', coverage: 'All' })}
        />
        <SummaryTile
          label="Needs cover first" value={counts ? counts.atRisk : '—'}
          icon="fas fa-triangle-exclamation" kind="bad"
          note="Approving leaves a site short"
          active={query.coverage === 'bad'}
          onClick={() => set({ status: 'pending', coverage: 'bad' })}
        />
        <SummaryTile
          label="Approved" value={counts ? counts.approved : '—'}
          icon="fas fa-circle-check" kind="ok"
          active={query.status === 'approved'}
          onClick={() => set({ status: 'approved', coverage: 'All' })}
        />
        <SummaryTile
          label="Declined" value={counts ? counts.declined : '—'}
          icon="fas fa-circle-xmark" kind="warn"
          active={query.status === 'declined'}
          onClick={() => set({ status: 'declined', coverage: 'All' })}
        />
      </div>

      {msg && (
        <div className="aps-card" style={{ padding: '12px 16px', marginBottom: 12, borderLeft: '3px solid #007890' }}>
          <span className="aps-note">{msg}</span>
        </div>
      )}

      <div className="aps-two-col aps-two-col--wide">
        <Card
          title="Leave requests"
          note={data ? `${data.total.toLocaleString()} matching · page ${data.page} of ${data.totalPages}` : null}
          flush
        >
          {/* Status tabs */}
          <div style={{ display: 'flex', gap: 4, padding: '12px 16px 0', flexWrap: 'wrap' }}>
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => set({ status: t.key, coverage: 'All' })}
                style={{
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  padding: '7px 12px', borderRadius: '6px 6px 0 0',
                  fontSize: '0.78rem', fontWeight: query.status === t.key ? 700 : 500,
                  color: query.status === t.key ? '#007890' : '#6b7280',
                  background: query.status === t.key ? '#e0f2f5' : 'transparent',
                  boxShadow: query.status === t.key ? 'inset 0 -2px 0 #007890' : 'none',
                }}
              >
                {t.label}
                {counts && <span style={{ opacity: 0.7, marginLeft: 6 }}>{counts[t.countKey].toLocaleString()}</span>}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
              <i className="fas fa-magnifying-glass" style={{ position: 'absolute', left: 10, top: 10, color: '#9ca3af', fontSize: '0.75rem' }} />
              <input
                className="aps-input"
                style={{ paddingLeft: 30 }}
                placeholder="Search employee, site or staff no."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="aps-select" style={{ width: 'auto' }} value={query.site} onChange={(e) => set({ site: e.target.value })}>
              {(data?.filters.sites || ['All']).map((s) => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}
            </select>
            <select className="aps-select" style={{ width: 'auto' }} value={query.service} onChange={(e) => set({ service: e.target.value })}>
              {(data?.filters.services || ['All']).map((s) => <option key={s} value={s}>{s === 'All' ? 'All services' : s}</option>)}
            </select>
            <select className="aps-select" style={{ width: 'auto' }} value={query.type} onChange={(e) => set({ type: e.target.value })}>
              {(data?.filters.types || ['All']).map((s) => <option key={s} value={s}>{s === 'All' ? 'All leave types' : s}</option>)}
            </select>
            <select className="aps-select" style={{ width: 'auto' }} value={query.sort} onChange={(e) => set({ sort: e.target.value })}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {(query.site !== 'All' || query.service !== 'All' || query.type !== 'All'
              || query.coverage !== 'All' || query.q) && (
              <button
                className="aps-btn aps-btn--ghost"
                onClick={() => { setSearch(''); set({ ...DEFAULTS, status: query.status }); }}
              >
                <i className="fas fa-xmark" /> Clear filters
              </button>
            )}
          </div>

          {/* Bulk bar */}
          {selected.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '10px 16px', background: '#e0f2f5', borderBottom: '1px solid #f3f4f6',
            }}>
              <strong style={{ fontSize: '0.8rem', color: '#007890' }}>
                {selected.size} selected
              </strong>
              <button className="aps-btn aps-btn--primary" disabled={busy} onClick={() => decideSelected('approved')}>
                <i className="fas fa-check" /> Approve
              </button>
              <button className="aps-btn aps-btn--danger" disabled={busy} onClick={() => decideSelected('declined')}>
                <i className="fas fa-xmark" /> Decline
              </button>
              <button className="aps-btn aps-btn--ghost" disabled={busy} onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
          )}

          {loading && <Spinner />}
          {error && <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div>}

          {data && !loading && (
            <>
              <div className="aps-table-wrap">
                <table className="aps-table aps-table--dense">
                  <thead>
                    <tr>
                      {showDecide && (
                        <th style={{ width: 34 }}>
                          <input
                            type="checkbox"
                            checked={allOnPage}
                            onChange={toggleAllOnPage}
                            title="Select this page"
                            style={{ accentColor: '#007890', width: 15, height: 15 }}
                          />
                        </th>
                      )}
                      <th>Employee</th>
                      <th>Site</th>
                      <th>Leave</th>
                      <th>Dates</th>
                      <th>Balance after</th>
                      <th>If approved</th>
                      <th>{showDecide ? 'Decide' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td className="aps-table-empty" colSpan={showDecide ? 8 : 7}>
                          Nothing matches these filters.
                        </td>
                      </tr>
                    )}
                    {rows.map((r) => {
                      const cov = COVERAGE[r.CoverageKind] || COVERAGE.ok;
                      const st = STATUS_BADGE[r.Status] || STATUS_BADGE.pending;
                      const isOpen = openRow === r.Id;
                      return (
                        <Fragment key={r.Id}>
                          <tr>
                            {showDecide && (
                              <td>
                                {r.Status === 'pending' && (
                                  <input
                                    type="checkbox"
                                    checked={selected.has(r.Id)}
                                    onChange={() => toggleRow(r.Id)}
                                    style={{ accentColor: '#007890', width: 15, height: 15 }}
                                  />
                                )}
                              </td>
                            )}
                            <td>
                              <div className="aps-td-strong">{r.Name}</div>
                              <div className="aps-meta">
                                <span className="aps-td-mono">{r.StaffNo || '—'}</span> · {r.Role}
                              </div>
                            </td>
                            <td className="aps-nowrap">
                              <div>{r.Site}</div>
                              <div className="aps-meta">{r.Service}</div>
                            </td>
                            <td>{r.LeaveType}</td>
                            <td className="aps-nowrap">
                              <div>{fmtRange(r.StartDate, r.EndDate)}</div>
                              <div className="aps-meta">{fmtDays(r.Days)}</div>
                            </td>
                            <td className="aps-nowrap">{fmtDays(r.BalanceDays)}</td>
                            <td>
                              <button
                                onClick={() => setOpenRow(isOpen ? null : r.Id)}
                                title="Why"
                                style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                              >
                                <span className={`aps-badge aps-badge--plain aps-badge--${cov.kind}`}>{cov.label}</span>
                                <i className={`fas fa-chevron-${isOpen ? 'up' : 'down'}`} style={{ fontSize: '0.6rem', color: '#9ca3af' }} />
                              </button>
                            </td>
                            <td>
                              {r.Status === 'pending' ? (
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    className="aps-btn aps-btn--primary"
                                    style={{ padding: '4px 9px' }}
                                    disabled={busy}
                                    onClick={() => decide(r.Id, 'approved')}
                                    title="Approve"
                                  >
                                    <i className="fas fa-check" />
                                  </button>
                                  <button
                                    className="aps-btn aps-btn--danger"
                                    style={{ padding: '4px 9px' }}
                                    disabled={busy}
                                    onClick={() => decide(r.Id, 'declined')}
                                    title="Decline"
                                  >
                                    <i className="fas fa-xmark" />
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Badge kind={st.kind}>{st.label}</Badge>
                                  <button
                                    className="aps-btn aps-btn--ghost"
                                    style={{ padding: '4px 8px' }}
                                    disabled={busy}
                                    onClick={() => decide(r.Id, 'pending')}
                                    title="Reopen"
                                  >
                                    <i className="fas fa-rotate-left" style={{ fontSize: '0.65rem' }} />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={showDecide ? 8 : 7} style={{ background: '#fafafa' }}>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                  <i
                                    className="fas fa-circle-info"
                                    style={{ color: KIND_COLOR[cov.kind], marginTop: 2 }}
                                  />
                                  <div>
                                    <div className="aps-note">{r.Impact}</div>
                                    {r.Status !== 'pending' && r.DecidedBy && (
                                      <div className="aps-meta" style={{ marginTop: 5 }}>
                                        {STATUS_BADGE[r.Status].label} by {r.DecidedBy}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, flexWrap: 'wrap', padding: '12px 16px', borderTop: '1px solid #f3f4f6',
              }}>
                <span className="aps-meta">
                  {data.total === 0
                    ? 'No requests'
                    : `${((data.page - 1) * data.pageSize + 1).toLocaleString()}–${Math.min(data.page * data.pageSize, data.total).toLocaleString()} of ${data.total.toLocaleString()}`}
                </span>
                {/* Wraps as well as the row above it: the six controls are a
                    486px line, so on a phone they have to fall onto a second
                    row rather than push the page sideways. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <select
                    className="aps-select"
                    style={{ width: 'auto' }}
                    value={data.pageSize}
                    onChange={(e) => set({ pageSize: Number(e.target.value) })}
                  >
                    {data.pageSizes.map((n) => <option key={n} value={n}>{n} per page</option>)}
                  </select>
                  <button className="aps-btn aps-btn--ghost" disabled={data.page <= 1} onClick={() => goPage(1)} title="First page">
                    <i className="fas fa-angles-left" />
                  </button>
                  <button className="aps-btn aps-btn--ghost" disabled={data.page <= 1} onClick={() => goPage(data.page - 1)}>
                    <i className="fas fa-chevron-left" /> Back
                  </button>
                  <span className="aps-meta" style={{ minWidth: 92, textAlign: 'center' }}>
                    Page {data.page} of {data.totalPages}
                  </span>
                  <button className="aps-btn aps-btn--ghost" disabled={data.page >= data.totalPages} onClick={() => goPage(data.page + 1)}>
                    Next <i className="fas fa-chevron-right" />
                  </button>
                  <button className="aps-btn aps-btn--ghost" disabled={data.page >= data.totalPages} onClick={() => goPage(data.totalPages)} title="Last page">
                    <i className="fas fa-angles-right" />
                  </button>
                </div>
              </div>
            </>
          )}
        </Card>

        <CoveragePanel />
      </div>
    </div>
  );
}

function SummaryTile({ label, value, note, icon, kind, active, onClick }) {
  const tint = {
    ok: 'rgba(16,185,129,0.12)', warn: '#fef3c7',
    bad: 'rgba(239,68,68,0.12)', info: '#e0f2f5',
  }[kind];
  return (
    <button
      onClick={onClick}
      className="aps-stat"
      style={{
        textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        border: active ? '1px solid #007890' : '1px solid transparent',
        boxShadow: active
          ? '0 0 0 3px #e6f3f7, 0 1px 2px rgba(0,0,0,.05)'
          : 'var(--aps-card-shadow)',
      }}
    >
      <div className="aps-stat-top">
        <span className="aps-stat-label">{label}</span>
        <div className="aps-stat-icon" style={{ background: tint }}>
          <i className={icon} style={{ color: KIND_COLOR[kind] }} />
        </div>
      </div>
      <div className="aps-stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="aps-stat-note">{note || (active ? 'Filtering by this' : 'Click to filter')}</div>
    </button>
  );
}

// Site coverage, worst first. At nearly forty placements the ones in trouble
// are the only ones worth putting at the top.
function CoveragePanel() {
  const [riskOnly, setRiskOnly] = useState(false);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(8);

  const load = useCallback(
    () => api.fsaLeaveCoverage({ q, risk: riskOnly, limit }),
    [q, riskOnly, limit]
  );
  const { data, error, loading, reload } = useFsa(load, [q, riskOnly, limit]);

  return (
    <Card
      title="Site coverage"
      note={data ? `${data.atRisk} at risk · ${data.watch} to watch · ${data.sites} sites` : null}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          className="aps-input"
          style={{ flex: '1 1 130px' }}
          placeholder="Find a site…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className={'aps-chip' + (riskOnly ? ' active' : '')}
          onClick={() => setRiskOnly((v) => !v)}
        >
          Needs attention
        </button>
      </div>

      {loading && <Spinner />}
      {error && <ErrorNote error={error} onRetry={reload} />}

      {data && !loading && (
        <>
          <div className="aps-stack" style={{ gap: 13 }}>
            {data.rows.length === 0 && <div className="aps-meta">No site matches that.</div>}
            {data.rows.map((c) => (
              <div key={c.Site}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#111827' }}>{c.Site}</span>
                  <Badge kind={c.Kind}>{c.Badge}</Badge>
                </div>
                <Bar pct={c.Pct} color={KIND_COLOR[c.Kind]} />
                <div className="aps-meta" style={{ marginTop: 3 }}>{c.Detail}</div>
              </div>
            ))}
          </div>

          {data.rows.length >= limit && (
            <button
              className="aps-btn aps-btn--ghost"
              style={{ width: '100%', marginTop: 14 }}
              onClick={() => setLimit((n) => n + 12)}
            >
              Show more sites
            </button>
          )}
        </>
      )}
    </Card>
  );
}
