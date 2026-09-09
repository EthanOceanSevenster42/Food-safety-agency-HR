export default function AssetSection({ title, count, expanded = true, onToggle, children }) {
  return (
    <section className="asset-section">
      <button
        type="button"
        className={'asset-section-head' + (expanded ? ' expanded' : '')}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <svg className="asset-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <h2>{title}</h2>
        <span className="asset-section-count">{count}</span>
      </button>
      {expanded && (
        <div className="asset-section-body">
          {count === 0 ? (
            <div className="muted asset-section-empty">Nothing here.</div>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
