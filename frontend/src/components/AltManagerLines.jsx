import { useLayoutEffect, useState } from 'react';

// Draws dashed connector lines from each employee who reports to MORE THAN ONE
// manager to their ADDITIONAL managers' boxes. The primary reporting line is the
// CSS tree itself; these overlay the extra "also reports to" links.
//
// Positions are measured with offset chains relative to `canvasRef` (which must
// be position:relative), so they're in layout space and unaffected by the
// pan/zoom CSS transform applied above — the SVG lives inside that transform and
// scales/pans with the chart automatically.
export default function AltManagerLines({ canvasRef, employees, refreshKey }) {
  const [lines, setLines] = useState([]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) { setLines([]); return undefined; }

    function measure() {
      const boxes = {};
      canvas.querySelectorAll('[data-emp-id]').forEach((el) => {
        boxes[el.getAttribute('data-emp-id')] = el;
      });
      const pos = (el) => {
        let x = 0, y = 0, n = el;
        while (n && n !== canvas) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        return { x, y, w: el.offsetWidth, h: el.offsetHeight };
      };
      const out = [];
      for (const e of employees) {
        const ids = e.additionalManagerIds || [];
        if (!ids.length) continue;
        const fromEl = boxes[String(e.id)];
        if (!fromEl) continue;
        const f = pos(fromEl);
        for (const mid of ids) {
          const toEl = boxes[String(mid)];
          if (!toEl) continue;
          const t = pos(toEl);
          out.push({
            id: `${e.id}-${mid}`,
            x1: f.x + f.w / 2, y1: f.y,        // employee: top-centre
            x2: t.x + t.w / 2, y2: t.y + t.h,  // manager: bottom-centre
          });
        }
      }
      setLines(out);
    }

    measure();
    // Re-measure if the chart reflows (fonts load, container resizes).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(canvas);
    return () => { if (ro) ro.disconnect(); };
  }, [employees, refreshKey, canvasRef]);

  if (lines.length === 0) return null;
  return (
    <svg className="alt-mgr-lines" aria-hidden="true">
      <defs>
        <marker id="alt-mgr-arrow" viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--brand-teal, #088298)" />
        </marker>
      </defs>
      {lines.map((l) => {
        const midY = (l.y1 + l.y2) / 2;
        const d = `M ${l.x1} ${l.y1} C ${l.x1} ${midY}, ${l.x2} ${midY}, ${l.x2} ${l.y2}`;
        return <path key={l.id} d={d} className="alt-mgr-line" markerEnd="url(#alt-mgr-arrow)" />;
      })}
    </svg>
  );
}
