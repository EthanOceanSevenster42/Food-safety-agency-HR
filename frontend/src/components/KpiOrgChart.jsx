import { useRef, useState } from 'react';
import PanZoom from './PanZoom.jsx';
import AltManagerLines from './AltManagerLines.jsx';
import { orderSiblings } from './orgLayout.js';

function buildTree(employees) {
  const byId = new Map();
  employees.forEach((e) => byId.set(e.id, { ...e, children: [] }));
  const roots = [];
  byId.forEach((node) => {
    if (node.managerId && byId.has(node.managerId)) {
      byId.get(node.managerId).children.push(node);
    } else {
      roots.push(node);
    }
  });
  // Order siblings so co-managers of a shared report sit next to each other.
  const sortRec = (n) => {
    n.children = orderSiblings(n.children, byId);
    n.children.forEach(sortRec);
  };
  const ordered = orderSiblings(roots, byId);
  ordered.forEach(sortRec);
  return ordered;
}

function getDescendantIds(employees, rootId) {
  const childrenByMgr = new Map();
  employees.forEach((e) => {
    if (!childrenByMgr.has(e.managerId)) childrenByMgr.set(e.managerId, []);
    childrenByMgr.get(e.managerId).push(e.id);
  });
  const result = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    const kids = childrenByMgr.get(id) ?? [];
    kids.forEach((k) => {
      if (!result.has(k)) {
        result.add(k);
        stack.push(k);
      }
    });
  }
  return result;
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 35%, 45%)`;
}

function frequencyLabel(value) {
  switch (value) {
    case 'Quarterly':  return 'Quarterly';
    case 'BiAnnually': return 'Bi-annually';
    case 'Annually':   return 'Annually';
    default:           return value || '—';
  }
}

function reviewStatusLabel(status) {
  switch (status) {
    case 'employee_pending':   return 'Awaiting employee';
    case 'employee_submitted': return 'Awaiting manager';
    case 'manager_submitted':  return 'Session locked';
    case 'unlocked':           return 'In session';
    case 'completed':          return 'Completed';
    default:                   return status || '—';
  }
}

function OrgNode({
  node,
  nameById,
  sessionsByEmp,
  reviewsByEmp,
  companyFrequency,
  readOnly,
  draggedId,
  invalidTargets,
  hoveredId,
  onAddReport,
  onEdit,
  onDelete,
  onOpenKpi,
  onStartReview,
  onOpenReview,
  onDownloadReview,
  onOpenAnalysis,
  onDragStart,
  onDragEnd,
  onDragEnterNode,
  onDragLeaveNode,
  onDropOnNode,
}) {
  const hasChildren = node.children.length > 0;
  const isDragging = draggedId === node.id;
  const isInvalid = draggedId != null && invalidTargets.has(node.id);
  const isHovered = hoveredId === node.id && !isInvalid && draggedId != null && draggedId !== node.id;
  const mySessions = sessionsByEmp.get(node.id) ?? [];
  const myReviews = reviewsByEmp.get(node.id) ?? [];
  const effectiveFreq = node.kpiExempt
    ? null
    : (node.kpiFrequencyOverride || companyFrequency || 'Quarterly');

  return (
    <li className="org-node-wrap">
      <div
        className={
          'org-node kpi-node' +
          (isDragging ? ' is-dragging' : '') +
          (isHovered ? ' is-drop-target' : '') +
          (isInvalid ? ' is-drop-invalid' : '') +
          (node.kpiExempt ? ' is-kpi-exempt' : '')
        }
        data-emp-id={node.id}
        draggable={!readOnly}
        onDragStart={readOnly ? undefined : (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(node.id));
          onDragStart(node.id);
        }}
        onDragEnd={readOnly ? undefined : onDragEnd}
        onDragEnter={readOnly ? undefined : (e) => {
          if (draggedId == null || draggedId === node.id) return;
          e.preventDefault();
          onDragEnterNode(node.id);
        }}
        onDragOver={readOnly ? undefined : (e) => {
          if (draggedId == null || draggedId === node.id || isInvalid) {
            e.dataTransfer.dropEffect = 'none';
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDragLeave={readOnly ? undefined : (e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          onDragLeaveNode(node.id);
        }}
        onDrop={readOnly ? undefined : (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (draggedId == null || draggedId === node.id || isInvalid) return;
          onDropOnNode(draggedId, node.id);
        }}
      >
        <div className="org-node-head">
          <div className="org-avatar" style={{ background: avatarColor(node.name) }}>
            {initials(node.name)}
          </div>
          <div className="org-node-text">
            <div className="org-node-name">{node.name}</div>
            {node.title && <div className="org-node-title">{node.title}</div>}
          </div>
        </div>
        {node.email && <div className="org-node-email">{node.email}</div>}
        {node.additionalManagerIds?.length > 0 && (
          <div className="org-node-alt-mgr" title="Also reports to">
            ⇄ Also reports to: {node.additionalManagerIds.map((id) => nameById?.get(id)).filter(Boolean).join(', ')}
          </div>
        )}

        <div className="kpi-node-meta">
          {node.kpiExempt ? (
            <span className="kpi-tag is-exempt">Exempt from KPI</span>
          ) : (
            <>
              <span className="kpi-tag">{frequencyLabel(effectiveFreq)}</span>
              {node.kpiFrequencyOverride && (
                <span className="kpi-tag-note">override</span>
              )}
            </>
          )}
        </div>

        {!node.kpiExempt && (
          <div className="org-node-assets kpi-node-sessions">
            <div className="org-node-assets-title">
              {mySessions.length === 0
                ? 'No KPI sessions yet'
                : `${mySessions.length} session${mySessions.length === 1 ? '' : 's'}`}
            </div>
            {mySessions.slice(0, 4).map((s) => (
              <div
                key={s.id}
                className={'org-asset-line kpi-session-line' + (s.documentUrl ? '' : ' is-empty')}
                title={s.notes || s.originalName || s.periodLabel}
              >
                <span className="org-asset-dot" />
                <span className="kpi-session-period">{s.periodLabel}</span>
                {s.documentUrl ? (
                  <a
                    className="kpi-session-doc"
                    href={s.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {s.originalName || 'document'}
                  </a>
                ) : (
                  <span className="kpi-session-missing">no file</span>
                )}
              </div>
            ))}
            {mySessions.length > 4 && (
              <div className="kpi-session-more">+{mySessions.length - 4} more</div>
            )}
          </div>
        )}

        {!node.kpiExempt && myReviews.length > 0 && (
          <div className="org-node-assets kpi-node-reviews">
            <div className="org-node-assets-title">
              {myReviews.length} review{myReviews.length === 1 ? '' : 's'}
            </div>
            {myReviews.slice(0, 4).map((rv) => (
              <div key={rv.id} className="kpi-review-row">
                <button
                  type="button"
                  className={'org-asset-line kpi-review-line kpi-review-' + rv.status}
                  title={`${rv.periodLabel} · ${reviewStatusLabel(rv.status)} · ${rv.kpiCount} KPI${rv.kpiCount === 1 ? '' : 's'}`}
                  onClick={(e) => { e.stopPropagation(); onOpenReview(rv); }}
                >
                  <span className="org-asset-dot" />
                  <span className="kpi-session-period">{rv.periodLabel}</span>
                  <span className="kpi-review-status">{reviewStatusLabel(rv.status)}</span>
                </button>
                {rv.status === 'completed' && onDownloadReview && (
                  <button
                    type="button"
                    className="kpi-review-dl"
                    title="Download signed KPI document (PDF)"
                    onClick={(e) => { e.stopPropagation(); onDownloadReview(rv); }}
                  >
                    ↓ PDF
                  </button>
                )}
              </div>
            ))}
            {myReviews.length > 4 && (
              <div className="kpi-session-more">+{myReviews.length - 4} more</div>
            )}
          </div>
        )}

        <div className="org-node-actions">
          {!node.kpiExempt && !readOnly && (
            <button className="org-action-primary" onClick={() => onStartReview(node)} title="Start a KPI review">
              Start review
            </button>
          )}
          {!node.kpiExempt && (
            <div className="org-node-actions-row">
              {!readOnly && <button onClick={() => onOpenKpi(node)} title="Manage KPI sessions">KPIs</button>}
              <button onClick={() => onOpenAnalysis(node)} title="Performance analysis">Analysis</button>
            </div>
          )}
          {!readOnly && (
            <div className="org-node-actions-row">
              <button onClick={() => onAddReport(node)} title="Add direct report">+ Report</button>
              <button onClick={() => onEdit(node)} title="Edit">Edit</button>
              <button className="danger org-action-icon" onClick={() => onDelete(node)} title="Delete">×</button>
            </div>
          )}
        </div>
      </div>
      {hasChildren && (
        <ul className="org-children">
          {node.children.map((child) => (
            <OrgNode
              key={child.id}
              node={child}
              nameById={nameById}
              sessionsByEmp={sessionsByEmp}
              reviewsByEmp={reviewsByEmp}
              companyFrequency={companyFrequency}
              readOnly={readOnly}
              draggedId={draggedId}
              invalidTargets={invalidTargets}
              hoveredId={hoveredId}
              onAddReport={onAddReport}
              onEdit={onEdit}
              onDelete={onDelete}
              onOpenKpi={onOpenKpi}
              onStartReview={onStartReview}
              onOpenReview={onOpenReview}
              onDownloadReview={onDownloadReview}
              onOpenAnalysis={onOpenAnalysis}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragEnterNode={onDragEnterNode}
              onDragLeaveNode={onDragLeaveNode}
              onDropOnNode={onDropOnNode}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function KpiOrgChart({
  employees,
  sessions = [],
  reviews = [],
  companyFrequency = 'Quarterly',
  readOnly = false,
  onAddReport,
  onEdit,
  onDelete,
  onMove,
  onOpenKpi,
  onStartReview,
  onOpenReview,
  onDownloadReview,
  onOpenAnalysis,
}) {
  const [draggedId, setDraggedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [rootHover, setRootHover] = useState(false);
  const canvasRef = useRef(null);

  const roots = buildTree(employees);
  const nameById = new Map(employees.map((e) => [e.id, e.name]));
  const sessionsByEmp = new Map();
  sessions.forEach((s) => {
    if (!s.employeeId) return;
    if (!sessionsByEmp.has(s.employeeId)) sessionsByEmp.set(s.employeeId, []);
    sessionsByEmp.get(s.employeeId).push(s);
  });
  const reviewsByEmp = new Map();
  reviews.forEach((rv) => {
    if (!rv.employeeId) return;
    if (!reviewsByEmp.has(rv.employeeId)) reviewsByEmp.set(rv.employeeId, []);
    reviewsByEmp.get(rv.employeeId).push(rv);
  });

  if (roots.length === 0) return null;

  const invalidTargets = draggedId
    ? new Set([draggedId, ...getDescendantIds(employees, draggedId)])
    : new Set();

  const draggedEmp = draggedId ? employees.find((e) => e.id === draggedId) : null;
  const canDropOnRoot = draggedEmp && draggedEmp.managerId !== null;

  function handleDragStart(id) { setDraggedId(id); setHoveredId(null); }
  function handleDragEnd() { setDraggedId(null); setHoveredId(null); setRootHover(false); }
  function handleEnterNode(id) { setHoveredId(id); }
  function handleLeaveNode(id) {
    setHoveredId((current) => (current === id ? null : current));
  }
  function handleDropOnNode(empId, newMgrId) {
    setDraggedId(null);
    setHoveredId(null);
    setRootHover(false);
    onMove(empId, newMgrId);
  }
  function handleRootDrop(e) {
    e.preventDefault();
    if (!draggedId || !canDropOnRoot) return;
    const id = draggedId;
    setDraggedId(null);
    setRootHover(false);
    onMove(id, null);
  }

  return (
    <div className="org-chart kpi-org-chart">
      <div className="org-toolbar">
        <span className="org-hint">
          <strong>Tip:</strong> drag the empty canvas to pan, scroll to zoom.
          {!readOnly && <> Click <em>KPIs</em> on any card to upload session documents. Drag a card onto another to change who they report to.</>}
        </span>
      </div>
      {!readOnly && (
        <div
          className={'org-root-zone' + (draggedId && canDropOnRoot && rootHover ? ' is-active' : '') + (draggedId && canDropOnRoot ? ' is-available' : '')}
          onDragEnter={(e) => { if (draggedId && canDropOnRoot) { e.preventDefault(); setRootHover(true); } }}
          onDragOver={(e) => { if (draggedId && canDropOnRoot) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget)) return;
            setRootHover(false);
          }}
          onDrop={handleRootDrop}
        >
          Top of organisation
        </div>
      )}
      <PanZoom>
        <div className="org-canvas" ref={canvasRef}>
          <AltManagerLines canvasRef={canvasRef} employees={employees} refreshKey={roots.length} />
          <ul className="org-children org-roots">
          {roots.map((root) => (
            <OrgNode
              key={root.id}
              node={root}
              nameById={nameById}
              sessionsByEmp={sessionsByEmp}
              reviewsByEmp={reviewsByEmp}
              companyFrequency={companyFrequency}
              readOnly={readOnly}
              draggedId={draggedId}
              invalidTargets={invalidTargets}
              hoveredId={hoveredId}
              onAddReport={onAddReport}
              onEdit={onEdit}
              onDelete={onDelete}
              onOpenKpi={onOpenKpi}
              onStartReview={onStartReview}
              onOpenReview={onOpenReview}
              onDownloadReview={onDownloadReview}
              onOpenAnalysis={onOpenAnalysis}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragEnterNode={handleEnterNode}
              onDragLeaveNode={handleLeaveNode}
              onDropOnNode={handleDropOnNode}
            />
          ))}
          </ul>
        </div>
      </PanZoom>
    </div>
  );
}
