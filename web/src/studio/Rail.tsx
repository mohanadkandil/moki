import { Minus, Plus, Scan } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The tool dock: the one control surface on the canvas, the composer's sibling across the seam. It sits at the foot of every
 * drawing, and its place never changes. `leading` holds what you're looking at (a view or a layer), the rest are tools.
 */
export function Rail({ label, leading, children }: { label: string; leading?: ReactNode; children: ReactNode }) {
  return (
    <div className="st-dock" role="toolbar" aria-label={label}>
      {leading && <>{leading}<RailGap /></>}
      {children}
    </div>
  );
}

export function RailButton({ label, keys, onClick, pressed, disabled, children }: { label: string; keys?: string; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="st-tool" aria-label={label} aria-keyshortcuts={keys} aria-pressed={pressed} data-tip={keys ? `${label}  ·  ${keys}` : label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** What a drawing shows, down its left side, and what you can do to it, down its right. On a phone the two lie in one strip across the top. */
export function ToolRail({ label, side, children }: { label: string; side: 'left' | 'right'; children: ReactNode }) {
  return <div className="st-rail" data-side={side} role="toolbar" aria-orientation="vertical" aria-label={label}>{children}</div>;
}
export const Rails = ({ children }: { children: ReactNode }) => <div className="st-rails">{children}</div>;
export const RailSplit = () => <span className="st-rail-split" aria-hidden="true" />;

/** The same pill under every drawing. 1.0× is the whole thing fitted to the canvas. */
export function ZoomPill({ label, level, onOut, onIn, onFit, atMin, atMax }: { label: string; level: number; onOut: () => void; onIn: () => void; onFit: () => void; atMin?: boolean; atMax?: boolean }) {
  return (
    <Rail label={label}>
      <RailButton label="Zoom out" onClick={onOut} disabled={atMin}><Minus size={16} /></RailButton>
      <output className="st-dock-zoom" aria-live="off">{level.toFixed(1)}×</output>
      <RailButton label="Zoom in" onClick={onIn} disabled={atMax}><Plus size={16} /></RailButton>
      <RailGap />
      <RailButton label="Fit" keys="F" onClick={onFit}><Scan size={16} /></RailButton>
    </Rail>
  );
}

/** Single-key shortcuts for the pane on screen. They never fire while you're typing, so the chat keeps its letters. */
export function usePaneKeys(keys: Readonly<Record<string, () => void>>) {
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.closest('.st-chat, .st-popover'))) return;
      // The tabs keep their own arrow keys. Letters still reach the pane right after you pick a tab.
      if (t?.closest('[role="tablist"]') && e.key.length > 1 && e.key !== 'Escape') return;
      const run = latest.current[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (run) { e.preventDefault(); run(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export const RailGap = () => <span className="st-tool-gap" aria-hidden="true" />;

/** One choice of view: Board, In case, Exploded. Same shape on every tab that has one. */
export function DockChoice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; label: string; disabled?: boolean; title?: string }[]; onChange: (id: T) => void }) {
  return (
    <div className="st-dock-choice" role="group" aria-label={label}>
      {options.map(o => <button key={o.id} type="button" aria-pressed={value === o.id} disabled={o.disabled} title={o.title} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  );
}
