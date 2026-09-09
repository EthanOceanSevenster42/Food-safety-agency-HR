import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import ProcessModal from './ProcessModal.jsx';
import SowEditorModal from './SowEditorModal.jsx';
import SowVersionHistory from './SowVersionHistory.jsx';
import KpaEditorModal from './KpaEditorModal.jsx';
import KpaVersionHistory from './KpaVersionHistory.jsx';
import JdEditorModal from './JdEditorModal.jsx';
import JdVersionHistory from './JdVersionHistory.jsx';
import EdpEditorModal from './EdpEditorModal.jsx';
import EdpVersionHistory from './EdpVersionHistory.jsx';
import KpidocEditorModal from './KpidocEditorModal.jsx';
import KpidocVersionHistory from './KpidocVersionHistory.jsx';
import PackEditorModal from './PackEditorModal.jsx';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const CARD_WIDTH = 200;
const CARD_HEIGHT = 110;
// Vertical distance between a Scope of Service card's top edge and its
// dedicated Version History card. Sized so the gap leaves room for the
// connector arrow plus the card's main content (name + Edit SOW button).
const VERSION_HISTORY_OFFSET_Y = 180;

// Does this task have saved data of any kind? Drives whether the
// whiteboard renders a Version History card (and the connector arrow)
// for it. Each kind stores its body in a different column on the
// backend, so the `has*` flag is kind-specific.
function taskHasData(p) {
  if (p.kind === 'kpa')    return !!p.hasKpa;
  if (p.kind === 'jd')     return !!p.hasJd;
  if (p.kind === 'edp')    return !!p.hasEdp;
  if (p.kind === 'kpidoc') return !!p.hasKpidoc;
  return !!p.hasSow;
}

