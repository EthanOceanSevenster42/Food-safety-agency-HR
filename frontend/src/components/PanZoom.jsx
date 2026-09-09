import { useCallback, useEffect, useRef, useState } from 'react';

// Wraps any content in a fixed-height viewport that can be panned (click-drag
// on empty space) and zoomed (mouse wheel, or the +/−/fit buttons). Panning
// uses Pointer Events with pointer capture so the drag keeps tracking smoothly
// even when the cursor moves fast or leaves the viewport, and a dragstart guard
// stops the browser's native drag from hijacking the pan. Panning is suppressed
// when the pointer goes down on an interactive/draggable element (e.g. an
// org-chart card) so native HTML5 drag-to-reparent still works.
//
// The view fits its content on first paint. Before that it opened at 100% with
// the origin pinned 24px from the top-left, so a wide org chart — ten siblings
// is ~2800px — put the root a screen and a half off to the right, with nothing
// but empty canvas in view.
export default function PanZoom({ children, minScale = 0.2, maxScale = 2.5, className = '' }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const [t, setT] = useState({ x: 24, y: 24, s: 1 });
  const tRef = useRef(t);
  tRef.current = t;
  const pan = useRef(null);
  // Once the view has been moved by hand, stop re-fitting it underneath them.
  const touched = useRef(false);
  // The height the stylesheet asked for — the ceiling for the auto height.
  const maxHeightRef = useRef(null);
  const [autoHeight, setAutoHeight] = useState(null);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;

    // scrollWidth/Height ignore the CSS transform, so this is the unscaled size.
    const cw = content.scrollWidth;
    const ch = content.scrollHeight;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    if (!cw || !ch || !vw || !vh) return;

    const pad = 28;
    if (maxHeightRef.current == null) maxHeightRef.current = vh;
    const maxH = maxHeightRef.current;

    // Never zoom past 1 — blowing a small chart up to fill the space looks broken.
    const s = Math.min(
      1,
      Math.max(minScale, Math.min((vw - pad * 2) / cw, (maxH - pad * 2) / ch))
    );

    // Shrink the canvas to the chart. A fixed-height canvas left a large band
    // of empty grid under a short chart, which read as a layout bug.
    setAutoHeight(Math.max(320, Math.min(maxH, Math.round(ch * s) + pad * 2)));
    // Centre horizontally, but pin to the top. Vertically centring a short
    // chart in a tall canvas left a band of empty grid above it that read as
    // a broken layout rather than as room to pan into.
    setT({
      x: Math.max(pad, (vw - cw * s) / 2),
      y: pad,
      s,
    });
  }, [minScale]);

  // Fit on mount and whenever the content's size changes — until the user
  // takes over.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;

    // One frame's grace so children have laid out and been measured.
    const raf = requestAnimationFrame(() => { if (!touched.current) fit(); });

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { if (!touched.current) fit(); });
      ro.observe(content);
      if (viewportRef.current) ro.observe(viewportRef.current);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    };
  }, [fit]);

  // Wheel zoom toward the cursor. React's onWheel is passive (can't
  // preventDefault), so attach a native non-passive listener.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      touched.current = true;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const prev = tRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const s = Math.min(maxScale, Math.max(minScale, prev.s * factor));
      const ratio = s / prev.s;
      setT({ x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio, s });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [minScale, maxScale]);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    // Let cards / controls handle their own pointer events (drag, click).
    if (e.target.closest('.org-node, button, a, input, select, textarea, label')) return;
    e.preventDefault();
    touched.current = true;
    pan.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, origX: tRef.current.x, origY: tRef.current.y };
    // Capture so we keep getting move/up even if the cursor leaves the viewport.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    document.body.classList.add('is-panning');
  }

  function onPointerMove(e) {
    const p = pan.current;
    if (!p || e.pointerId !== p.id) return;
    setT((prev) => ({
      ...prev,
      x: p.origX + (e.clientX - p.sx),
      y: p.origY + (e.clientY - p.sy),
    }));
  }

  function endPan(e) {
    const p = pan.current;
    if (!p) return;
    if (e && e.pointerId != null && e.pointerId !== p.id) return;
    pan.current = null;
    document.body.classList.remove('is-panning');
    try { if (e) e.currentTarget.releasePointerCapture(p.id); } catch { /* ignore */ }
  }

  function zoomBy(factor) {
    const el = viewportRef.current;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    touched.current = true;
    setT((prev) => {
      const s = Math.min(maxScale, Math.max(minScale, prev.s * factor));
      const ratio = s / prev.s;
      return { x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio, s };
    });
  }

  // "Fit" hands the view back to the automatic behaviour.
  function fitAndRelease() {
    touched.current = false;
    fit();
  }

  function actualSize() {
    touched.current = true;
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) { setT({ x: 24, y: 24, s: 1 }); return; }
    setT({
      x: Math.max(24, (vp.clientWidth - content.scrollWidth) / 2),
      y: 24,
      s: 1,
    });
  }

  return (
    <div
      className={'panzoom-viewport' + (className ? ' ' + className : '')}
      ref={viewportRef}
      style={autoHeight ? { height: autoHeight } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      // Stop the browser starting a native drag mid-pan (cards keep their own drag).
      onDragStart={(e) => { if (pan.current) e.preventDefault(); }}
    >
      <div className="panzoom-controls">
        <button type="button" onClick={() => zoomBy(1.2)} title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out">−</button>
        <button type="button" onClick={fitAndRelease} title="Fit to view" aria-label="Fit to view">⤢</button>
        <button type="button" onClick={actualSize} title="Actual size (100%)" aria-label="Actual size" className="panzoom-actual">1:1</button>
        <span className="panzoom-pct">{Math.round(t.s * 100)}%</span>
      </div>
      <div
        className="panzoom-content"
        ref={contentRef}
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, transformOrigin: '0 0' }}
      >
        {children}
      </div>
    </div>
  );
}
