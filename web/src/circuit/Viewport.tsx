import { Minus, Plus, Scan } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

interface Transform { s: number; x: number; y: number }
const IDENTITY: Transform = { s: 1, x: 0, y: 0 };
const MIN = 0.6;
const MAX = 5;

/** An SVG drawing area with zoom (buttons, ctrl/⌘ + wheel, keys) and drag-to-pan for mouse and pen. */
export default function Viewport({ width, height, label, resetKey, svgRef, className, children }: {
  width: number; height: number; label: string; resetKey: string; svgRef: RefObject<SVGSVGElement | null>; className?: string; children: ReactNode;
}) {
  const [t, setT] = useState<Transform>(IDENTITY);
  const drag = useRef<{ id: number; sx: number; sy: number; tx: number; ty: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => setT(IDENTITY), [resetKey]);

  function toSvg(clientX: number, clientY: number) {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: width / 2, y: height / 2 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function zoomAt(factor: number, cx = width / 2, cy = height / 2) {
    setT(p => {
      const s = Math.min(MAX, Math.max(MIN, p.s * factor));
      const k = s / p.s;
      return { s, x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k };
    });
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(Math.exp(-e.deltaY * 0.0025), p.x, p.y);
    }
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const step = Math.max(width, height) * 0.06;
    const moves: Record<string, () => void> = {
      '+': () => zoomAt(1.25), '=': () => zoomAt(1.25), '-': () => zoomAt(0.8), '0': () => setT(IDENTITY),
      ArrowLeft: () => setT(p => ({ ...p, x: p.x + step })), ArrowRight: () => setT(p => ({ ...p, x: p.x - step })),
      ArrowUp: () => setT(p => ({ ...p, y: p.y + step })), ArrowDown: () => setT(p => ({ ...p, y: p.y - step })),
    };
    const action = moves[e.key];
    if (action) { e.preventDefault(); action(); }
  }

  const zoomed = t.s !== 1 || t.x !== 0 || t.y !== 0;

  return (
    <div
      className={`lab-viewport ${className ?? ''}`}
      tabIndex={0}
      role="group"
      aria-label={`${label}. Plus and minus keys zoom, arrow keys pan, 0 resets.`}
      onKeyDown={onKeyDown}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        style={{ touchAction: t.s > 1 ? 'none' : 'pan-y' }}
        className={drag.current?.moved ? 'is-panning' : ''}
        onPointerDown={e => {
          if ((e.pointerType === 'touch' && t.s <= 1) || e.button !== 0) return;
          drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, tx: t.x, ty: t.y, moved: false };
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const ctm = svgRef.current?.getScreenCTM();
          const scale = ctm?.a || 1;
          const dx = e.clientX - d.sx;
          const dy = e.clientY - d.sy;
          if (!d.moved && Math.hypot(dx, dy) > 4) { d.moved = true; e.currentTarget.setPointerCapture(e.pointerId); }
          if (d.moved) setT(p => ({ ...p, x: d.tx + dx / scale, y: d.ty + dy / scale }));
        }}
        onPointerUp={e => {
          if (drag.current?.moved) suppressClick.current = true;
          if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          drag.current = null;
        }}
        onPointerCancel={() => { drag.current = null; }}
        onClickCapture={e => {
          if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); suppressClick.current = false; }
        }}
      >
        <g data-viewport="" transform={`translate(${t.x} ${t.y}) scale(${t.s})`}>{children}</g>
      </svg>
      <div className="lab-zoom" role="toolbar" aria-label="Zoom">
        <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out" disabled={t.s <= MIN}><Minus size={16} /></button>
        <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in" disabled={t.s >= MAX}><Plus size={16} /></button>
        <button type="button" onClick={() => setT(IDENTITY)} aria-label="Fit drawing" disabled={!zoomed}><Scan size={16} /></button>
      </div>
    </div>
  );
}
