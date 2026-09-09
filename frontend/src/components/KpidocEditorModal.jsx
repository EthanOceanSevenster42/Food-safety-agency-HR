import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

// KPI Document editor. Task-mode only for now — the static columns of
// the table (Weight / KPA / Core Values / KPI / How we measure it) are
// always pulled from the project's KPA task at view time, so the editor
// only has to manage the editable header fields + per-row review data.
//
// Layout mirrors the reference Bernadette spreadsheet: rows for KPIs
// that share the same KPA collapse the Weight, KPA and Core Values
// columns into rowspan'd cells so the table reads one tall block per
// KPA — exactly how the spreadsheet is laid out.
//
// Score / Weighted-score columns are intentionally hidden: capture
// hasn't been enabled yet. The Total / Overall row at the bottom is
// gone for the same reason.
//
// Persisted data shape (KpidocDataJson):
//   {
//     jobTitle, periodLabel, introText, declarationText,
//     rowsReview: [
//       { dataSource, dataResult, status, comments },
//       ...
//     ]
//   }
// The rowsReview array is positional — index i corresponds to the i-th
// KPI row when KPAs are walked in their stored order.

const DEFAULT_INTRO =
  "Key Performance Indicators, or KPIs, are a method of driving performance. KPIs help guide focus and action, and ensure that performance is aligned and targeted towards achieving overall business success.";
const DEFAULT_DECLARATION =
  'Declaration: I was part of the process to set the KPIs and I agree with the KPIs that have been set.';

// Derive a grouped view of the KPA payload — one group per KPA, with
// its shared metadata (weight / core values) and a list of KPI rows.
// The renderer walks groups so the Weight / KPA / Core-Values cells can
// be rowspan'd across all the KPIs in a group.
function deriveGroupsFromKpa(kpaProcess) {
  const kpas = Array.isArray(kpaProcess?.kpas) ? kpaProcess.kpas : [];
  const groups = [];
  for (const kpa of kpas) {
    const area = (kpa?.name || kpa?.department || '').toString();
    const weightDecimal = Number.isFinite(Number(kpa?.weight)) ? Number(kpa.weight) / 100 : 0;
    const coreValues = Array.isArray(kpa?.coreValues) ? kpa.coreValues.filter(Boolean) : [];
    const kpis = Array.isArray(kpa?.kpis) ? kpa.kpis : (
      kpa?.kpi ? [{ description: kpa.kpi, measures: kpa.measures }] : []
    );
    const rows = [];
    for (const kpi of kpis) {
      const desc = (kpi?.description || '').toString();
      const measures = Array.isArray(kpi?.measures) ? kpi.measures.filter(Boolean) : [];
      // The reference doc shows multiple measures stacked vertically in
      // the same cell — newline-separated handles both display and
      // copy/paste cleanly.
      const howWeMeasure = measures.join('\n');
      rows.push({ kpiDescription: desc, howWeMeasure });
    }
    if (rows.length === 0) continue;
    groups.push({ area, weightDecimal, coreValues, rows });
  }
  return groups;
}

// Flat row count across all groups — used to size the parallel reviews
// array (positional keyed).
function countRows(groups) {
  let n = 0;
  for (const g of groups) n += g.rows.length;
  return n;
}

