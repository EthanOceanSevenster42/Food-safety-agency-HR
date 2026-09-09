import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

// Editor for a KPA-formulation task. Replaces the SOW editor when the
// underlying process row has Kind='kpa'. Captures:
//   - which employee the task is for (single select, scoped to the
//     process's owning company)
//   - an open-ended list of Key Performance Areas. Each KPA is a card of:
//       { weight, name (area), coreValues, kpis: [{ description, measures }] }
//     i.e. a KPA holds many KPIs, and each KPI holds many measures.
// "Area" and "Core values" are sourced from the owning company's branding
// (CompanyModal: departments / Area + Core values). Weights are summed
// live below the list; if not exactly 100 a soft warning shows but the
// save is still allowed.
export default function KpaEditorModal({ processId, processName, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  const [employees, setEmployees] = useState([]);
  const [facets, setFacets]       = useState([]);
  const [coreValuesList, setCoreValuesList] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [rows, setRows]             = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    (async () => {
      try {
        const data = await api.getKpa(processId);
        if (cancelled) return;
        setEmployeeId(data.employeeId ? String(data.employeeId) : '');
        setRows(
          Array.isArray(data.kpas) && data.kpas.length
            ? data.kpas.map(normaliseLoadedRow)
            : [blankRow()],
        );

        const [emps, companies] = await Promise.all([
          api.listEmployees(data.companyId),
          api.listCompanies(),
        ]);
        if (cancelled) return;
        setEmployees(Array.isArray(emps) ? emps : []);
        const me = (Array.isArray(companies) ? companies : []).find((c) => c.id === data.companyId);
        setFacets(Array.isArray(me?.companyFacets) ? me.companyFacets : []);
        setCoreValuesList(Array.isArray(me?.coreValues) ? me.coreValues : []);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load KPA data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [processId]);

  // ---------- Shape helpers ----------
  function blankKpi() { return { description: '', measures: [''], rating: '' }; }
  function blankRow() {
    return { name: '', weight: '', coreValues: [], kpis: [blankKpi()] };
  }
  // Normalise a server-returned KPA row into the editor's working shape.
  // The server already promotes legacy `kpi`+`measures` into a single-
  // element `kpis` array, but we still defensively handle the flat shape
  // here in case the API contract drifts. The per-KPI `rating` (0-100)
  // is optional — empty string when not yet set.
  function normaliseLoadedRow(k) {
    const kpisRaw = Array.isArray(k.kpis) ? k.kpis : (
      k.kpi || (Array.isArray(k.measures) && k.measures.length)
        ? [{ description: k.kpi || '', measures: Array.isArray(k.measures) ? k.measures : [] }]
        : []
    );
    const kpis = kpisRaw.length ? kpisRaw.map((kk) => ({
      description: typeof kk.description === 'string' ? kk.description : '',
      // Always leave at least one editable bullet so the user has somewhere to type.
      measures: Array.isArray(kk.measures) && kk.measures.length ? kk.measures : [''],
      rating: kk.rating == null ? '' : kk.rating,
    })) : [blankKpi()];
    return {
      name: k.name || k.department || '',
      weight: k.weight ?? '',
      coreValues: Array.isArray(k.coreValues) ? k.coreValues : [],
      kpis,
    };
  }

  // ---------- KPA-row mutators ----------
  function updateRow(idx, patch) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow()    { setRows((prev) => [...prev, blankRow()]); }
  function removeRow(idx) { setRows((prev) => prev.filter((_, i) => i !== idx)); }

  function toggleCoreValue(rowIdx, value) {
    setRows((prev) => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const set = new Set(r.coreValues || []);
      if (set.has(value)) set.delete(value); else set.add(value);
      return { ...r, coreValues: [...set] };
    }));
  }

  // ---------- KPI sub-list mutators ----------
  function updateKpi(rowIdx, kpiIdx, patch) {
    setRows((prev) => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      return { ...r, kpis: r.kpis.map((kk, j) => (j === kpiIdx ? { ...kk, ...patch } : kk)) };
    }));
  }
  function addKpi(rowIdx) {
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, kpis: [...r.kpis, blankKpi()] } : r)));
  }
  function removeKpi(rowIdx, kpiIdx) {
    setRows((prev) => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const next = r.kpis.filter((_, j) => j !== kpiIdx);
      // Keep at least one KPI card so the user always sees somewhere to type.
      return { ...r, kpis: next.length ? next : [blankKpi()] };
    }));
  }

  // ---------- Measures (per-KPI) mutators ----------
  function updateMeasure(rowIdx, kpiIdx, mIdx, value) {
    setRows((prev) => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      return {
        ...r,
        kpis: r.kpis.map((kk, j) => {
          if (j !== kpiIdx) return kk;
          return { ...kk, measures: kk.measures.map((m, k) => (k === mIdx ? value : m)) };
        }),
      };
    }));
  }
  function addMeasure(rowIdx, kpiIdx) {
    setRows((prev) => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      return {
        ...r,
        kpis: r.kpis.map((kk, j) => (j === kpiIdx ? { ...kk, measures: [...kk.measures, ''] } : kk)),
      };
    }));
  }
  function removeMeasure(rowIdx, kpiIdx, mIdx) {
    setRows((prev) => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      return {
        ...r,
        kpis: r.kpis.map((kk, j) => {
          if (j !== kpiIdx) return kk;
          const next = kk.measures.filter((_, k) => k !== mIdx);
          return { ...kk, measures: next.length ? next : [''] };
        }),
      };
    }));
  }

  // Live total of all numeric weights — drives the soft-warning footer.
  // Empty strings and non-numerics contribute 0 so a half-typed row
  // doesn't make the badge flicker red.
  const total = useMemo(() => {
    return rows.reduce((s, r) => {
      const n = Number(r.weight);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [rows]);
  const totalOk = Math.abs(total - 100) < 0.001;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const payload = {
        employeeId: employeeId ? parseInt(employeeId, 10) : null,
        kpas: rows
          .map((r) => ({
            name: (r.name || '').trim(),
            weight: r.weight === '' || r.weight == null ? 0 : Number(r.weight),
            coreValues: (r.coreValues || []).map((v) => String(v).trim()).filter(Boolean),
            kpis: (r.kpis || [])
              .map((kk) => {
                const out = {
                  description: (kk.description || '').trim(),
                  measures: (kk.measures || []).map((m) => String(m).trim()).filter(Boolean),
                };
                // Only persist a rating when the reviewer has actually
                // set one — empty string / null stays absent so the
                // analytics page can distinguish "not yet rated" from 0.
                if (kk.rating !== '' && kk.rating != null && !Number.isNaN(Number(kk.rating))) {
                  out.rating = Math.min(100, Math.max(0, Number(kk.rating)));
                }
                return out;
              })
              .filter((kk) => kk.description || kk.measures.length || kk.rating != null),
          }))
          .filter((r) => r.name || r.weight || r.coreValues.length || r.kpis.length),
      };
      const saved = await api.saveKpa(processId, payload);
      onSaved?.(saved);
      onClose();
    } catch (e2) {
      setErr(e2.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={processName || 'KPA formulation'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        {loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="kpa-employee">Employee</label>
              <select
                id="kpa-employee"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">— Select an employee —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}{emp.title ? ` · ${emp.title}` : ''}
                  </option>
                ))}
              </select>
              {employees.length === 0 && (
                <small className="muted">No employees yet for this company.</small>
              )}
            </div>

            <div className="modal-section-title">Key Performance Areas</div>
            <small className="muted" style={{ display: 'block', marginBottom: 10 }}>
              For each KPA, set a weight, pick the company area, tag the core values it ties to, then list one or more KPIs underneath — each with its own set of measures. Weights should sum to <strong>100%</strong>.
            </small>

            {facets.length === 0 && (
              <div className="muted small" style={{ marginBottom: 8 }}>
                No company areas configured yet. Add them under <em>Edit Company Branding → Company departments / Area</em>.
              </div>
            )}
            {coreValuesList.length === 0 && (
              <div className="muted small" style={{ marginBottom: 8 }}>
                No core values configured yet. Add them under <em>Edit Company Branding → Core values</em>.
              </div>
            )}

            <div className="kpa-cards">
              {rows.map((r, idx) => (
                <div key={idx} className="kpa-card">
                  <div className="kpa-card-head">
                    <div className="kpa-weight">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={r.weight}
                        onChange={(e) => updateRow(idx, { weight: e.target.value })}
                        placeholder="0"
                        aria-label="Weight %"
                      />
                      <span className="kpa-weight-suffix">%</span>
                    </div>

                    <select
                      className="kpa-area"
                      value={r.name}
                      onChange={(e) => updateRow(idx, { name: e.target.value })}
                      aria-label="KPA / area"
                    >
                      <option value="">— Select an area —</option>
                      {facets.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                      {r.name && !facets.includes(r.name) && (
                        <option value={r.name}>{r.name} (removed)</option>
                      )}
                    </select>

                    <div className="kpa-cv">
                      <span className="kpa-cv-label">Core values</span>
                      <div className="kpa-cv-chips" role="group" aria-label="Core values tied to this KPA">
                        {coreValuesList.length === 0 && (
                          <span className="muted small">— none configured —</span>
                        )}
                        {coreValuesList.map((cv) => {
                          const on = (r.coreValues || []).includes(cv);
                          return (
                            <button
                              key={cv}
                              type="button"
                              className={'kpa-cv-chip' + (on ? ' is-on' : '')}
                              aria-pressed={on}
                              onClick={() => toggleCoreValue(idx, cv)}
                            >
                              {cv}
                            </button>
                          );
                        })}
                        {(r.coreValues || [])
                          .filter((v) => !coreValuesList.includes(v))
                          .map((v) => (
                            <button
                              key={`stale-${v}`}
                              type="button"
                              className="kpa-cv-chip is-on kpa-cv-chip-stale"
                              aria-pressed="true"
                              onClick={() => toggleCoreValue(idx, v)}
                              title="No longer in the company's core values"
                            >
                              {v} (removed)
                            </button>
                          ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn-icon btn-icon-danger kpa-card-remove"
                      title="Remove KPA"
                      onClick={() => removeRow(idx)}
                      aria-label={`Remove KPA ${idx + 1}`}
                    >
                      ×
                    </button>
                  </div>

                  {/* KPIs under this KPA — each its own sub-card with a
                      description + its own measures bullet list. */}
                  <div className="kpa-kpis">
                    <div className="kpa-kpis-label">KPIs</div>
                    {r.kpis.map((kk, kIdx) => (
                      <div key={kIdx} className="kpa-kpi">
                        <div className="kpa-kpi-head">
                          <span className="kpa-kpi-num">{kIdx + 1}.</span>
                          <textarea
                            rows={2}
                            value={kk.description}
                            onChange={(e) => updateKpi(idx, kIdx, { description: e.target.value })}
                            placeholder="e.g. Generate and convert qualified data / automation opportunities."
                            maxLength={2000}
                          />
                          <button
                            type="button"
                            className="btn-icon btn-icon-danger"
                            title="Remove KPI"
                            onClick={() => removeKpi(idx, kIdx)}
                            aria-label={`Remove KPI ${kIdx + 1}`}
                          >
                            ×
                          </button>
                        </div>
                        <div className="kpa-kpi-rating">
                          <label className="kpa-measures-label">Rating</label>
                          <div className="kpa-kpi-rating-row">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={kk.rating}
                              onChange={(e) => updateKpi(idx, kIdx, { rating: e.target.value })}
                              placeholder="Not yet rated"
                              className="kpa-kpi-rating-input"
                            />
                            <span className="kpa-kpi-rating-suffix">%</span>
                            <small className="muted">
                              Used on the HR Analysis page to rank top &amp; lower performers. Leave blank if not yet reviewed.
                            </small>
                          </div>
                        </div>
                        <div className="kpa-measures">
                          <label className="kpa-measures-label">How we measure</label>
                          <ul className="kpa-measures-list">
                            {kk.measures.map((m, mIdx) => (
                              <li key={mIdx} className="kpa-measure-row">
                                <span className="kpa-measure-bullet" aria-hidden>•</span>
                                <input
                                  type="text"
                                  value={m}
                                  onChange={(e) => updateMeasure(idx, kIdx, mIdx, e.target.value)}
                                  placeholder="e.g. # of qualified opportunities supported (pre-sales) per quarter"
                                  maxLength={500}
                                />
                                <button
                                  type="button"
                                  className="btn-icon btn-icon-danger"
                                  title="Remove measure"
                                  onClick={() => removeMeasure(idx, kIdx, mIdx)}
                                  aria-label="Remove measure"
                                >
                                  ×
                                </button>
                              </li>
                            ))}
                          </ul>
                          <button type="button" className="btn-ghost kpa-add kpa-add-sm" onClick={() => addMeasure(idx, kIdx)}>
                            + Add measure
                          </button>
                        </div>
                      </div>
                    ))}
                    <button type="button" className="btn-ghost kpa-add" onClick={() => addKpi(idx)}>
                      + Add KPI
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn-ghost kpa-add" onClick={addRow}>
                + Add KPA
              </button>
            </div>

            <div className={'kpa-total' + (totalOk ? ' kpa-total-ok' : ' kpa-total-warn')}>
              <span className="muted">Total weight</span>
              <strong>{total.toFixed(2)}%</strong>
              {!totalOk && (
                <span className="kpa-total-warn-text">
                  — should be 100% (currently {(100 - total).toFixed(2)}% {total < 100 ? 'short' : 'over'})
                </span>
              )}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
