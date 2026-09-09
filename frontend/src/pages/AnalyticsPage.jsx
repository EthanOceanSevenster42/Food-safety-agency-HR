import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const STAGE_LABELS = {
  booked_in: 'Booked In',
  out_for_dispatch: 'Out for Dispatch',
  at_supplier: 'At Supplier',
  received_back: 'Received Back',
};

function formatMoney(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return 'R ' + Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatMonths(m) {
  if (m == null) return '—';
  if (m < 0) return `${Math.abs(Math.round(m * 10) / 10)} mo overdue`;
  return `${Math.round(m * 10) / 10} mo`;
}

function eolBadgeClass(months) {
  if (months == null) return '';
  if (months < 0) return 'eol-badge eol-overdue';
  if (months <= 3) return 'eol-badge eol-critical';
  if (months <= 6) return 'eol-badge eol-warning';
  return 'eol-badge eol-watch';
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [department, setDepartment] = useState('');
  const [eolWindow, setEolWindow] = useState(12);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const out = await api.getAnalytics({
        companyId: companyId ? Number(companyId) : null,
        department: department || null,
        eolWindow,
      });
      setData(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [companyId, department, eolWindow]);

  const filtersActive = !!(companyId || department || eolWindow !== 12);

  const statusMix = useMemo(() => {
    if (!data) return [];
    const t = data.totals;
    const total = t.allocatedCount + t.inStorageCount + t.inRepairsCount;
    if (total === 0) return [];
    return [
      { key: 'allocated', label: 'Allocated', count: t.allocatedCount, color: '#088298' },
      { key: 'storage',   label: 'In storage', count: t.inStorageCount, color: '#6B7B82' },
      { key: 'repairs',   label: 'In repairs', count: t.inRepairsCount, color: '#E08A00' },
    ].map((s) => ({ ...s, pct: (s.count / total) * 100 }));
  }, [data]);

  const repairStages = useMemo(() => {
    if (!data) return [];
    const p = data.repairPipeline;
    return Object.entries(STAGE_LABELS).map(([key, label]) => ({ key, label, count: p[key] || 0 }));
  }, [data]);

  if (loading && !data) {
    return <div className="page"><div className="muted">Loading analytics…</div></div>;
  }
  if (error && !data) {
    return <div className="page"><div className="error">{error}</div></div>;
  }
  if (!data) return null;

  const { totals, byCompany, byCategory, byDepartment, endOfLifeSoon, dispatchQueue, catalog } = data;

  return (
    <div className="page analytics-page">
      <header className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Snapshot of your fleet, value, repairs, and items approaching end-of-life.</p>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="filters-bar">
        <select className="filters-category" value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Filter by company">
          <option value="">All companies</option>
          {catalog.companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="filters-category" value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {catalog.departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="filters-category" value={eolWindow} onChange={(e) => setEolWindow(Number(e.target.value))} aria-label="End-of-life window">
          <option value={3}>EoL within 3 months</option>
          <option value={6}>EoL within 6 months</option>
          <option value={12}>EoL within 12 months</option>
          <option value={24}>EoL within 24 months</option>
        </select>
        {filtersActive && (
          <button className="btn-ghost filters-clear" onClick={() => { setCompanyId(''); setDepartment(''); setEolWindow(12); }}>
            Clear filters
          </button>
        )}
      </div>

      <section className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total assets</div>
          <div className="kpi-value">{totals.assetCount}</div>
          <div className="kpi-sub muted">{totals.allocatedCount} allocated · {totals.inStorageCount} in storage</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Fleet value (current book)</div>
          <div className="kpi-value">{formatMoney(totals.totalBookValue)}</div>
          <div className="kpi-sub muted">Original spend {formatMoney(totals.totalPurchaseValue)}</div>
        </div>
        <div className="kpi-card kpi-warn">
          <div className="kpi-label">Active repairs</div>
          <div className="kpi-value">{totals.inRepairsCount}</div>
          <div className="kpi-sub muted">{dispatchQueue.length} need to be sent to supplier</div>
        </div>
        <div className="kpi-card kpi-danger">
          <div className="kpi-label">Approaching end-of-life</div>
          <div className="kpi-value">{totals.endOfLifeWithin + totals.endOfLifeOverdue}</div>
          <div className="kpi-sub muted">{totals.endOfLifeOverdue} already past · within {eolWindow}mo</div>
        </div>
      </section>

      <section className="analytics-row">
        <div className="analytics-card">
          <div className="analytics-card-head">
            <h2>Status mix</h2>
            <span className="muted small">Across {totals.assetCount} assets</span>
          </div>
          {statusMix.length === 0 ? (
            <div className="muted">No assets in scope.</div>
          ) : (
            <>
              <div className="status-bar">
                {statusMix.map((s) => (
                  <div
                    key={s.key}
                    title={`${s.label}: ${s.count}`}
                    style={{ width: s.pct + '%', backgroundColor: s.color }}
                  />
                ))}
              </div>
              <ul className="status-legend">
                {statusMix.map((s) => (
                  <li key={s.key}>
                    <span className="status-dot" style={{ background: s.color }} />
                    <strong>{s.count}</strong> {s.label}
                    <span className="muted"> · {Math.round(s.pct)}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head">
            <h2>Repair pipeline</h2>
            <span className="muted small">By stage</span>
          </div>
          {totals.inRepairsCount === 0 ? (
            <div className="muted">No active repairs.</div>
          ) : (
            <ul className="repair-pipeline-list">
              {repairStages.map((s) => (
                <li key={s.key}>
                  <span className={'pipeline-pill stage-' + s.key}>{s.count}</span>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          )}
          {dispatchQueue.length > 0 && (
            <div className="dispatch-callout">
              <strong>{dispatchQueue.length} item{dispatchQueue.length === 1 ? '' : 's'} waiting to dispatch</strong>
              <ul>
                {dispatchQueue.slice(0, 5).map((d) => (
                  <li key={d.id}>
                    <span>{d.name}</span>
                    <span className="muted">· {d.companyName}{d.daysWaiting != null ? ` · ${d.daysWaiting}d waiting` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="analytics-card">
        <div className="analytics-card-head">
          <h2>Per company</h2>
          <span className="muted small">Asset count, fleet value &amp; status</span>
        </div>
        {byCompany.length === 0 ? (
          <div className="muted">No data.</div>
        ) : (
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Assets</th>
                <th className="num">Allocated</th>
                <th className="num">In storage</th>
                <th className="num">In repairs</th>
                <th className="num">EoL ≤{eolWindow}mo</th>
                <th className="num">Purchase value</th>
                <th className="num">Book value</th>
              </tr>
            </thead>
            <tbody>
              {byCompany.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="company-cell">
                      {c.logoUrl
                        ? <img src={c.logoUrl} alt={c.name} className="company-cell-logo" />
                        : <span className="company-cell-logo placeholder" style={{ background: c.brandColor || '#088298' }}>{c.name.slice(0, 2).toUpperCase()}</span>}
                      <span>{c.name}</span>
                    </div>
                  </td>
                  <td className="num">{c.assetCount}</td>
                  <td className="num">{c.allocated}</td>
                  <td className="num">{c.storage}</td>
                  <td className="num">{c.inRepairs}</td>
                  <td className="num">{c.eolSoon}</td>
                  <td className="num mono">{formatMoney(c.purchaseValue)}</td>
                  <td className="num mono">{formatMoney(c.bookValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="analytics-row">
        <div className="analytics-card">
          <div className="analytics-card-head">
            <h2>By category</h2>
          </div>
          {byCategory.length === 0 ? <div className="muted">No data.</div> : (
            <ul className="bar-list">
              {byCategory.map((c) => {
                const max = byCategory[0].count;
                const pct = (c.count / max) * 100;
                return (
                  <li key={c.category}>
                    <div className="bar-list-row">
                      <span>{c.category}</span>
                      <span className="muted small mono">{c.count} · {formatMoney(c.bookValue)}</span>
                    </div>
                    <div className="bar-list-track"><div className="bar-list-fill" style={{ width: pct + '%' }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head">
            <h2>By department</h2>
            <span className="muted small">Owner's department</span>
          </div>
          {byDepartment.length === 0 ? <div className="muted">No data.</div> : (
            <ul className="bar-list">
              {byDepartment.map((d) => {
                const max = byDepartment[0].count;
                const pct = (d.count / max) * 100;
                return (
                  <li key={d.department}>
                    <div className="bar-list-row">
                      <span>{d.department}</span>
                      <span className="muted small mono">{d.count} · {formatMoney(d.bookValue)}</span>
                    </div>
                    <div className="bar-list-track"><div className="bar-list-fill" style={{ width: pct + '%' }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="analytics-card">
        <div className="analytics-card-head">
          <h2>Approaching end of life</h2>
          <span className="muted small">Sorted by months remaining (negative = overdue)</span>
        </div>
        {endOfLifeSoon.length === 0 ? (
          <div className="muted">Nothing within the {eolWindow}-month window.</div>
        ) : (
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Company</th>
                <th>Owner</th>
                <th>Purchased</th>
                <th className="num">Book value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {endOfLifeSoon.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="strong">{a.name}</div>
                    <div className="muted small">{a.category}{a.type ? ' · ' + a.type : ''}</div>
                  </td>
                  <td>{a.companyName}</td>
                  <td>{a.ownerName || <span className="muted">In storage</span>}</td>
                  <td>{a.purchaseDate ? new Date(a.purchaseDate).toLocaleDateString() : '—'}</td>
                  <td className="num mono">{formatMoney(a.bookValue)}</td>
                  <td><span className={eolBadgeClass(a.monthsRemaining)}>{formatMonths(a.monthsRemaining)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