export default function Whiteboard({ project, department = 'Procurement', onClose, onEditProject, readOnly = false }) {
  const containerRef = useRef(null);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState({ panX: 0, panY: 0, zoom: 1 });
  const [modal, setModal] = useState(null);
  // Process whose editor is currently open. Hosts both kinds of tasks —
  // the right modal (SOW or KPA) is picked at render time based on
  // `editingProcess.kind`.
  const [editingProcess, setEditingProcess] = useState(null);
  // Bumped after every SOW save so the inline version history on each
  // process card refetches its list.
  const [sowVersionRefreshKey, setSowVersionRefreshKey] = useState(0);
  // Templates available to this company — used to (a) look up each
  // process's source template's nextTemplateIds, and (b) render the
  // greyed ghost cards by name/colour for each suggested successor.
  const [templates, setTemplates] = useState([]);

  // Load the company's templates once per project so we can resolve
  // successor names + colours when rendering the ghost workflow.
  useEffect(() => {
    if (!project?.companyId) return;
    let cancelled = false;
    // Scope the template pool to the same workspace as this whiteboard.
    // Without this, an HR whiteboard would resolve ghost-card target
    // templates against the Procurement template list (and probably
    // wouldn't find them).
    api.listSowTemplates(project.companyId, department)
      .then((list) => { if (!cancelled) setTemplates(Array.isArray(list) ? list : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project?.companyId, department]);

  // Refs for in-flight drag tracking — kept out of state so we don't re-render
  // on every mousemove tick.
  const panDragRef = useRef(null);   // { startMouse, startPan }
  const cardDragRef = useRef(null);  // { id, startMouse, startCard, lastPos, moved }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const out = await api.listProcesses(project.id);
      setProcesses(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [project.id]);

  // Center the viewport so newly-loaded cards are visible. Runs once after the
  // first successful load when there's at least one process.
  const centeredRef = useRef(false);
  useEffect(() => {
    if (centeredRef.current || loading || processes.length === 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xs = processes.map((p) => p.x);
    const ys = processes.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + CARD_WIDTH;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + CARD_HEIGHT;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView((v) => ({
      ...v,
      panX: rect.width / 2 - cx * v.zoom,
      panY: rect.height / 2 - cy * v.zoom,
    }));
    centeredRef.current = true;
  }, [loading, processes]);

  // ---------- Pan ----------
  function onCanvasMouseDown(e) {
    // Only start panning when the click started on the canvas background, not a card
    if (e.target.closest('.whiteboard-card')) return;
    if (e.button !== 0) return;
    panDragRef.current = {
      startMouse: { x: e.clientX, y: e.clientY },
      startPan: { x: view.panX, y: view.panY },
    };
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
  }

  // ---------- Card drag ----------
  function onCardMouseDown(e, p) {
    if (readOnly) return; // view-only: no drag, no click-to-edit
    if (e.button !== 0) return;
    e.stopPropagation();
    cardDragRef.current = {
      id: p.id,
      startMouse: { x: e.clientX, y: e.clientY },
      startCard: { x: p.x, y: p.y },
      lastPos: { x: p.x, y: p.y },
      moved: false,
    };
  }

  // ---------- Global mouse handlers ----------
  useEffect(() => {
    function move(e) {
      const card = cardDragRef.current;
      if (card) {
        const dx = (e.clientX - card.startMouse.x) / view.zoom;
        const dy = (e.clientY - card.startMouse.y) / view.zoom;
        const nx = card.startCard.x + dx;
        const ny = card.startCard.y + dy;
        // Mark as moved so we can distinguish a click from a drag
        if (!card.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) card.moved = true;
        card.lastPos = { x: nx, y: ny };
        setProcesses((prev) => prev.map((p) => (p.id === card.id ? { ...p, x: nx, y: ny } : p)));
        return;
      }
      const pan = panDragRef.current;
      if (pan) {
        const dx = e.clientX - pan.startMouse.x;
        const dy = e.clientY - pan.startMouse.y;
        setView((v) => ({ ...v, panX: pan.startPan.x + dx, panY: pan.startPan.y + dy }));
      }
    }
    function up() {
      const card = cardDragRef.current;
      if (card) {
        if (card.moved) {
          // Persist new position to backend
          api.updateProcess(card.id, { x: card.lastPos.x, y: card.lastPos.y })
            .catch((e) => setError(e.message));
        } else {
          // Treat as click — open edit
          const p = processes.find((p) => p.id === card.id);
          if (p) setModal({ mode: 'edit', process: p });
        }
      }
      cardDragRef.current = null;
      panDragRef.current = null;
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [view.zoom, processes]);

  // ---------- Wheel zoom (anchored at mouse) ----------
  function onWheel(e) {
    if (!containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const direction = e.deltaY < 0 ? 1 : -1;
    setView((v) => {
      const factor = direction > 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
      if (newZoom === v.zoom) return v;
      // Keep canvas point under mouse stable
      const cx = (mx - v.panX) / v.zoom;
      const cy = (my - v.panY) / v.zoom;
      return { panX: mx - cx * newZoom, panY: my - cy * newZoom, zoom: newZoom };
    });
  }

  // ---------- Toolbar actions ----------
  function resetView() {
    setView({ panX: 0, panY: 0, zoom: 1 });
    centeredRef.current = false;
  }

  function zoomIn()  { setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, v.zoom * 1.2) })); }
  function zoomOut() { setView((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, v.zoom / 1.2) })); }

  function addAtViewportCenter() {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = (rect.width / 2 - view.panX) / view.zoom - CARD_WIDTH / 2;
    const cy = (rect.height / 2 - view.panY) / view.zoom - CARD_HEIGHT / 2;
    setModal({ mode: 'create', initialPosition: { x: cx, y: cy } });
  }

  // ---------- Save handlers ----------
  async function handleSave(form) {
    if (modal.mode === 'edit') {
      const updated = await api.updateProcess(modal.process.id, form);
      setProcesses((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setModal(null);
    } else {
      const created = await api.createProcess(project.id, {
        ...form,
        x: modal.initialPosition?.x ?? 0,
        y: modal.initialPosition?.y ?? 0,
      });
      setProcesses((prev) => [...prev, created]);
      setModal(null);
      // Auto-open the right editor for tasks created from a template:
      //   - KPA-kind: open the KPA editor immediately so the user can pick
      //     an employee and start adding rows.
      //   - JD/EDP-kind: open the matching editor so the author can
      //     review the boilerplate that snapshotted in from the template.
      //   - SOW-kind with a snapshotted body (hasSow=true): open the SOW
      //     editor pre-filled.
      // Blank tasks (no template) are left alone; the user opens the
      // editor later from the card.
      if (['kpa', 'jd', 'edp', 'kpidoc', 'pack'].includes(created.kind) || created.hasSow) {
        setEditingProcess(created);
      }
    }
  }

  async function handleDelete() {
    await api.deleteProcess(modal.process.id);
    setProcesses((prev) => prev.filter((p) => p.id !== modal.process.id));
    setModal(null);
  }

  // ---------- Anti-overlap pass for rendered positions ----------
  // Each task card has a Version History card centred under it that's
  // 340px wide — wider than the 200px task card itself. Two task cards
  // dropped close together would have their history cards overlap. We
  // compute "rendered" x positions here that push tasks rightward just
  // enough to keep the history cards from touching. Saved positions stay
  // exactly where the user dragged them — only the render shifts.
  //
  // Greedy left-to-right pass: cards at a similar y (whose history cards
  // would share a vertical band) need x positions at least
  // HISTORY_CARD_WIDTH + MIN_HISTORY_GAP apart. Later cards are pushed
  // right by whatever the deficit is, with the shift cascading.
  const HISTORY_CARD_WIDTH = 340;
  const MIN_HISTORY_GAP = 12;
  const SAME_Y_BAND = 180;            // |Δy| under this counts as "same row"
  const renderedProcesses = (() => {
    const sorted = [...processes].sort((a, b) => a.x - b.x);
    const placed = [];
    for (const p of sorted) {
      let rx = p.x;
      for (const q of placed) {
        if (Math.abs(p.y - q.y) >= SAME_Y_BAND) continue;
        const minX = q.x + HISTORY_CARD_WIDTH + MIN_HISTORY_GAP;
        if (rx < minX) rx = minX;
      }
      placed.push({ ...p, x: rx });
    }
    // Restore the original processes order so React keys + array
    // identities stay stable (the visual sort doesn't need to leak).
    const byId = new Map(placed.map((p) => [p.id, p]));
    return processes.map((p) => byId.get(p.id) || p);
  })();

  // ---------- Flow arrows in creation order ----------
  const orderedProcesses = [...renderedProcesses].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const arrows = [];
  for (let i = 0; i < orderedProcesses.length - 1; i++) {
    const from = orderedProcesses[i];
    const to = orderedProcesses[i + 1];
    arrows.push({
      id: `${from.id}-${to.id}`,
      x1: from.x + CARD_WIDTH,
      y1: from.y + CARD_HEIGHT / 2,
      x2: to.x,
      y2: to.y + CARD_HEIGHT / 2,
      color: from.color || 'var(--brand-teal)',
    });
  }
  // ---------- Workflow successor ghost cards ----------
  // For each task that was created from a template, look up the template's
  // nextTemplateIds and render one greyed-out ghost card per suggested
  // successor — fanned out vertically to the right of the source task. The
  // ghosts include their own grey arrows back to the source. Each ghost
  // also resolves the template to skip stale references (e.g. a successor
  // template that's since been deleted).
  const GHOST_GAP_X = 60;               // horizontal gap between source card and ghosts
  const GHOST_VERTICAL_PITCH = 130;     // vertical stride between stacked ghosts
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const ghostCards = [];
  for (const p of renderedProcesses) {
    if (!p.sourceTemplateId) continue;
    const src = templateById.get(p.sourceTemplateId);
    if (!src) continue;
    // Prefer the rich `nextSteps` array; fall back to legacy
    // `nextTemplateIds` for templates that haven't been resaved since
    // the schema change.
    const rawSteps = Array.isArray(src.nextSteps) && src.nextSteps.length > 0
      ? src.nextSteps
      : (Array.isArray(src.nextTemplateIds) ? src.nextTemplateIds.map((id) => ({ templateId: id })) : []);
    if (rawSteps.length === 0) continue;

    // Drop steps the user has already acted on:
    //   - template-pick steps  → any later task seeded from the suggested
    //                            template counts as "consumed".
    //   - label-only steps     → any later task whose trimmed name matches
    //                            the label (case-insensitive) counts as
    //                            "consumed". The modal pre-fills the new
    //                            task's name with the label by default, so
    //                            this matches the common path.
    const sourceCreatedAt = new Date(p.createdAt).getTime();
    const stepTemplateIds = rawSteps.filter((s) => s.templateId != null).map((s) => s.templateId);
    const consumedIds = new Set(
      processes
        .filter((q) => q.sourceTemplateId
          && stepTemplateIds.includes(q.sourceTemplateId)
          && new Date(q.createdAt).getTime() > sourceCreatedAt)
        .map((q) => q.sourceTemplateId),
    );
    const laterTaskNames = new Set(
      processes
        .filter((q) => new Date(q.createdAt).getTime() > sourceCreatedAt)
        .map((q) => (q.name || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const remaining = rawSteps.filter((s) => {
      if (s.templateId != null) return !consumedIds.has(s.templateId);
      const norm = (s.label || '').trim().toLowerCase();
      if (!norm) return true; // empty-labelled steps stay visible
      return !laterTaskNames.has(norm);
    });
    if (remaining.length === 0) continue;

    // Centre the column of ghosts vertically against the source card.
    const baseY = p.y + (CARD_HEIGHT / 2) - (((remaining.length - 1) * GHOST_VERTICAL_PITCH) / 2) - (CARD_HEIGHT / 2);
    remaining.forEach((step, idx) => {
      let target = null;
      let displayName = '';
      let displayDesc = '';
      if (step.templateId != null) {
        target = templateById.get(step.templateId);
        if (!target) return; // template was deleted — skip stale step
        displayName = target.name || 'Untitled template';
        displayDesc = target.description || '';
      } else {
        displayName = (step.label || '').trim() || 'Untitled step';
        displayDesc = '(no template attached yet)';
      }
      const gx = p.x + CARD_WIDTH + GHOST_GAP_X;
      const gy = baseY + idx * GHOST_VERTICAL_PITCH;
      ghostCards.push({
        id: `ghost-${p.id}-${idx}`,
        sourceProcessId: p.id,
        // null for label-only steps — drives the modal-preset behaviour
        // and the "labelled placeholder" visual treatment below.
        templateId: step.templateId ?? null,
        label: step.templateId != null ? null : (step.label || ''),
        templateName: displayName,
        templateDescription: displayDesc,
        x: gx,
        y: gy,
      });
      arrows.push({
        id: `ghost-arrow-${p.id}-${idx}`,
        x1: p.x + CARD_WIDTH,
        y1: p.y + CARD_HEIGHT / 2,
        x2: gx,
        y2: gy + CARD_HEIGHT / 2,
        ghost: true,
      });
    });
  }

  // Downward connector from each task with saved data (any kind) to its
  // dedicated Version History card. Blank tasks don't get the history
  // card and don't get this arrow either.
  for (const p of renderedProcesses) {
    if (!taskHasData(p)) continue;
    arrows.push({
      id: `vh-${p.id}`,
      x1: p.x + CARD_WIDTH / 2,
      y1: p.y + CARD_HEIGHT - 10,
      x2: p.x + CARD_WIDTH / 2,
      y2: p.y + VERSION_HISTORY_OFFSET_Y,
      color: p.color || 'var(--brand-teal)',
    });
  }

  return (
    <div className="whiteboard-shell">
      <header className="whiteboard-toolbar">
        <button className="btn-ghost" onClick={onClose}>← Back to projects</button>
        <div className="whiteboard-title">
          <span
            className="whiteboard-color-dot"
            style={{ background: project.color || 'var(--brand-teal)' }}
            aria-hidden
          />
          <strong>{project.name}</strong>
          {!readOnly && <button className="btn-ghost whiteboard-edit-project" onClick={onEditProject}>Edit project</button>}
        </div>
        <div className="whiteboard-toolbar-actions">
          <button className="btn-ghost" onClick={zoomOut} title="Zoom out (or scroll)">−</button>
          <span className="whiteboard-zoom-readout">{Math.round(view.zoom * 100)}%</span>
          <button className="btn-ghost" onClick={zoomIn} title="Zoom in (or scroll)">+</button>
          <button className="btn-ghost" onClick={resetView} title="Reset view">⟳ Reset</button>
          {!readOnly && <button className="btn-primary" onClick={addAtViewportCenter}>+ New task</button>}
        </div>
      </header>

      {error && <div className="error" style={{ margin: '12px 32px 0' }}>{error}</div>}

      <div
        ref={containerRef}
        className="whiteboard-canvas"
        onMouseDown={onCanvasMouseDown}
        onWheel={onWheel}
      >
        {/* Grid background — translates with the canvas so it feels infinite */}
        <div
          className="whiteboard-grid"
          style={{
            backgroundPosition: `${view.panX}px ${view.panY}px`,
            backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
          }}
          aria-hidden
        />

        {loading ? (
          <div className="whiteboard-empty">
            <div className="muted">Loading whiteboard…</div>
          </div>
        ) : processes.length === 0 ? (
          <div className="whiteboard-empty">
            <h2>Empty whiteboard</h2>
            <p className="muted">{readOnly ? 'No tasks have been added to this project yet.' : 'Add the first task to start mapping out the project flow.'}</p>
            {!readOnly && <button className="btn-primary" onClick={addAtViewportCenter}>+ Add the first task</button>}
          </div>
        ) : (
          <div
            className="whiteboard-content"
            style={{
              transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
            }}
          >
            {/* Connector arrows behind the cards. Ghost arrows (those
                leading to suggested-next-task ghost cards) render in
                muted grey + dashed so they read as a "possible path"
                rather than an actual flow step. */}
            {arrows.length > 0 && (
              <svg className="whiteboard-arrows" overflow="visible" pointerEvents="none">
                <defs>
                  <marker id="wb-arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
                          markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                  <marker id="wb-arrowhead-ghost" viewBox="0 0 10 10" refX="9" refY="5"
                          markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa4ad" />
                  </marker>
                </defs>
                {arrows.map((a) => (
                  <g key={a.id} style={{ color: a.color }}>
                    <path
                      d={curvePath(a.x1, a.y1, a.x2, a.y2)}
                      stroke={a.ghost ? '#9aa4ad' : 'currentColor'}
                      strokeWidth="2"
                      strokeDasharray={a.ghost ? '6 5' : undefined}
                      fill="none"
                      markerEnd={a.ghost ? 'url(#wb-arrowhead-ghost)' : 'url(#wb-arrowhead)'}
                    />
                  </g>
                ))}
              </svg>
            )}

            {renderedProcesses.map((p) => (
              <article
                key={p.id}
                className="whiteboard-card"
                style={{
                  left: p.x,
                  top: p.y,
                  width: CARD_WIDTH,
                  minHeight: CARD_HEIGHT,
                  '--task-color': p.color || 'var(--brand-teal)',
                }}
                onMouseDown={(e) => onCardMouseDown(e, p)}
              >
                <div className="whiteboard-card-stripe" aria-hidden />
                <div className="whiteboard-card-name">{p.name}</div>
                {p.description && <div className="whiteboard-card-desc">{p.description}</div>}
                {!readOnly && (
                <div className="whiteboard-card-actions">
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setEditingProcess(p); }}
                  >
                    {p.kind === 'kpa'
                      ? (p.hasKpa ? 'Edit KPAs' : 'Fill KPAs')
                      : p.kind === 'jd'
                        ? (p.hasJd ? 'Edit JD' : 'Fill JD')
                        : p.kind === 'edp'
                          ? (p.hasEdp ? 'Edit EDP' : 'Fill EDP')
                          : p.kind === 'kpidoc'
                            ? (p.hasKpidoc ? 'Edit KPI Doc' : 'Fill KPI Doc')
                            : p.kind === 'pack'
                              ? 'Generate Pack'
                              : (p.sowDocUrl ? 'Edit Document' : p.hasSow ? 'Continue Document' : 'Fill Document')}
                  </button>
                </div>
                )}
              </article>
            ))}

            {/* Workflow ghost cards — greyed-out placeholders branching off
                tasks that were created from a template with successor
                links. Clicking a ghost opens the new-task modal pre-
                selected with that template (and positioned where the
                ghost was), turning it into a real task. */}
            {!readOnly && ghostCards.map((g) => {
              const isLabel = g.templateId == null;
              return (
                <article
                  key={g.id}
                  className={'whiteboard-card whiteboard-card-ghost' + (isLabel ? ' whiteboard-card-ghost-labelled' : '')}
                  style={{
                    left: g.x,
                    top: g.y,
                    width: CARD_WIDTH,
                    minHeight: CARD_HEIGHT,
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setModal({
                    mode: 'create',
                    initialPosition: { x: g.x, y: g.y },
                    // Template steps pre-select that template; label
                    // steps spawn a blank task with the label as the
                    // pre-filled name so the user can start tracking
                    // the step before its template exists.
                    presetTemplateId: g.templateId || null,
                    presetName: isLabel ? g.label : null,
                  })}
                  title={isLabel
                    ? `Placeholder step — click to create a blank task named "${g.label}"`
                    : `Suggested next task — click to create one from "${g.templateName}"`}
                >
                  <div className="whiteboard-card-ghost-stripe" aria-hidden />
                  <div className="whiteboard-card-ghost-label">
                    {isLabel ? 'Placeholder' : 'Suggested next'}
                  </div>
                  <div className="whiteboard-card-name">{g.templateName}</div>
                  {g.templateDescription && (
                    <div className="whiteboard-card-desc">{g.templateDescription}</div>
                  )}
                  <div className="whiteboard-card-actions">
                    <button type="button" className="btn-ghost-card">
                      {isLabel ? '+ Create blank task' : '+ Create from this template'}
                    </button>
                  </div>
                </article>
              );
            })}

            {/* Version history lives in its OWN card on the whiteboard,
                positioned directly below each task that has saved data
                of any kind (SOW / KPA / JD / EDP). The right history
                component is mounted based on the task's `kind`. Blank
                tasks with no data don't get a history card. */}
            {renderedProcesses
              .filter((p) => taskHasData(p))
              .map((p) => {
                // Centre the wider history card under the (narrower) parent
                // so the connector arrow lands on the centre line.
                const left = p.x + (CARD_WIDTH - HISTORY_CARD_WIDTH) / 2;
                return (
                  <article
                    key={`vh-${p.id}`}
                    className="whiteboard-card whiteboard-card-history"
                    style={{
                      left,
                      top:  p.y + VERSION_HISTORY_OFFSET_Y,
                      width: HISTORY_CARD_WIDTH,
                      minHeight: 60,
                      '--task-color': p.color || 'var(--brand-teal)',
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="whiteboard-card-stripe" aria-hidden />
                    <div className="whiteboard-card-name">Version history</div>
                    {p.kind === 'kpa'    && <KpaVersionHistory    processId={p.id} refreshKey={sowVersionRefreshKey} />}
                    {p.kind === 'jd'     && <JdVersionHistory     processId={p.id} refreshKey={sowVersionRefreshKey} />}
                    {p.kind === 'edp'    && <EdpVersionHistory    processId={p.id} refreshKey={sowVersionRefreshKey} />}
                    {p.kind === 'kpidoc' && <KpidocVersionHistory processId={p.id} refreshKey={sowVersionRefreshKey} />}
                    {(p.kind !== 'kpa' && p.kind !== 'jd' && p.kind !== 'edp' && p.kind !== 'kpidoc') && (
                      <SowVersionHistory processId={p.id} refreshKey={sowVersionRefreshKey} />
                    )}
                  </article>
                );
              })}
          </div>
        )}
      </div>

      {modal && (
        <ProcessModal
          mode={modal.mode}
          process={modal.process}
          companyId={project.companyId}
          department={department}
          presetTemplateId={modal.presetTemplateId}
          presetName={modal.presetName}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={modal.mode === 'edit' ? handleDelete : undefined}
        />
      )}

      {editingProcess && editingProcess.kind === 'kpa' && (
        <KpaEditorModal
          processId={editingProcess.id}
          processName={editingProcess.name}
          onClose={() => setEditingProcess(null)}
          onSaved={() => {
            // After the first save on a previously-blank KPA task the
            // payload exists — flip `hasKpa` so the card label switches
            // from "Fill KPAs" to "Edit KPAs" without a refresh.
            setProcesses((prev) => prev.map((p) => (p.id === editingProcess.id
              ? { ...p, hasKpa: true }
              : p)));
            // Re-fetch the version history strip on the history card so
            // the new save appears at the top immediately.
            setSowVersionRefreshKey((k) => k + 1);
          }}
        />
      )}

      {editingProcess && editingProcess.kind === 'jd' && (
        <JdEditorModal
          processId={editingProcess.id}
          processName={editingProcess.name}
          onClose={() => setEditingProcess(null)}
          onSaved={() => {
            // First save makes the JD payload exist — flip `hasJd` so
            // the card button switches from "Fill JD" to "Edit JD".
            setProcesses((prev) => prev.map((p) => (p.id === editingProcess.id
              ? { ...p, hasJd: true }
              : p)));
            // Refresh the history strip so the new version appears.
            setSowVersionRefreshKey((k) => k + 1);
          }}
        />
      )}

      {editingProcess && editingProcess.kind === 'edp' && (
        <EdpEditorModal
          processId={editingProcess.id}
          processName={editingProcess.name}
          onClose={() => setEditingProcess(null)}
          onSaved={() => {
            setProcesses((prev) => prev.map((p) => (p.id === editingProcess.id
              ? { ...p, hasEdp: true }
              : p)));
            setSowVersionRefreshKey((k) => k + 1);
          }}
        />
      )}

      {editingProcess && editingProcess.kind === 'kpidoc' && (
        <KpidocEditorModal
          processId={editingProcess.id}
          processName={editingProcess.name}
          onClose={() => setEditingProcess(null)}
          onSaved={() => {
            setProcesses((prev) => prev.map((p) => (p.id === editingProcess.id
              ? { ...p, hasKpidoc: true }
              : p)));
            setSowVersionRefreshKey((k) => k + 1);
          }}
        />
      )}

      {editingProcess && editingProcess.kind === 'pack' && (
        <PackEditorModal
          processId={editingProcess.id}
          processName={editingProcess.name}
          onClose={() => setEditingProcess(null)}
          onSaved={() => { /* no persisted state for the pack itself */ }}
        />
      )}

      {editingProcess
        && editingProcess.kind !== 'kpa'
        && editingProcess.kind !== 'jd'
        && editingProcess.kind !== 'edp'
        && editingProcess.kind !== 'kpidoc'
        && editingProcess.kind !== 'pack' && (
        <SowEditorModal
          processId={editingProcess.id}
          processName={editingProcess.name}
          defaultClientName={project.companyName || ''}
          issuerName={project.companyName || ''}
          onClose={() => setEditingProcess(null)}
          onSaved={(res) => {
            // After the first save on a previously-blank task the SOW
            // exists — flip `hasSow` so the version-history card and
            // arrow appear without needing a refresh.
            setProcesses((prev) => prev.map((p) => (p.id === editingProcess.id
              ? { ...p, sowDocUrl: res.docUrl, hasSow: true }
              : p)));
            // Trigger a refetch of the inline version-history list on the card.
            setSowVersionRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

// Cubic Bezier curve from (x1,y1) to (x2,y2). Picks horizontal vs vertical
// control points based on the dominant axis so left→right links flow
// horizontally and top→bottom links (e.g. Scope of Service → its version
// history card) flow vertically rather than bulging sideways.
function curvePath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dy > dx * 1.5) {
    const cy = Math.max(30, dy / 2);
    return `M ${x1} ${y1} C ${x1} ${y1 + cy}, ${x2} ${y2 - cy}, ${x2} ${y2}`;
  }
  const cx = Math.max(60, dx / 2);
  return `M ${x1} ${y1} C ${x1 + cx} ${y1}, ${x2 - cx} ${y2}, ${x2} ${y2}`;
}
