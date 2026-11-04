import { Minus, Plus, Scan } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { prepareSvg } from './logic';

interface Transform { s: number; x: number; y: number }
const IDENTITY: Transform = { s: 1, x: 0, y: 0 };
const MIN = 0.6;
const MAX = 14;

/**
 * Pan and zoom for a generated SVG, with the same controls as the lab's own drawings. The SVG goes
 * through an <img> from a blob URL rather than inline: its text can come from user-edited TSX, and an
 * image can't run scripts or touch the page.
 */
export default function SvgPane({ text, label, css, tone }: { text: string; label: string; css?: string; tone: 'paper' | 'copper' }) {
  const [t, setT] = useState<Transform>(IDENTITY);
  const [url, setUrl] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(new Blob([prepareSvg(text, css)], { type: 'image/svg+xml' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [text, css]);

  useEffect(() => setT(IDENTITY), [text]);

  function zoomAt(factor: number, cx?: number, cy?: number) {
    const rect = box.current?.getBoundingClientRect();
    const ox = cx ?? (rect ? rect.width / 2 : 0);
    const oy = cy ?? (rect ? rect.height / 2 : 0);
    setT(p => {
      const s = Math.min(MAX, Math.max(MIN, p.s * factor));
      const k = s / p.s;
      return { s, x: ox - (ox - p.x) * k, y: oy - (oy - p.y) * k };
    });
  }

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left, e.clientY - rect.top);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const step = 60;
    const moves: Record<string, () => void> = {
      '+': () => zoomAt(1.25), '=': () => zoomAt(1.25), '-': () => zoomAt(0.8), '0': () => setT(IDENTITY),
      ArrowLeft: () => setT(p => ({ ...p, x: p.x + step })), ArrowRight: () => setT(p => ({ ...p, x: p.x - step })),
      ArrowUp: () => setT(p => ({ ...p, y: p.y + step })), ArrowDown: () => setT(p => ({ ...p, y: p.y - step })),
    };
    const action = moves[e.key];
    if (action) { e.preventDefault(); action(); }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // A touch on an unzoomed drawing scrolls the page, as in the lab's other views.
    if ((e.pointerType === 'touch' && t.s <= 1) || e.button !== 0) return;
    if ((e.target as Element).closest('.lab-zoom')) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, tx: t.x, ty: t.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setT(p => ({ ...p, x: d.tx + e.clientX - d.sx, y: d.ty + e.clientY - d.sy }));
  }

  const endDrag = () => { drag.current = null; };
  const zoomed = t.s !== 1 || t.x !== 0 || t.y !== 0;

  return (
    <div
      ref={box}
      className={`bs-pane is-${tone}`}
      tabIndex={0}
      role="group"
      aria-label={`${label}. Plus and minus keys zoom, arrow keys pan, 0 resets.`}
      style={{ touchAction: t.s > 1 ? 'none' : 'pan-y' }}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {url && <img src={url} alt={label} draggable={false} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }} />}
      <div className="lab-zoom" role="toolbar" aria-label="Zoom">
        <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out" disabled={t.s <= MIN}><Minus size={16} /></button>
        <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in" disabled={t.s >= MAX}><Plus size={16} /></button>
        <button type="button" onClick={() => setT(IDENTITY)} aria-label="Fit drawing" disabled={!zoomed}><Scan size={16} /></button>
      </div>
    </div>
  );
}
