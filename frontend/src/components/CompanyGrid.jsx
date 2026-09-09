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
            <div className="company-card-name">{c.name}</div>
            <div className="company-card-meta">{countLabel ? countLabel(c) : ''}</div>
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
          <div className="company-card-name">New company</div>
          <div className="company-card-meta">Add a new organisation</div>
        </button>
      )}
    </div>
  );
}
