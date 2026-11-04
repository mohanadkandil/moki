import { Grid3x3 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { prepareSvg } from '../board/logic';
import { Rails, RailButton, ToolRail, usePaneKeys, ZoomPill } from './Rail';

interface View { s: number; x: number; y: number }
const FIT: View = { s: 1, x: 0, y: 0 };
const MIN = 0.5;
const MAX = 16;
/** The title block's height plus the sheet's top margin and frame padding. */
const TITLE_BLOCK_PX = 88;

function svgAspect(text: string): number | null {
  const open = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
  const box = /viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/i.exec(open);
  const w = Number(box?.[1] ?? /\bwidth="([\d.]+)/i.exec(open)?.[1]);
  const h = Number(box?.[2] ?? /\bheight="([\d.]+)/i.exec(open)?.[1]);
  return w > 0 && h > 0 ? w / h : null;
}

/**
 * A generated SVG with real pan and zoom. It stays an <img> from a blob URL because the text can come
 * from edited TSX, and an image can't run scripts. Zoom changes layout size, not a CSS scale, so the
 * browser redraws the vectors at each step and small labels stay sharp.
 */
export default function DrawingPane({ text, css, label, tone, tools, overlay, onPick, onClear, titleBlock }: { text: string; css?: string; label: string; tone: 'paper' | 'copper'; tools?: ReactNode; /** Drawn over the art, in its coordinates. */ overlay?: ReactNode; /** A click that didn't drag, with what's under it. */ onPick?: (under: Element | null) => void; onClear?: () => void; titleBlock?: readonly (readonly [string, string])[] }) {
  const [view, setView] = useState<View>(FIT);
  const [grid, setGrid] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(new Blob([prepareSvg(text, css)], { type: 'image/svg+xml' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [text, css]);
  useEffect(() => setView(FIT), [text]);

  // A sheet takes its drawing's proportions, so it reads as a sheet and not as a drawing lost in a tall page.
  const [sheet, setSheet] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    const aspect = titleBlock ? svgAspect(text) : null;
    if (!el || !aspect) { setSheet(null); return; }
    const measure = () => {
      const style = getComputedStyle(el);
      const inset = parseFloat(style.getPropertyValue('--inset')) || 0;
      const foot = parseFloat(style.getPropertyValue('--inset-foot')) || 0;
      const roomW = Math.max(el.clientWidth - inset * 2, 1);
      const roomH = Math.max(el.clientHeight - inset - foot, 1);
      const w = Math.min(roomW, (roomH - TITLE_BLOCK_PX) * aspect);
      const h = w / aspect + TITLE_BLOCK_PX;
      setSheet({ x: (el.clientWidth - w) / 2, y: inset + (roomH - h) / 2, w, h });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [text, titleBlock]);

  function zoom(factor: number, cx?: number, cy?: number) {
    const rect = box.current?.getBoundingClientRect();
    const ox = cx ?? (rect ? rect.width / 2 : 0);
    const oy = cy ?? (rect ? rect.height / 2 : 0);
    setView(p => {
      const s = Math.min(MAX, Math.max(MIN, p.s * factor));
      const k = s / p.s;
      return { s, x: ox - (ox - p.x) * k, y: oy - (oy - p.y) * k };
    });
  }

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) < 1) zoom(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left, e.clientY - rect.top);
      else setView(p => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const step = 60;
    const moves: Record<string, () => void> = {
      '+': () => zoom(1.25), '=': () => zoom(1.25), '-': () => zoom(0.8), '0': () => setView(FIT),
      ArrowLeft: () => setView(p => ({ ...p, x: p.x + step })), ArrowRight: () => setView(p => ({ ...p, x: p.x - step })),
      ArrowUp: () => setView(p => ({ ...p, y: p.y + step })), ArrowDown: () => setView(p => ({ ...p, y: p.y - step })),
    };
    const move = moves[e.key];
    if (move) { e.preventDefault(); move(); }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as Element).closest('.st-dock, .st-rails')) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    d.moved = true;
    setView(p => ({ ...p, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && e.type === 'pointerup') onPick?.(document.elementFromPoint(e.clientX, e.clientY));
  };
  usePaneKeys({ g: () => setGrid(g => !g), f: () => setView(FIT), ...(onClear ? { Escape: onClear } : {}) });

  return (
    <div
      ref={box}
      className={`st-drawing is-${tone}`}
      tabIndex={0}
      role="group"
      aria-label={`${label}. Plus and minus zoom, arrow keys pan, 0 fits.`}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {url && (
        <div className="st-drawing-sheet" style={sheet
          ? { left: sheet.x + view.x, top: sheet.y + view.y, width: sheet.w * view.s, height: (sheet.h - TITLE_BLOCK_PX) * view.s + TITLE_BLOCK_PX }
          : { left: `calc(var(--inset) + ${view.x}px)`, top: `calc(var(--inset) + ${view.y}px)`, width: `calc((100% - var(--inset) - var(--inset-end)) * ${view.s})`, height: `calc((100% - var(--inset) - var(--inset-foot)) * ${view.s})` }}>
          <div className="st-drawing-art">
            <img src={url} alt={label} draggable={false} />
            {overlay}
            {grid && <div className="st-drawing-grid" style={{ backgroundSize: `${24 * view.s}px ${24 * view.s}px` }} aria-hidden="true" />}
          </div>
          {titleBlock && (
            <dl className="st-title-block">
              {titleBlock.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          )}
        </div>
      )}
      <Rails>
        <ToolRail label={`Show on the ${label}`} side="left">
          <RailButton label="Grid" keys="G" pressed={grid} onClick={() => setGrid(g => !g)}><Grid3x3 size={16} /></RailButton>
          {tools}
        </ToolRail>
      </Rails>
      <ZoomPill label={`${label} zoom`} level={view.s} onOut={() => zoom(0.8)} onIn={() => zoom(1.25)} onFit={() => setView(FIT)} atMin={view.s <= MIN} atMax={view.s >= MAX} />
    </div>
  );
}
