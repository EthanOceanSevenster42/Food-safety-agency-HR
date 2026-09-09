// Shared, self-contained SVG charts used by the HR Analysis page and the
// per-employee performance view. No chart library — plain SVG so they inherit
// the app's CSS variables (brand teal, borders, ink shades) and print cleanly.

const MANAGER_COLOR = 'var(--brand-teal)';
const SELF_COLOR = '#8b7fd4'; // muted indigo — the employee's self view

export function wrapLabel(text, maxChars) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  lines.push(cur);
  return lines;
}

const valOf = (d) => (d.value != null ? d.value : d.totalWeight);

// Spider / radar chart. `data` is [{ area, value }] (or legacy `totalWeight`).
// Optional `compare` overlays a second series (same areas, e.g. self-ratings).
// For 1–2 areas a radar is meaningless, so it falls back to a grouped bar list.
// `unit` labels the value ('%' by default); `forceMax` can pin the scale.
export function SpiderChart({ data, compare = null, unit = '%', forceMax = null, primaryLabel = 'Manager', compareLabel = 'Self' }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="muted">Nothing to chart yet.</div>;
  }
  const hasCompare = Array.isArray(compare) && compare.length === data.length;

  if (data.length < 3) {
    const all = [...data, ...(hasCompare ? compare : [])].map(valOf);
    const max = forceMax || Math.max(...all, 1);
    return (
      <div className="spider-bars">
        {data.map((d, i) => (
          <div key={d.area} className="spider-bar-row">
            <span className="spider-bar-label">{d.area}</span>
            <div className="spider-bar-track">
              <div className="spider-bar-fill" style={{ width: `${(valOf(d) / max) * 100}%` }} />
              {hasCompare && (
                <span className="spider-bar-marker" style={{ left: `${(valOf(compare[i]) / max) * 100}%` }} title={`${compareLabel}: ${valOf(compare[i]).toFixed(0)}${unit}`} />
              )}
            </div>
            <span className="spider-bar-value">{valOf(d).toFixed(0)}{unit}</span>
          </div>
        ))}
        {hasCompare && <RadarLegend primaryLabel={primaryLabel} compareLabel={compareLabel} />}
      </div>
    );
  }

  const size = 420;
  const cx = size / 2;
  const cy = size / 2;
  const r  = size / 2 - 60;
  const LABEL_PAD_X = 82;
  const LABEL_PAD_Y = 26;
  const n = data.length;
  const rawMax = Math.max(...[...data, ...(hasCompare ? compare : [])].map(valOf), 1);
  const max = forceMax || (Math.ceil(rawMax / 50) * 50 || 100);
  const rings = 4;

  const angleFor = (i) => (2 * Math.PI * i) / n - Math.PI / 2;
  const pointAt = (i, value) => {
    const ratio = Math.min(1, value / max);
    const a = angleFor(i);
    return [cx + Math.cos(a) * r * ratio, cy + Math.sin(a) * r * ratio];
  };
  const polyOf = (arr) => arr.map((d, i) => pointAt(i, valOf(d)).map((v) => v.toFixed(1)).join(',')).join(' ');

  return (
    <div className="radar-wrap">
      <svg className="spider-svg" viewBox={`${-LABEL_PAD_X} ${-LABEL_PAD_Y} ${size + LABEL_PAD_X * 2} ${size + LABEL_PAD_Y * 2}`}>
        {Array.from({ length: rings }, (_, k) => {
          const ringR = r * ((k + 1) / rings);
          const pts = Array.from({ length: n }, (_, i) => {
            const a = angleFor(i);
            return `${(cx + Math.cos(a) * ringR).toFixed(1)},${(cy + Math.sin(a) * ringR).toFixed(1)}`;
          }).join(' ');
          return <polygon key={`ring-${k}`} points={pts} fill="none" stroke="var(--border)" strokeWidth={k === rings - 1 ? 1.5 : 1} />;
        })}
        {data.map((d, i) => {
          const [ex, ey] = pointAt(i, max);
          const labelR = r + 20;
          const a = angleFor(i);
          const lx = cx + Math.cos(a) * labelR;
          const ly = cy + Math.sin(a) * labelR;
          const anchor = Math.abs(Math.cos(a)) < 0.25 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
          const nameLines = wrapLabel(d.area, 16);
          const lineH = 12;
          const blockLen = nameLines.length + 1;
          const y0 = ly - ((blockLen - 1) * lineH) / 2;
          return (
            <g key={`spoke-${i}`}>
              <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="var(--border)" strokeWidth="1" />
              {nameLines.map((ln, k) => (
                <text key={`n-${k}`} x={lx} y={y0 + k * lineH} textAnchor={anchor} dominantBaseline="middle" fontSize="11" fill="var(--ink-700)" style={{ fontWeight: 600 }}>
                  {ln}
                </text>
              ))}
              <text x={lx} y={y0 + nameLines.length * lineH} textAnchor={anchor} dominantBaseline="middle" fontSize="10" fill="var(--ink-400)">
                {valOf(d).toFixed(0)}{unit}
              </text>
            </g>
          );
        })}

        {/* Self series first (behind), as a dashed outline */}
        {hasCompare && (
          <>
            <polygon points={polyOf(compare)} fill={SELF_COLOR} fillOpacity="0.10" stroke={SELF_COLOR} strokeWidth="2" strokeDasharray="5 4" />
            {compare.map((d, i) => {
              const [px, py] = pointAt(i, valOf(d));
              return <circle key={`sc-${i}`} cx={px} cy={py} r="3.5" fill={SELF_COLOR} />;
            })}
          </>
        )}

        {/* Manager series on top */}
        <polygon points={polyOf(data)} fill={MANAGER_COLOR} fillOpacity="0.22" stroke={MANAGER_COLOR} strokeWidth="2.5" />
        {data.map((d, i) => {
          const [px, py] = pointAt(i, valOf(d));
          return <circle key={`pt-${i}`} cx={px} cy={py} r="4" fill={MANAGER_COLOR} />;
        })}
      </svg>
      {hasCompare && <RadarLegend primaryLabel={primaryLabel} compareLabel={compareLabel} />}
    </div>
  );
}

