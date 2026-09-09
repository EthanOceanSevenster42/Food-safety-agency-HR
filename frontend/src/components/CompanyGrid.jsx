export default function CompanyGrid({ companies, onSelect, onAddCompany, onDelete, countLabel, canAdd = true }) {
  return (
    <div className="company-grid">
      {companies.map((c) => (
        <div key={c.id} className="company-card-slot">
          <button
            className="company-card"
            onClick={() => onSelect(c)}
            style={c.brandColor ? { '--co-brand': c.brandColor } : undefined}
            data-brand={c.brandColor || undefined}
          >
            <div className="company-card-logo">
              {c.logoUrl ? (
                <img src={c.logoUrl} alt={c.name} />
              ) : (
                <div className="company-logo-placeholder">{c.name.slice(0, 2).toUpperCase()}</div>
              )}
            </div>

            <div className="company-card-text">
              <div className="company-card-name">{c.name}</div>
            </div>

            {/* The count and the "go" arrow sit against the right edge. The
                card fills its grid track, so with the count tucked under the
                name the right 61% of it was empty white space. */}
            <div className="company-card-aside">
              {countLabel && <span className="company-card-count">{countLabel(c)}</span>}
              <i className="fas fa-chevron-right company-card-go" aria-hidden="true" />
            </div>
          </button>

          {onDelete && (
            <button
              type="button"
              className="company-card-del"
              title={`Delete ${c.name}`}
              aria-label={`Delete ${c.name}`}
              onClick={(e) => { e.stopPropagation(); onDelete(c); }}
            >
              ×
            </button>
          )}
        </div>
      ))}

      {canAdd && (
        <button className="company-card company-card-add" onClick={onAddCompany}>
          <div className="company-card-add-icon">+</div>
          <div className="company-card-text">
            <div className="company-card-name">New company</div>
            <div className="company-card-meta">Add a new organisation</div>
          </div>
        </button>
      )}
    </div>
  );
}