export default function KpidocEditorModal({ processId, processName, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  const [meta, setMeta] = useState({
    jobTitle: '',
    periodLabel: '',
    introText: DEFAULT_INTRO,
    declarationText: DEFAULT_DECLARATION,
  });
  const [groups, setGroups]   = useState([]);
  const [reviews, setReviews] = useState([]);
  const [kpaProcess, setKpaProcess] = useState(null);

  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    (async () => {
      try {
        const res = await api.getKpidoc(processId);
        if (cancelled) return;
        setKpaProcess(res?.kpaProcess || null);
        const derived = deriveGroupsFromKpa(res?.kpaProcess);
        setGroups(derived);
        const total = countRows(derived);
        const d = res?.data || {};
        // Job title is auto-pulled from the project's Job Description
        // task (res.jdTitle) so the user doesn't have to retype what
        // they typed in the JD. Falls back to the employee's title on
        // the KPA task, then to a previously-saved override.
        setMeta({
          jobTitle:        d.jobTitle        || res?.jdTitle || res?.kpaProcess?.employeeTitle || '',
          periodLabel:     d.periodLabel     || '',
          introText:       d.introText       || DEFAULT_INTRO,
          declarationText: d.declarationText || DEFAULT_DECLARATION,
        });
        const persistedReviews = Array.isArray(d.rowsReview) ? d.rowsReview : [];
        const next = Array.from({ length: total }, (_, i) => {
          const r = persistedReviews[i] || {};
          return {
            dataSource: r.dataSource || '',
            dataResult: r.dataResult || '',
            status:     r.status     || '',
            comments:   r.comments   || '',
          };
        });
        setReviews(next);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [processId]);

  function patchMeta(field, value) { setMeta((m) => ({ ...m, [field]: value })); }

  // Render-time helper: walk groups and emit row objects each tagged
  // with their global index + whether they're the first row in their
  // KPA group (and if so, how many rows the group spans).
  const flatRows = useMemo(() => {
    const out = [];
    let idx = 0;
    for (const g of groups) {
      g.rows.forEach((r, i) => {
        out.push({
          ...r,
          globalIndex: idx++,
          isFirstInGroup: i === 0,
          groupSize: g.rows.length,
          group: g,
        });
      });
    }
    return out;
  }, [groups]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const payload = {
        jobTitle:        meta.jobTitle.trim(),
        periodLabel:     meta.periodLabel.trim(),
        introText:       meta.introText.trim(),
        declarationText: meta.declarationText.trim(),
        rowsReview: reviews.map((r) => ({
          dataSource: (r.dataSource || '').trim(),
          dataResult: (r.dataResult || '').trim(),
          status:     (r.status     || '').trim(),
          comments:   (r.comments   || '').trim(),
        })),
      };
      await api.saveKpidoc(processId, payload);
      onSaved?.();
      onClose();
    } catch (e2) {
      setErr(e2.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const previewData = {
    jobTitle:        meta.jobTitle,
    periodLabel:     meta.periodLabel,
    introText:       meta.introText,
    declarationText: meta.declarationText,
    rowsReview:      reviews,
  };

  return (
    <Modal title={processName || 'KPI Document'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        {loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="kpidoc-editor">
            {!kpaProcess && (
              <div className="muted small" style={{ marginBottom: 10 }}>
                No KPA task found in this project yet — create a KPA task and save its KPAs to populate this document.
              </div>
            )}
            {kpaProcess?.employeeName && (
              <div className="muted small" style={{ marginBottom: 10 }}>
                Pulling KPAs from <strong>{kpaProcess.name}</strong> ({kpaProcess.employeeName}{kpaProcess.employeeTitle ? ` · ${kpaProcess.employeeTitle}` : ''}). Edit the underlying KPA task to change the static columns.
              </div>
            )}

            <div className="field-row">
              <div className="field">
                <label htmlFor="kpidoc-title">Job title</label>
                <input
                  id="kpidoc-title"
                  type="text"
                  value={meta.jobTitle}
                  onChange={(e) => patchMeta('jobTitle', e.target.value)}
                  placeholder="e.g. Front-End & Mobile Developer"
                  maxLength={255}
                />
              </div>
              <div className="field">
                <label htmlFor="kpidoc-period">Period</label>
                <input
                  id="kpidoc-period"
                  type="text"
                  value={meta.periodLabel}
                  onChange={(e) => patchMeta('periodLabel', e.target.value)}
                  placeholder="e.g. For the period 2026-2027"
                  maxLength={255}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="kpidoc-intro">How are we using KPIs?</label>
              <textarea
                id="kpidoc-intro"
                rows={3}
                value={meta.introText}
                onChange={(e) => patchMeta('introText', e.target.value)}
              />
            </div>

            <div className="modal-section-title">Review rows</div>
            <small className="muted" style={{ display: 'block', marginBottom: 8 }}>
              All columns are read-only here. The first five pull live from the KPA task (edit the KPA task to change them); the trailing four (Data For Review / Overall KPI Score / Weighted score result / Comments) appear blank for handwritten entries on the printed document.
            </small>

            <div className="kpidoc-table-wrap">
              <table className="kpidoc-table kpidoc-table-merged">
                {/* Nine columns: five filled from the KPA, four left
                    blank as placeholders for handwritten review on the
                    printed document. The trailing review columns are
                    intentionally non-interactive — the user wants the
                    columns visible (matching the PDF layout) but no
                    inputs in this editor. Any previously-saved review
                    data is still preserved in state and round-tripped
                    on save. */}
                <colgroup>
                  <col style={{ width: '4%' }}  />  {/* Weight */}
                  <col style={{ width: '8%' }}  />  {/* KPA */}
                  <col style={{ width: '9%' }}  />  {/* Core Values */}
                  <col style={{ width: '20%' }} />  {/* KPI */}
                  <col style={{ width: '20%' }} />  {/* How we measure */}
                  <col style={{ width: '9%' }}  />  {/* Data For Review */}
                  <col style={{ width: '9%' }}  />  {/* Overall KPI Score */}
                  <col style={{ width: '11%' }} />  {/* Weighted score result */}
                  <col style={{ width: '10%' }} />  {/* Comments */}
                </colgroup>
                <thead>
                  <tr>
                    <th>Weight</th>
                    <th>KPA</th>
                    <th>Core Values</th>
                    <th>KPI</th>
                    <th>How we measure</th>
                    <th>Data For Review</th>
                    <th>Overall KPI Score</th>
                    <th>Weighted score result</th>
                    <th>Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {flatRows.length === 0 && (
                    <tr><td colSpan={9} className="muted">No rows — add KPAs + KPIs on the KPA task first.</td></tr>
                  )}
                  {flatRows.map((row) => (
                    <tr key={row.globalIndex}>
                      {row.isFirstInGroup && (
                        <td className="kpidoc-num kpidoc-group-cell" rowSpan={row.groupSize}>
                          {row.group.weightDecimal
                            ? `${Math.round(row.group.weightDecimal * 100)}%`
                            : ''}
                        </td>
                      )}
                      {row.isFirstInGroup && (
                        <td className="kpidoc-group-cell kpidoc-group-area" rowSpan={row.groupSize}>
                          {row.group.area}
                        </td>
                      )}
                      {row.isFirstInGroup && (
                        <td className="kpidoc-group-cell" rowSpan={row.groupSize}>
                          {row.group.coreValues.length ? row.group.coreValues.join(', ') : '—'}
                        </td>
                      )}
                      <td>{row.kpiDescription}</td>
                      <td className="kpidoc-prewrap">{row.howWeMeasure}</td>
                      {/* Four empty review cells — visible columns,
                          no inputs. Mirrors the PDF rendering. */}
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="field">
              <label htmlFor="kpidoc-declaration">Declaration</label>
              <textarea
                id="kpidoc-declaration"
                rows={2}
                value={meta.declarationText}
                onChange={(e) => patchMeta('declarationText', e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setPreviewing(true)}
            disabled={loading || saving}
            title="Render the KPI document as a PDF with the company's branding"
          >
            Preview PDF
          </button>
          <button type="submit" className="btn-primary" disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      {previewing && (
        <KpidocPreview
          processId={processId}
          processName={processName}
          data={previewData}
          onClose={() => setPreviewing(false)}
        />
      )}
    </Modal>
  );
}

function KpidocPreview({ processId, processName, data, onClose }) {
  const [blobUrl, setBlobUrl] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let createdUrl = '';
    setStatus('loading');
    setError('');
    (async () => {
      try {
        const blob = await api.previewKpidocPdf(processId, data);
        if (cancelled) return;
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
  }, [processId, data]);

  return (
    <div className="sow-preview-overlay" onMouseDown={onClose}>
      <div className="sow-preview-shell" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sow-preview-toolbar">
          <strong>{processName ? `${processName} · Preview` : 'KPI Document Preview'}</strong>
          <span className="muted small">Exact render of the PDF that will be saved.</span>
          <button type="button" className="btn-ghost" onClick={onClose}>Close preview</button>
        </div>
        <div className="sow-preview-pages">
          {status === 'loading' && <div className="sow-preview-loading muted">Generating PDF preview…</div>}
          {status === 'error'   && <div className="sow-preview-loading"><div className="error">{error}</div></div>}
          {status === 'ready' && blobUrl && (
            <iframe src={blobUrl} title="KPI Document PDF preview" className="sow-preview-iframe" />
          )}
        </div>
      </div>
    </div>
  );
}