function RadarLegend({ primaryLabel, compareLabel }) {
  return (
    <div className="radar-legend">
      <span className="radar-legend-item"><span className="radar-swatch radar-swatch-manager" />{primaryLabel}</span>
      <span className="radar-legend-item"><span className="radar-swatch radar-swatch-self" />{compareLabel}</span>
    </div>
  );
}

// Horizontal bar list, coloured by score band (green ≥70% / amber / red ≤40%).
// `items` is [{ label, value, self?, gap?, caption? }], value 0–100. When
// `self` is present a tick marks the employee's self-score; when `gap` is
// present a ▲/▼ chip shows the manager-vs-self difference.
export function BarList({ items }) {
  if (!Array.isArray(items) || items.length === 0) return <div className="muted">No scores to show.</div>;
  const band = (v) => (v == null ? 'na' : v >= 70 ? 'good' : v <= 40 ? 'bad' : 'mid');
  return (
    <div className="perf-bars">
      {items.map((it, i) => (
        <div key={i} className="perf-bar-row">
          <div className="perf-bar-label" title={it.caption ? `${it.label} · ${it.caption}` : it.label}>
            <span className="perf-bar-desc">{it.label}</span>
            {it.caption && <span className="perf-bar-caption">{it.caption}</span>}
          </div>
          <div className="perf-bar-track">
            <div className={`perf-bar-fill perf-bar-${band(it.value)}`} style={{ width: `${it.value == null ? 0 : Math.max(2, Math.min(100, it.value))}%` }} />
            {it.self != null && (
              <span className="perf-bar-marker" style={{ left: `${Math.max(0, Math.min(100, it.self))}%` }} title={`Self-rated: ${Math.round(it.self)}%`} />
            )}
          </div>
          <div className="perf-bar-value">
            {it.value == null ? '—' : `${Math.round(it.value)}%`}
            {it.gap != null && it.gap !== 0 && (
              <span className={`perf-gap ${it.gap > 0 ? 'perf-gap-up' : 'perf-gap-down'}`}>
                {it.gap > 0 ? '▲' : '▼'}{Math.abs(Math.round(it.gap))}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
