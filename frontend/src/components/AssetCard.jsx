import {
  computeBookValue, computeReplacementInfo, formatMoney, formatRelative, getAssetStatus,
} from '../utils/assetMath.js';

export default function AssetCard({ asset, employees, onEdit, onDelete, onAllocate, onToggleRepairs, readOnly = false }) {
  const status = getAssetStatus(asset);
  const bookValue = computeBookValue(asset);
  const replacement = computeReplacementInfo(asset);
  const cover = asset.images?.[0];

  let replacementClass = '';
  if (replacement) {
    if (replacement.daysRemaining < 0) replacementClass = 'replacement-overdue';
    else if (replacement.daysRemaining < 90) replacementClass = 'replacement-soon';
  }

  return (
    <div className={'asset-card status-' + status}>
      <div className="asset-photo">
        {cover ? (
          <img src={cover.url} alt={asset.name} />
        ) : (
          <div className="asset-photo-placeholder" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
        {asset.images?.length > 1 && (
          <span className="asset-photo-count">+{asset.images.length - 1}</span>
        )}
        <span className="asset-category-badge floating">{asset.category}</span>
        {status === 'repairs' && (
          <span className="asset-status-flag repairs-flag">In Repairs</span>
        )}
      </div>

      <div className="asset-card-body">
        <div className="asset-card-title-row">
          <div className="asset-name">{asset.name}</div>
          {!readOnly && (
            <div className="asset-card-actions">
              <button onClick={onEdit} title="Edit">Edit</button>
              <button className="danger" onClick={onDelete} title="Delete">×</button>
            </div>
          )}
        </div>
        {asset.type && <div className="asset-meta">{asset.type}</div>}
        {(asset.serialNumber || asset.assetTag) && (
          <div className="asset-meta-row">
            {asset.serialNumber && <span className="asset-meta mono">SN {asset.serialNumber}</span>}
            {asset.assetTag && <span className="asset-meta mono">Tag {asset.assetTag}</span>}
          </div>
        )}

        {(asset.purchaseValue != null || replacement) && (
          <div className="asset-finance">
            {asset.purchaseValue != null && (
              <div className="asset-fin-row">
                <span className="muted">Value</span>
                <strong>{formatMoney(asset.purchaseValue)}</strong>
                {bookValue != null && asset.purchaseValue > 0 && (
                  <span className="muted"> · now {formatMoney(bookValue)}</span>
                )}
              </div>
            )}
            {replacement && (
              <div className={'asset-fin-row ' + replacementClass}>
                <span className="muted">Lifecycle</span>
                <span>{formatRelative(replacement.daysRemaining)}</span>
              </div>
            )}
          </div>
        )}

        <div className="asset-card-foot">
          <div className="asset-status-line">
            {status === 'repairs' && (
              <>
                <span className="asset-pill repairs">In repairs</span>
                {asset.assignedEmployeeName && (
                  <span className="muted small">
                    Returns to <strong>{asset.assignedEmployeeName}</strong>
                  </span>
                )}
              </>
            )}
            {status === 'allocated' && (
              <div className="asset-assignee">
                <span className="muted">Assigned to</span>{' '}
                <strong>{asset.assignedEmployeeName}</strong>
                {asset.assignedEmployeeTitle && <span className="muted"> · {asset.assignedEmployeeTitle}</span>}
              </div>
            )}
            {status === 'storage' && <span className="asset-pill storage">In storage</span>}
          </div>

          {!readOnly && (
            <div className="asset-controls">
              <select
                className="asset-allocate-select"
                value={asset.assignedEmployeeId ?? ''}
                onChange={(e) => onAllocate(e.target.value === '' ? null : Number(e.target.value))}
                aria-label="Allocate to employee"
              >
                <option value="">— In storage —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}{emp.title ? ` · ${emp.title}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={'asset-repair-btn' + (status === 'repairs' ? ' active' : '')}
                onClick={() => onToggleRepairs(!asset.isInRepairs)}
              >
                {status === 'repairs' ? '✓ Mark as repaired' : '⚒ Send to repairs'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
