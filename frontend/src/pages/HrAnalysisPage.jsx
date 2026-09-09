import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import CompanyGrid from '../components/CompanyGrid.jsx';
import { SpiderChart } from '../components/charts.jsx';
import EmployeeAnalysisModal from '../components/EmployeeAnalysisModal.jsx';

// Colour band for a 0–100 rating (matches EmployeeAnalysisModal).
const band = (v) => (v == null ? 'na' : v >= 70 ? 'good' : v <= 40 ? 'bad' : 'mid');

// HR Analysis — shows where the company's KPA focus sits (spider chart),
// ranks employees by average KPI rating (top + lower performers), and lists
// every employee's KPI rating. Clicking any employee opens their full
// per-KPI breakdown (actual manager rating vs each KPI + self-assessment).
export default function HrAnalysisPage() {
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [analysisTarget, setAnalysisTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.listCompanies()
      .then((list) => { if (!cancelled) setCompanies(Array.isArray(list) ? list : []); })
      .catch((e)   => { if (!cancelled) setErr(e.message); })
      .finally(()  => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setAnalytics(null); return; }
    let cancelled = false;
    setLoading(true);
    setErr('');
    api.getKpiAnalytics(selectedId)
      .then((res) => { if (!cancelled) setAnalytics(res); })
      .catch((e)   => { if (!cancelled) setErr(e.message); })
      .finally(()  => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const selectedCompany = companies.find((c) => c.id === selectedId) || null;

  const openAnalysis = (entry) => {
    if (entry.employeeId == null) return; // unassigned KPA buckets aren't real employees
    setAnalysisTarget({ id: entry.employeeId, name: entry.employeeName });
  };

  // Split performers into ranked / not-yet-rated buckets for the highlight
  // cards, then build a full roster (rated first, then unrated by name) for
  // the "all employees" table.
  const { topPerformers, lowerPerformers, roster } = useMemo(() => {
    if (!analytics?.performers) return { topPerformers: [], lowerPerformers: [], roster: [] };
    const named = analytics.performers.filter((p) => p.employeeId != null);
    const rated = named.filter((p) => p.averageRating != null);
    const notRated = named.filter((p) => p.averageRating == null && p.kpiCount > 0);
    const byScoreDesc = [...rated].sort((a, b) => b.averageRating - a.averageRating);
    const byScoreAsc  = [...rated].sort((a, b) => a.averageRating - b.averageRating);
    const byName = [...notRated].sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));
    return {
      topPerformers:   byScoreDesc.slice(0, 5),
      lowerPerformers: byScoreAsc.slice(0, 5),
      roster: [...byScoreDesc, ...byName],
    };
  }, [analytics]);

  if (!selectedId) {
    return (
      <div className="hr-analysis-shell">
        <header className="page-header">
          <h1>HR Analysis</h1>
          <p className="muted">Pick a company to see its KPA focus and performer rankings.</p>
        </header>
        {err && <div className="error">{err}</div>}
        {loading
          ? <div className="muted">Loading companies…</div>
          : <CompanyGrid companies={companies} onSelect={(c) => setSelectedId(c.id)} />}
      </div>
    );
  }

  return (
    <div className="hr-analysis-shell">
      <header className="hr-analysis-header">
        <button type="button" className="btn-ghost" onClick={() => setSelectedId(null)}>← Back to companies</button>
        <h1 style={{ margin: 0 }}>{selectedCompany?.name || 'Analysis'}</h1>
      </header>

      {err && <div className="error">{err}</div>}
      {loading ? (
        <div className="muted">Loading analytics…</div>
      ) : !analytics ? null : (
        <>
          <section className="hr-analysis-card">
            <div className="hr-analysis-card-head">
              <h2>Current focus</h2>
              <span className="muted small">Total weight per area, summed across every KPA task in this company.</span>
            </div>
            <SpiderChart data={analytics.focusByArea} />
          </section>

          <div className="hr-analysis-grid">
            <PerformersCard
              title="Top performers"
              subtitle="Highest average KPI rating across their KPAs."
              entries={topPerformers}
              tone="good"
              onSelect={openAnalysis}
            />
            <PerformersCard
              title="Lower performers"
              subtitle="Lowest average KPI rating across their KPAs."
              entries={lowerPerformers}
              tone="bad"
              onSelect={openAnalysis}
            />
          </div>

          <section className="hr-analysis-card">
            <div className="hr-analysis-card-head">
              <h2>All employees — KPI ratings</h2>
              <span className="muted small">Every employee's overall KPI rating. Click a row to see the actual rating against each KPI.</span>
            </div>
            {roster.length === 0 ? (
              <div className="muted">No employees with KPAs on file for this company.</div>
            ) : (
              <ol className="hr-perf-list">
                {roster.map((p, i) => (
                  <PerfRow key={`${p.employeeId}-${i}`} rank={i + 1} entry={p} onSelect={openAnalysis} />
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      {analysisTarget && (
        <EmployeeAnalysisModal
          employee={analysisTarget}
          onClose={() => setAnalysisTarget(null)}
        />
      )}
    </div>
  );
}

// One employee row. Clickable when it maps to a real employee — opens the
// per-KPI performance modal. Score is coloured by band; unrated shows "—".
function PerfRow({ rank, entry, onSelect, tone }) {
  const rated = entry.averageRating != null;
  const clickable = entry.employeeId != null && !!onSelect;
  const activate = clickable ? () => onSelect(entry) : undefined;
  const scoreClass = 'hr-perf-score hr-perf-score-' + (tone || band(entry.averageRating));
  const sub = rated
    ? `${entry.ratedCount} of ${entry.kpiCount} KPI${entry.kpiCount === 1 ? '' : 's'} rated`
    : `${entry.kpiCount} KPI${entry.kpiCount === 1 ? '' : 's'} across ${entry.kpaCount} KPA${entry.kpaCount === 1 ? '' : 's'} · not yet rated`;
  return (
    <li
      className={'hr-perf-row' + (clickable ? ' hr-perf-row-click' : '')}
      onClick={activate}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? 'View KPI ratings vs targets' : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } } : undefined}
    >
      <span className="hr-perf-rank">{rank}</span>
      <div className="hr-perf-meta">
        <div><strong>{entry.employeeName}</strong></div>
        <div className="muted small">{sub}</div>
      </div>
      <span className={scoreClass}>{rated ? `${entry.averageRating.toFixed(1)}%` : '—'}</span>
    </li>
  );
}

function PerformersCard({ title, subtitle, entries, tone, onSelect }) {
  return (
    <section className="hr-analysis-card">
      <div className="hr-analysis-card-head">
        <h2>{title}</h2>
        <span className="muted small">{subtitle}</span>
      </div>
      {entries.length === 0 ? (
        <div className="muted">No ratings yet.</div>
      ) : (
        <ol className="hr-perf-list">
          {entries.map((p, i) => (
            <PerfRow key={`${p.employeeId}-${i}`} rank={i + 1} entry={p} tone={tone} onSelect={onSelect} />
          ))}
        </ol>
      )}
    </section>
  );
}
