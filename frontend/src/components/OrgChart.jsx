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

// Stable color from name
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 35%, 45%)`;
}

function OrgNode({
  node,
  nameById,
  assetsByEmp,
  readOnly,
  draggedId,
  invalidTargets,
  hoveredId,
  onAddReport,
  onEdit,
  onDelete,
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
  const myAssets = assetsByEmp.get(node.id) ?? [];

  return (
    <li className="org-node-wrap">
      <div
        className={
          'org-node' +
          (isDragging ? ' is-dragging' : '') +
          (isHovered ? ' is-drop-target' : '') +
          (isInvalid ? ' is-drop-invalid' : '')
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

        {myAssets.length > 0 && (
          <div className="org-node-assets">
            <div className="org-node-assets-title">
              {myAssets.length} item{myAssets.length === 1 ? '' : 's'}
            </div>
            {myAssets.map((a) => (
              <div
                key={a.id}
                className={'org-asset-line' + (a.isInRepairs ? ' in-repairs' : '')}
                title={a.type ? `${a.type} · ${a.name}` : a.name}
              >
                <span className="org-asset-dot" />
                {a.type && <span className="org-asset-type">{a.type}</span>}
                <span className="org-asset-name">{a.name}</span>
                {a.isInRepairs && <span className="org-asset-flag">repairs</span>}
              </div>
            ))}
          </div>
        )}

        {!readOnly && (
          <div className="org-node-actions">
            <button onClick={() => onAddReport(node)} title="Add direct report">+ Report</button>
            <button onClick={() => onEdit(node)} title="Edit">Edit</button>
            <button className="danger" onClick={() => onDelete(node)} title="Delete">×</button>
          </div>
        )}
      </div>
      {hasChildren && (
        <ul className="org-children">
          {node.children.map((child) => (
            <OrgNode
              key={child.id}
              node={child}
              nameById={nameById}
              assetsByEmp={assetsByEmp}
              readOnly={readOnly}
              draggedId={draggedId}
              invalidTargets={invalidTargets}
              hoveredId={hoveredId}
              onAddReport={onAddReport}
              onEdit={onEdit}
              onDelete={onDelete}
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

export default function OrgChart({ employees, assets = [], onAddReport, onEdit, onDelete, onMove, readOnly = false }) {
  const [draggedId, setDraggedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [rootHover, setRootHover] = useState(false);
  const canvasRef = useRef(null);

  const roots = buildTree(employees);
  const nameById = new Map(employees.map((e) => [e.id, e.name]));
  const assetsByEmp = new Map();
  assets.forEach((a) => {
    if (!a.assignedEmployeeId) return;
    if (!assetsByEmp.has(a.assignedEmployeeId)) assetsByEmp.set(a.assignedEmployeeId, []);
    assetsByEmp.get(a.assignedEmployeeId).push(a);
  });
  // Sort: in-repairs first, then alphabetical
  assetsByEmp.forEach((list) =>
    list.sort((a, b) => Number(b.isInRepairs) - Number(a.isInRepairs) || a.name.localeCompare(b.name))
  );

  if (roots.length === 0) return null;

  // Forbidden drop targets: the dragged node itself + all descendants
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
    <div className="org-chart">
      <div className="org-toolbar">
        <span className="org-hint">
          <strong>Tip:</strong> drag the empty canvas to pan, scroll to zoom.
          {!readOnly && ' Drag an employee onto another to change who they report to; drag onto the zone below to make them top of the organisation.'}
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
              assetsByEmp={assetsByEmp}
              readOnly={readOnly}
              draggedId={draggedId}
              invalidTargets={invalidTargets}
              hoveredId={hoveredId}
              onAddReport={onAddReport}
              onEdit={onEdit}
              onDelete={onDelete}
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
