import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { SpiderChart, BarList } from './charts.jsx';
import { api } from '../api.js';

const band = (v) => (v == null ? 'na' : v >= 70 ? 'good' : v <= 40 ? 'bad' : 'mid');

// Circular score gauge for the hero. `pct` 0–100, coloured by band.
function ScoreRing({ pct, label, sub }) {
  const size = 132, stroke = 12, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const val = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="score-ring">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-tinted)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          className={`score-ring-arc score-ring-${band(pct)}`}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(val / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="score-ring-num">
          {pct == null ? '—' : `${pct}%`}
        </text>
        <text x="50%" y="63%" textAnchor="middle" dominantBaseline="middle" className="score-ring-cap">{label}</text>
      </svg>
      {sub && <div className="score-ring-sub">{sub}</div>}
    </div>
  );
}

// Per-employee KPI performance analysis. Charts where the employee is strong /
// weak (manager score per KPA + per KPI), overlays their own self-assessment
// so the perception gap is visible, tracks the overall trend across periods,
// and downloads the signed KPI document.
export default function EmployeeAnalysisModal({ employee, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [reviewIdx, setReviewIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr('');
    api.getEmployeePerformance(employee.id)
      .then((res) => { if (!cancelled) { setData(res); setReviewIdx(0); } })
      .catch((e)   => { if (!cancelled) setErr(e.message); })
      .finally(()  => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employee.id]);

  const reviews = data?.reviews || [];
  const selected = reviews[reviewIdx] || null;

  const view = useMemo(() => {
    if (!selected) return null;
    const kpas = selected.kpas || [];
    const ratedKpas = kpas.filter((k) => k.avgPct != null);
    const kpaRadar = ratedKpas.map((k) => ({ area: k.area || 'KPA', value: k.avgPct }));
    const selfComplete = ratedKpas.length > 0 && ratedKpas.every((k) => k.selfAvgPct != null);
    const kpaRadarSelf = selfComplete ? ratedKpas.map((k) => ({ area: k.area || 'KPA', value: k.selfAvgPct })) : null;
    const kpaBars = ratedKpas.map((k) => ({ label: k.area || 'KPA', value: k.avgPct, self: k.selfAvgPct, gap: k.gap }));

    const strongest = ratedKpas.length ? ratedKpas.reduce((a, b) => (b.avgPct > a.avgPct ? b : a)) : null;
    const focus = ratedKpas.length ? ratedKpas.reduce((a, b) => (b.avgPct < a.avgPct ? b : a)) : null;

    const flat = kpas.flatMap((k) => (k.kpis || []).map((x) => ({ ...x, area: k.area || 'KPA' })));
    const gapKpis = flat.filter((x) => x.gap != null);
    const biggestGap = gapKpis.length ? gapKpis.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a)) : null;

    const rankable = flat.filter((x) => x.pct != null);
    const toItem = (x) => ({ label: x.description || '—', value: x.pct, self: x.selfPct, gap: x.gap, caption: x.area });
    const strengths = rankable.filter((x) => x.pct >= 70).sort((a, b) => b.pct - a.pct).slice(0, 6).map(toItem);
    const attention = rankable.filter((x) => x.pct < 55).sort((a, b) => a.pct - b.pct).slice(0, 6).map(toItem);
    const allByScore = [...rankable].sort((a, b) => b.pct - a.pct).map(toItem);

    return { kpaRadar, kpaRadarSelf, kpaBars, strongest, focus, biggestGap, strengths, attention, allByScore };
  }, [selected]);

  const trend = useMemo(
    () => reviews
      .filter((r) => (r.weightedPct ?? r.overallPct) != null)
      .slice().reverse()
      .map((r) => ({ label: r.periodLabel || '—', value: r.weightedPct ?? r.overallPct })),
    [reviews],
  );

  async function download(reviewId) {
    setBusyId(reviewId); setErr('');
    try {
      const { blob, filename } = await api.downloadReviewDocument(reviewId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { setErr(e.message); }
    finally { setBusyId(null); }
  }

  const firstName = employee.name.split(' ')[0];
  const gapWord = (g) => (g > 0 ? 'manager scored higher' : 'self-rated higher');

  return (
    <Modal title={`Performance — ${employee.name}`} onClose={onClose} cardClassName="modal-wide">
      {loading && <div className="muted">Loading performance…</div>}
      {err && <div className="error" onClick={() => setErr('')}>{err}</div>}

      {!loading && reviews.length === 0 && (
        <div className="empty-state">
          <p>No completed KPI reviews yet.</p>
          <p className="muted">Once a review is finalised in the joint session, {firstName}’s
            KPA and KPI performance will be charted here.</p>
        </div>
      )}

      {!loading && selected && view && (
        <div className="perf-analysis">
          <div className="perf-toolbar">
            <label className="perf-period-picker">
              <span className="muted">Review period</span>
              <select value={reviewIdx} onChange={(e) => setReviewIdx(Number(e.target.value))}>
                {reviews.map((r, i) => (
                  <option key={r.id} value={i}>
                    {r.periodLabel}{(r.weightedPct ?? r.overallPct) != null ? ` · ${r.weightedPct ?? r.overallPct}%` : ''}
                  </option>
                ))}
              </select>
            </label>
            {selected.managerName && <span className="muted">Reviewed by {selected.managerName}</span>}
          </div>

          {/* Hero: weighted overall gauge + supporting figures */}
          <section className="perf-hero">
            <ScoreRing pct={selected.weightedPct ?? selected.overallPct} label="Overall" sub="weighted by KPA" />
            <div className="perf-hero-figures">
              <div className="perf-figure">
                <span className="perf-figure-val">{selected.overallPct == null ? '—' : `${selected.overallPct}%`}</span>
                <span className="perf-figure-lbl">Manager · flat average</span>
              </div>
              <div className="perf-figure">
                <span className="perf-figure-val perf-figure-self">{selected.selfOverallPct == null ? '—' : `${selected.selfOverallPct}%`}</span>
                <span className="perf-figure-lbl">Self-assessment</span>
              </div>
              {selected.overallPct != null && selected.selfOverallPct != null && (
                <div className="perf-figure">
                  <span className={`perf-figure-val ${selected.overallPct - selected.selfOverallPct >= 0 ? 'perf-gap-up' : 'perf-gap-down'}`}>
                    {selected.overallPct - selected.selfOverallPct > 0 ? '+' : ''}{selected.overallPct - selected.selfOverallPct} pts
                  </span>
                  <span className="perf-figure-lbl">Perception gap</span>
                </div>
              )}
            </div>
          </section>

          {/* Key insight cards — compact, three across */}
          <div className="perf-insights">
            {view.strongest && (
              <div className="perf-insight perf-insight-good">
                <div className="perf-insight-tag">Strongest area</div>
                <div className="perf-insight-title">{view.strongest.area}</div>
                <div className="perf-insight-val">{view.strongest.avgPct}%</div>
              </div>
            )}
            {view.focus && view.focus !== view.strongest && (
              <div className="perf-insight perf-insight-bad">
                <div className="perf-insight-tag">Focus area</div>
                <div className="perf-insight-title">{view.focus.area}</div>
                <div className="perf-insight-val">{view.focus.avgPct}%</div>
              </div>
            )}
            {view.biggestGap && view.biggestGap.gap !== 0 && (
              <div className="perf-insight perf-insight-gap">
                <div className="perf-insight-tag">Biggest perception gap</div>
                <div className="perf-insight-title perf-insight-title-2" title={view.biggestGap.description}>{view.biggestGap.description}</div>
                <div className="perf-insight-val">{view.biggestGap.gap > 0 ? '+' : ''}{Math.round(view.biggestGap.gap)} pts · {gapWord(view.biggestGap.gap)}</div>
              </div>
            )}
          </div>

          {/* Radar gets the stage — paired with exact per-KPA scores */}
          <section className="perf-card perf-radar-section">
            <h3>Performance by KPA</h3>
            <p className="muted perf-card-sub">Manager score per key performance area{view.kpaRadarSelf ? ', overlaid with the employee’s self-view' : ''}.</p>
            {view.kpaRadar.length > 0 ? (
              <div className="perf-radar-layout">
                <div className="perf-radar-main">
                  <SpiderChart data={view.kpaRadar} compare={view.kpaRadarSelf} unit="%" forceMax={100} primaryLabel="Manager" compareLabel="Self" />
                </div>
                <div className="perf-radar-side">
                  <div className="perf-radar-side-title">Score by area</div>
                  <BarList items={view.kpaBars} />
                </div>
              </div>
            ) : (
              <div className="muted">No rated KPAs in this review.</div>
            )}
          </section>

          {/* KPI breakdown — full width so descriptions read in full */}
          <section className="perf-card">
            {view.strengths.length && view.attention.length ? (
              <div className="perf-kpi-split">
                <div className="perf-kpi-col">
                  <h3>Strengths</h3>
                  <p className="muted perf-card-sub">KPIs rated 70%+ (tick = self-rating).</p>
                  <BarList items={view.strengths} />
                </div>
                <div className="perf-kpi-col">
                  <h3>Needs attention</h3>
                  <p className="muted perf-card-sub">KPIs rated below 55%.</p>
                  <BarList items={view.attention} />
                </div>
              </div>
            ) : (
              <>
                <h3>Performance by KPI</h3>
                <p className="muted perf-card-sub">Manager score per KPI (tick = self-rating).</p>
                <BarList items={view.allByScore} />
              </>
            )}
          </section>

          {trend.length > 1 && (
            <section className="perf-card">
              <h3>Overall trend</h3>
              <p className="muted perf-card-sub">Weighted overall score across review periods.</p>
              <BarList items={trend} />
            </section>
          )}

          <section className="perf-card">
            <h3>KPI documents</h3>
            <p className="muted perf-card-sub">Download the branded, signature-controlled KPI review document.</p>
            <ul className="perf-doc-list">
              {reviews.map((r) => (
                <li key={r.id} className="perf-doc-row">
                  <div className="perf-doc-meta">
                    <span className="perf-doc-period">{r.periodLabel}</span>
                    {r.managerName && <span className="muted"> · {r.managerName}</span>}
                    {(r.weightedPct ?? r.overallPct) != null && <span className="perf-doc-score"> · {r.weightedPct ?? r.overallPct}%</span>}
                  </div>
                  <button className="btn-ghost" disabled={busyId === r.id} onClick={() => download(r.id)}>
                    {busyId === r.id ? 'Preparing…' : 'Download PDF'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
