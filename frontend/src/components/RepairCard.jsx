export default function RepairCard({
  asset,
  isLastStage,
  isDragging,
  onDragStart,
  onDragEnd,
  onMarkRepaired,
  onOpenDetails,
  readOnly = false,
}) {
  const cover = asset.images?.[0];
  const brandStyle = asset.companyBrandColor ? { '--co-brand': asset.companyBrandColor } : undefined;

  return (
    <div
      className={'repair-card' + (isDragging ? ' is-dragging' : '')}
      style={brandStyle}
      data-brand={asset.companyBrandColor || undefined}
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(asset.id));
        onDragStart(asset.id);
      }}
      onDragEnd={readOnly ? undefined : onDragEnd}
    >
      <div className="repair-card-company">
        {asset.companyLogoUrl ? (
          <img className="repair-card-logo" src={asset.companyLogoUrl} alt={asset.companyName} />
        ) : (
          <div className="repair-card-logo placeholder">{asset.companyName.slice(0, 2).toUpperCase()}</div>
        )}
        <span className="repair-card-co-name">{asset.companyName}</span>
      </div>

      {cover && (
        <div className="repair-card-photo">
          <img src={cover.url} alt={asset.name} />
        </div>
      )}

      <div className="repair-card-body">
        <div className="repair-card-head-row">
          <span className="asset-category-badge">{asset.category}</span>
          {asset.type && <span className="repair-card-type">{asset.type}</span>}
        </div>
        <div className="repair-card-name">{asset.name}</div>
        {(asset.serialNumber || asset.assetTag) && (
          <div className="repair-card-meta">
            {asset.serialNumber && <span className="mono">SN {asset.serialNumber}</span>}
            {asset.assetTag && <span className="mono">Tag {asset.assetTag}</span>}
          </div>
        )}
        {asset.assignedEmployeeName && (
          <div className="repair-card-assignee">
            <span className="muted">Returns to</span>{' '}
            <strong>{asset.assignedEmployeeName}</strong>
            {asset.assignedEmployeeTitle && <span className="muted"> · {asset.assignedEmployeeTitle}</span>}
          </div>
        )}
      </div>

      <div className="repair-card-foot">
        <button
          type="button"
          className="btn-ghost repair-details-btn"
          onClick={(e) => { e.stopPropagation(); onOpenDetails(asset); }}
        >
          Notes &amp; details
        </button>
        {isLastStage && !readOnly && (
          <button className="btn-primary repair-done-btn" onClick={() => onMarkRepaired(asset)}>
            ✓ Mark as repaired
          </button>
        )}
      </div>
    </div>
  );
}
