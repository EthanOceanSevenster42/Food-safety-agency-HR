// Shared KPI-review helpers + the grouped layout used by the employee
// self-assessment, manager review, and joint-session pages. The stored KPI
// snapshot is a flat, ordered list; here we regroup it back under its parent
// KPAs for display while keeping each KPI's original flat index (so rating /
// comment / data bindings stay stable).

export const RATING_SCALE = [
  { score: 5, label: 'Outstanding' },
  { score: 4, label: 'Exceeds Expectations' },
  { score: 3, label: 'Meets Expectations' },
  { score: 2, label: 'Needs Improvement' },
  { score: 1, label: 'Unsatisfactory' },
];

export const scoreLabel = (s) => RATING_SCALE.find((r) => r.score === Number(s))?.label || '—';
export const ratingText = (r) => (r != null && scoreLabel(r) !== '—' ? `${r} · ${scoreLabel(r)}` : '—');

// Group consecutive KPIs that belong to the same KPA (area + weight).
export function groupKpis(kpis) {
  const groups = [];
  (Array.isArray(kpis) ? kpis : []).forEach((k, index) => {
    const area = k?.area || '';
    const weight = k?.weight || 0;
    const last = groups[groups.length - 1];
    if (last && last.area === area && last.weight === weight) {
      last.items.push({ k, index });
    } else {
      groups.push({
        area,
        weight,
        coreValues: Array.isArray(k?.coreValues) ? k.coreValues : [],
        items: [{ k, index }],
      });
    }
  });
  return groups;
}

// The three input fields captured per KPI: Data for review, Rating, Comment.
// Shared by the employee and manager forms.
export function RatingFields({ value, editable, name, onRating, onComment, onData }) {
  return (
    <>
      <div className="assess-field">
        <label className="assess-field-label">Data for review <span className="muted">— evidence for the score</span></label>
        <textarea
          className="assess-comment"
          rows={2}
          placeholder="Metrics, examples, links… the data that backs up the rating"
          disabled={!editable}
          value={value?.data ?? ''}
          onChange={(e) => onData(e.target.value)}
        />
      </div>
      <div className="assess-field">
        <label className="assess-field-label">Rating</label>
        <div className="assess-rating-row">
          {RATING_SCALE.map((opt) => (
            <label
              key={opt.score}
              className={'assess-rating-opt' + (value?.rating === opt.score ? ' is-selected' : '')}
            >
              <input
                type="radio"
                name={name}
                disabled={!editable}
                checked={value?.rating === opt.score}
                onChange={() => onRating(opt.score)}
              />
              <span className="assess-rating-score">{opt.score}</span>
              <span className="assess-rating-label">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="assess-field">
        <label className="assess-field-label">Comment</label>
        <textarea
          className="assess-comment"
          rows={2}
          placeholder="Anything worth adding (optional)"
          disabled={!editable}
          value={value?.comment ?? ''}
          onChange={(e) => onComment(e.target.value)}
        />
      </div>
    </>
  );
}

// Renders each KPA as a titled group with its KPIs beneath. `children` is a
// render function: (kpi, flatIndex, indexWithinKpa) => node.
export function AssessGroups({ kpis, children }) {
  const groups = groupKpis(kpis);
  return (
    <div className="assess-groups">
      {groups.map((g, gi) => (
        <section key={gi} className="assess-group">
          <header className="assess-group-head">
            <div className="assess-group-title">{g.area || 'KPA'}</div>
            <div className="assess-group-meta">
              {g.weight ? <span className="assess-weight">{Math.round(g.weight)}%</span> : null}
              {g.coreValues.length > 0 && (
                <span className="assess-corevals">{g.coreValues.join(' · ')}</span>
              )}
            </div>
          </header>
          <div className="assess-group-body">
            {g.items.map(({ k, index }, ki) => children(k, index, ki))}
          </div>
        </section>
      ))}
    </div>
  );
}
