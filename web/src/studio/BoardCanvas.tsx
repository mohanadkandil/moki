import { Cable, CircleDot, Grid3x3, MousePointer2, Move, Redo2, Ruler, RotateCw, Scaling, Type, Undo2, Waypoints, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useArtifact } from '../board/api';
import type { BoardJob } from '../board/types';
import { cornerRadiusOf, describeEdits, editOrigin, editProblems, hasEdits, NO_EDITS, placed, placedBox, placePoint, setPlacement, toEdits, type BoardEdits, type BoardSize, type EditDraft, type UsbEdge } from './editing';
import { obj, objects, str } from './facts';
import { airwires, type BoardModel, type Pad, type Part, type Silk } from './pcbModel';
import { Rails, RailButton, RailSplit, ToolRail, usePaneKeys, ZoomPill } from './Rail';

export interface EditControls {
  /** Null when accepted. Otherwise the server's reason, and no job exists. */
  submit: (edits: BoardEdits, lines: readonly string[]) => Promise<string | null>;
  canEdit: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenJob: (id: string) => void;
}
interface Selection { part: string | null; net: string | null }
type Side = 'top' | 'bottom';
type Tool = 'select' | 'move' | 'measure';
interface Shown { grid: boolean; pads: boolean; nets: boolean; airwires: boolean; labels: boolean; side: Side }

// What you show stays as you left it when you look at another tab.
let shownBefore: Shown = { grid: false, pads: true, nets: true, airwires: false, labels: true, side: 'top' };

const MAX_ZOOM = 24;
const MIN_ZOOM = 0.5;
const SNAP_MM = 0.5;
const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM;
const FACE_EDGE: Record<string, UsbEdge> = { x_neg: 'left', x_pos: 'right', y_neg: 'bottom', y_pos: 'top' };

function silkElement(s: Silk, key: number) {
  if (s.kind === 'text') {
    const anchor = s.anchor.includes('left') ? 'start' : s.anchor.includes('right') ? 'end' : 'middle';
    const base = s.anchor.includes('top') ? 'hanging' : s.anchor.includes('bottom') ? 'auto' : 'central';
    return <text key={key} className="pb-text" x={s.x} y={-s.y} fontSize={s.size} textAnchor={anchor} dominantBaseline={base} transform={s.rotation ? `rotate(${-s.rotation} ${s.x} ${-s.y})` : undefined}>{s.text}</text>;
  }
  if (s.kind === 'path') return <polyline key={key} className="pb-silk" points={s.points.map(([x, y]) => `${x},${-y}`).join(' ')} strokeWidth={s.width} />;
  if (s.kind === 'rect') return <rect key={key} className={s.filled ? 'pb-silk is-filled' : 'pb-silk'} x={s.x - s.w / 2} y={-s.y - s.h / 2} width={s.w} height={s.h} strokeWidth={s.width} transform={s.rotation ? `rotate(${-s.rotation} ${s.x} ${-s.y})` : undefined} />;
  return <circle key={key} className="pb-silk" cx={s.x} cy={-s.y} r={s.r} strokeWidth={s.width} />;
}

function PadShape({ pad, part }: { pad: Pad; part: string }) {
  const r = pad.round ? Math.min(pad.w, pad.h) / 2 : 0.08;
  const turn = pad.rotation ? `rotate(${-pad.rotation} ${pad.x} ${-pad.y})` : undefined;
  return (
    <g className="pb-pad" data-part={part} data-net={pad.net ?? undefined} data-copper={pad.layers.join(' ')}>
      <rect x={pad.x - pad.w / 2} y={-pad.y - pad.h / 2} width={pad.w} height={pad.h} rx={r} transform={turn} />
      {pad.holeW > 0 && <rect className="pb-pad-hole" x={pad.x - pad.holeW / 2} y={-pad.y - pad.holeH / 2} width={pad.holeW} height={pad.holeH} rx={Math.min(pad.holeW, pad.holeH) / 2} transform={turn} />}
    </g>
  );
}

const partTransform = (part: Part, x: number, y: number, rotation: number) => {
  const turned = rotation - part.rotation;
  const parts = [`translate(${x - part.x} ${-(y - part.y)})`];
  if (turned) parts.push(`rotate(${-turned} ${part.x} ${-part.y})`);
  return parts.join(' ');
};

const PartHit = memo(function PartHit({ part, x, y, rotation, onKeyPick }: { part: Part; x: number; y: number; rotation: number; onKeyPick: (ref: string) => void }) {
  const e = part.envelope;
  return <rect className="pb-hit" data-part={part.ref} x={e.x - e.w / 2} y={-e.y - e.h / 2} width={e.w} height={e.h} rx={0.4} transform={partTransform(part, x, y, rotation)} tabIndex={0} role="button" aria-label={`${part.ref}${part.name ? `, ${part.name}` : ''}`} onKeyDown={(k: ReactKeyboardEvent) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); k.stopPropagation(); onKeyPick(part.ref); } }} />;
});

const PartBody = memo(function PartBody({ part, x, y, rotation, side, pads, labels }: { part: Part; x: number; y: number; rotation: number; side: Side; pads: boolean; labels: boolean }) {
  return (
    <g className="pb-part" transform={partTransform(part, x, y, rotation)}>
      {part.silk.filter(s => s.layer === side && (labels || s.kind !== 'text')).map(silkElement)}
      {pads && part.pads.map((pad, i) => <PadShape key={i} pad={pad} part={part.ref} />)}
    </g>
  );
});

/** The copper in the order you'd see it from the side you're on. It only redraws when the side does. */
const Copper = memo(function Copper({ model, side, nets }: { model: BoardModel; side: Side; nets: boolean }) {
  const order: Side[] = side === 'top' ? ['bottom', 'top'] : ['top', 'bottom'];
  return (
    <>
      {order.map(layer => (
        <g key={layer} className={`pb-layer${layer === side ? ' is-near' : ' is-far'}`} data-layer={layer}>
          {model.pours.filter(p => p.layer === layer).map((p, i) => <path key={i} className="pb-pour" d={p.path} fillRule="evenodd" data-net={p.net ?? undefined} />)}
          {model.traces.flatMap((t, i) => t.runs.filter(r => r.layer === layer).map((r, j) => {
            const points = r.points.map(([x, y]) => `${x},${-y}`).join(' ');
            return (
              <g key={`${i}-${j}`} data-net={t.net ?? undefined}>
                <polyline className="pb-trace" points={points} strokeWidth={r.width} />
                {nets && <polyline className="pb-trace-hit" points={points} />}
              </g>
            );
          }))}
        </g>
      ))}
      {model.vias.map((v, i) => (
        <g key={i} className="pb-via" data-net={v.net ?? undefined}>
          <circle cx={v.x} cy={-v.y} r={v.outer / 2} />
          <circle className="pb-pad-hole" cx={v.x} cy={-v.y} r={v.hole / 2} />
        </g>
      ))}
    </>
  );
});

function roundedOutline(b: BoardModel['board'], size: BoardSize | undefined): string {
  if (!size && b.outline.length > 2) return `M${b.outline.map(([x, y]) => `${x} ${-y}`).join('L')}Z`;
  const [w, h, r] = size ? [size.widthMm, size.heightMm, Math.min(size.cornerRadiusMm, size.widthMm / 2, size.heightMm / 2)] : [b.w, b.h, 0];
  const [x, y] = [b.x - w / 2, -b.y - h / 2];
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

function BoardSettings({ model, job, draft, setDraft, onClose }: { model: BoardModel; job: BoardJob; draft: EditDraft; setDraft: (d: EditDraft) => void; onClose: () => void }) {
  const enclosure = useArtifact(job.artifacts?.['enclosure.json'], res => res.json() as Promise<unknown>);
  const usb = objects(obj(enclosure.state === 'ready' ? enclosure.value : null).apertures).find(a => a.purpose === 'usb');
  const edgeNow = usb ? FACE_EDGE[str(usb.face) ?? ''] ?? null : null;
  const base: BoardSize = { widthMm: model.board.w, heightMm: model.board.h, cornerRadiusMm: cornerRadiusOf(model.board) };
  const size = draft.board ?? base;
  const update = (field: keyof BoardSize, text: string) => {
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) return;
    const next = { ...size, [field]: value };
    const { board: _gone, ...rest } = draft;
    setDraft(next.widthMm === base.widthMm && next.heightMm === base.heightMm && next.cornerRadiusMm === base.cornerRadiusMm ? rest : { ...rest, board: next });
  };
  const rows: readonly (readonly [keyof BoardSize, string, number])[] = [['widthMm', 'Width', 10], ['heightMm', 'Height', 10], ['cornerRadiusMm', 'Corner radius', 0]];
  return (
    <div className="st-board-settings st-sheet" role="dialog" aria-label="Board size and USB edge">
      <header><strong>Board</strong><button type="button" className="st-part-card-close" aria-label="Close board settings" onClick={onClose}><X size={14} aria-hidden="true" /></button></header>
      {rows.map(([field, label, min]) => (
        <label key={field}><span>{label}</span><span className="st-mm-field"><input type="number" inputMode="decimal" step="0.5" min={min} value={size[field]} onChange={e => update(field, e.target.value)} /><em>mm</em></span></label>
      ))}
      <p className="st-board-settings-head">USB edge{edgeNow ? `, now ${edgeNow}` : ''}</p>
      <div className="st-dock-choice" role="group" aria-label="USB edge">
        {(['left', 'top', 'bottom', 'right'] as const).map(edge => (
          <button key={edge} type="button" aria-pressed={(draft.usbEdge ?? edgeNow) === edge} onClick={() => { const { usbEdge: _gone, ...rest } = draft; setDraft(edge === edgeNow ? rest : { ...rest, usbEdge: edge }); }}>{edge[0]!.toUpperCase() + edge.slice(1)}</button>
        ))}
      </div>
    </div>
  );
}

export default function BoardCanvas({ model, job, selection, setSelection, edit }: { model: BoardModel; job: BoardJob; selection: Selection; setSelection: (s: Selection) => void; edit: EditControls }) {
  const host = useRef<HTMLDivElement>(null);
  const [shown, setShownState] = useState<Shown>(shownBefore);
  const setShown = (patch: Partial<Shown>) => setShownState(s => (shownBefore = { ...s, ...patch }));
  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [fit, setFit] = useState({ s: 1, x: 0, y: 0 });
  const touched = useRef(false);
  const [hover, setHover] = useState<{ part: string | null; net: string | null }>({ part: null, net: null });
  const [draft, setDraft] = useState<EditDraft>(NO_EDITS);
  const [settings, setSettings] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [measure, setMeasure] = useState<{ a: readonly [number, number] | null; b: readonly [number, number] | null; live: boolean }>({ a: null, b: null, live: false });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'part' | 'pinch'; sx: number; sy: number; vx: number; vy: number; moved: boolean; part?: Part; px?: number; py?: number; d?: number; vs?: number } | null>(null);

  const b = model.board;
  const shownBoard = draft.board ? { w: draft.board.widthMm, h: draft.board.heightMm } : { w: b.w, h: b.h };

  // Fits the board into what the rails and pill leave free. Any size change refits until you've moved the view yourself.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measureFit = () => {
      const phone = window.matchMedia('(max-width: 1000px)').matches;
      const [l, r, t, f] = phone ? [14, 14, 68, 70] : [68, 68, 28, 76];
      const [W, H] = [el.clientWidth, el.clientHeight];
      const s = Math.max(Math.min((W - l - r) / b.w, (H - t - f) / b.h), 0.1);
      const next = { s, x: l + (W - l - r) / 2, y: t + (H - t - f) / 2 };
      setFit(next);
      if (!touched.current) setView(next);
    };
    const observer = new ResizeObserver(measureFit);
    observer.observe(el);
    measureFit();
    return () => observer.disconnect();
  }, [b.w, b.h]);

  const toScreen = (x: number, y: number) => [view.x + view.s * (x - b.x), view.y - view.s * (y - b.y)] as const;
  const toBoard = (clientX: number, clientY: number): [number, number] => {
    const r = host.current!.getBoundingClientRect();
    return [(clientX - r.left - view.x) / view.s + b.x, -(clientY - r.top - view.y) / view.s + b.y];
  };
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    touched.current = true;
    const r = host.current?.getBoundingClientRect();
    const [ox, oy] = [cx ?? (r ? r.width / 2 : 0), cy ?? (r ? r.height / 2 : 0)];
    setView(p => {
      const s = Math.min(fit.s * MAX_ZOOM, Math.max(fit.s * MIN_ZOOM, p.s * factor));
      const k = s / p.s;
      return { s, x: ox - (ox - p.x) * k, y: oy - (oy - p.y) * k };
    });
  };
  const fitNow = () => { touched.current = false; setView(fit); };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) < 1) zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
      else { touched.current = true; setView(p => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY })); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.s]);

  const pads = useMemo(() => model.parts.flatMap(part => part.pads.map(pad => ({ part, pad }))), [model]);
  const snapMeasure = (x: number, y: number): [number, number] => {
    let best: [number, number] = [x, y];
    let nearest = (14 / view.s) ** 2;
    for (const { part, pad } of pads) {
      const [px, py] = placePoint(part, placed(draft, part), pad.x, pad.y);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < nearest) { nearest = d; best = [px, py]; }
    }
    return best;
  };

  const selected = model.parts.find(p => p.ref === selection.part) ?? null;
  const pick = (part: string | null, net?: string | null) => setSelection({ part, net: net === undefined ? selection.net : shown.nets ? net : null });
  const rotate = () => { if (selected && tool === 'move') { const at = placed(draft, selected); setDraft(setPlacement(draft, selected, { ...at, rotation: at.rotation + 90 })); setRejected(null); } };
  const nudge = (dx: number, dy: number) => { if (selected && tool === 'move') { const at = placed(draft, selected); setDraft(setPlacement(draft, selected, { ...at, x: at.x + dx, y: at.y + dy })); setRejected(null); } };
  const cancel = () => {
    if (settings) { setSettings(false); return; }
    if (tool === 'measure' && (measure.a || measure.b)) { setMeasure({ a: null, b: null, live: false }); return; }
    if (tool !== 'select') { setTool('select'); return; }
    setSelection({ part: null, net: null });
  };
  usePaneKeys({
    g: () => setShown({ grid: !shown.grid }),
    m: () => { setTool(t => (t === 'measure' ? 'select' : 'measure')); setMeasure({ a: null, b: null, live: false }); },
    f: fitNow,
    p: () => setShown({ pads: !shown.pads }),
    n: () => { setShown({ nets: !shown.nets }); setHover(h => ({ ...h, net: null })); if (shown.nets) setSelection({ ...selection, net: null }); },
    a: () => setShown({ airwires: !shown.airwires }),
    l: () => setShown({ labels: !shown.labels }),
    b: () => setShown({ side: shown.side === 'top' ? 'bottom' : 'top' }),
    v: () => setTool('select'),
    ...(edit.canEdit ? { e: () => setTool(t => (t === 'move' ? 'select' : 'move')), r: rotate } : {}),
    '+': () => zoomAt(1.25), '=': () => zoomAt(1.25), '-': () => zoomAt(0.8), '0': fitNow,
    ArrowLeft: () => (tool === 'move' && selected ? nudge(-1, 0) : setView(p => ({ ...p, x: p.x + 60 }))),
    ArrowRight: () => (tool === 'move' && selected ? nudge(1, 0) : setView(p => ({ ...p, x: p.x - 60 }))),
    ArrowUp: () => (tool === 'move' && selected ? nudge(0, 1) : setView(p => ({ ...p, y: p.y + 60 }))),
    ArrowDown: () => (tool === 'move' && selected ? nudge(0, -1) : setView(p => ({ ...p, y: p.y - 60 }))),
    Escape: cancel,
  });

  const under = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-part], [data-net]') as HTMLElement | SVGElement | null;
  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !(e.target as Element).closest('.st-board')) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { kind: 'pinch', sx: (p.x + q.x) / 2, sy: (p.y + q.y) / 2, vx: view.x, vy: view.y, moved: true, d: Math.hypot(p.x - q.x, p.y - q.y), vs: view.s };
      return;
    }
    const hit = tool === 'move' ? (e.target as Element).closest('[data-part]') : null;
    const part = hit ? model.parts.find(p => p.ref === hit.getAttribute('data-part')) : undefined;
    if (part) {
      const at = placed(draft, part);
      gesture.current = { kind: 'part', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, part, px: at.x, py: at.y };
      if (selection.part !== part.ref) pick(part.ref, null);
      return;
    }
    gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  }
  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) {
      if (tool === 'measure' && measure.a && measure.live) { const [x, y] = toBoard(e.clientX, e.clientY); setMeasure(m => ({ ...m, b: snapMeasure(x, y) })); }
      if (e.pointerType === 'touch') return;
      const el = under(e.clientX, e.clientY);
      const next = { part: el?.getAttribute('data-part') ?? null, net: shown.nets && tool === 'select' ? el?.getAttribute('data-net') ?? null : null };
      if (next.part !== hover.part || next.net !== hover.net) setHover(next);
      return;
    }
    if (g.kind === 'pinch') {
      const [p, q] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      if (!p || !q) return;
      touched.current = true;
      const r = host.current!.getBoundingClientRect();
      const s = Math.min(fit.s * MAX_ZOOM, Math.max(fit.s * MIN_ZOOM, g.vs! * (Math.hypot(p.x - q.x, p.y - q.y) / g.d!)));
      const k = s / g.vs!;
      const [cx, cy] = [(p.x + q.x) / 2 - r.left, (p.y + q.y) / 2 - r.top];
      setView({ s, x: cx - (g.sx - r.left - g.vx) * k, y: cy - (g.sy - r.top - g.vy) * k });
      return;
    }
    const [dx, dy] = [e.clientX - g.sx, e.clientY - g.sy];
    if (!g.moved && Math.hypot(dx, dy) < 5) return;
    g.moved = true;
    if (g.kind === 'part') {
      const at = placed(draft, g.part!);
      setDraft(setPlacement(draft, g.part!, { x: g.px! + snap(dx / view.s), y: g.py! + snap(-dy / view.s), rotation: at.rotation }));
      setRejected(null);
      return;
    }
    touched.current = true;
    setView(p => ({ ...p, x: g.vx + dx, y: g.vy + dy }));
  }
  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) gesture.current = null;
    if (!g || g.moved || e.type === 'pointercancel') return;
    if (tool === 'measure') {
      const [x, y] = toBoard(e.clientX, e.clientY);
      const at = snapMeasure(x, y);
      setMeasure(m => (!m.a || !m.live ? { a: at, b: at, live: true } : { a: m.a, b: at, live: false }));
      return;
    }
    const el = under(e.clientX, e.clientY);
    // A fingertip covers a trace and the part beneath it, so a tap reaches the part as well. A pointer can choose.
    const beneath = e.pointerType === 'touch' ? document.elementsFromPoint(e.clientX, e.clientY).find(n => n.hasAttribute('data-part')) : null;
    const part = el?.closest('[data-part]')?.getAttribute('data-part') ?? beneath?.getAttribute('data-part') ?? null;
    const net = el?.closest('[data-net]')?.getAttribute('data-net') ?? null;
    if (part || net) pick(part ?? selection.part, net);
    else setSelection({ part: null, net: null });
  }

  const net = shown.nets ? selection.net ?? hover.net : null;
  const netInfo = net ? model.nets.get(net) : null;
  const moved = hasEdits(draft);
  const wires = useMemo(() => {
    const movedRefs = new Set(Object.keys(draft.placements));
    if (!shown.airwires && !movedRefs.size) return [];
    const all = airwires(model, (ref, x, y) => { const part = model.parts.find(p => p.ref === ref)!; return placePoint(part, placed(draft, part), x, y); });
    if (shown.airwires) return all;
    const touchedNets = new Set(model.parts.filter(p => movedRefs.has(p.ref)).flatMap(p => p.pads.map(pad => pad.net)));
    return all.filter(w => touchedNets.has(w.net));
  }, [model, draft, shown.airwires]);
  const lines = useMemo(() => describeEdits(model, draft), [model, draft]);
  const problems = useMemo(() => editProblems(model, draft), [model, draft]);
  const origin = editOrigin(job as never);
  const gridMm = [1, 2, 5, 10, 20].find(m => m * view.s >= 14) ?? 50;
  const zoom = view.s / fit.s;
  const outline = useMemo(() => roundedOutline(b, draft.board), [b, draft.board]);

  const box = selected ? placedBox(selected, placed(draft, selected)) : null;
  const hoverPart = hover.part && hover.part !== selection.part ? model.parts.find(p => p.ref === hover.part) : null;
  const hoverBox = hoverPart ? placedBox(hoverPart, placed(draft, hoverPart)) : null;
  const distance = measure.a && measure.b ? Math.hypot(measure.a[0] - measure.b[0], measure.a[1] - measure.b[1]) : 0;
  const onSubmit = async () => {
    setSending(true);
    const reason = await edit.submit(toEdits(draft), lines);
    setSending(false);
    if (reason) setRejected(reason); else { setDraft(NO_EDITS); setTool('select'); }
  };

  return (
    <div className="st-pcb" ref={host} data-tool={tool} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover({ part: null, net: null })}>
      <svg className={`st-board${net ? ' has-net' : ''}${moved ? ' has-draft' : ''}${tool !== 'select' ? ' is-tooling' : ''}`} data-side={shown.side} role="img" aria-label={`PCB drawing, ${b.w} by ${b.h} millimetres`}>
        {net && <style>{`.st-board [data-net="${CSS.escape(net)}"]{opacity:1}.st-board .pb-layer [data-net="${CSS.escape(net)}"] .pb-trace{stroke:#ffd9a8}.st-board .pb-pour[data-net="${CSS.escape(net)}"]{opacity:.14}.st-board .pb-pad[data-net="${CSS.escape(net)}"] rect:not(.pb-pad-hole){fill:#ffe9b8}`}</style>}
        <defs>
          <pattern id="st-board-grid" width={gridMm} height={gridMm} patternUnits="userSpaceOnUse" x={b.x} y={-b.y}><path d={`M${gridMm} 0H0V${gridMm}`} className="pb-grid-line" /></pattern>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.s}) translate(${-b.x} ${b.y})`}>
          <path className="pb-board" d={outline} />
          {model.parts.map(part => { const at = placed(draft, part); return <PartHit key={part.ref} part={part} x={at.x} y={at.y} rotation={at.rotation} onKeyPick={ref => pick(ref, null)} />; })}
          <g className="pb-copper"><Copper model={model} side={shown.side} nets={shown.nets} /></g>
          {model.holes.map((h, i) => <circle key={i} className="pb-hole" cx={h.x} cy={-h.y} r={h.d / 2} />)}
          {model.silk.filter(s => s.layer === shown.side && (shown.labels || s.kind !== 'text')).map(silkElement)}
          {model.parts.map(part => { const at = placed(draft, part); return <PartBody key={part.ref} part={part} x={at.x} y={at.y} rotation={at.rotation} side={shown.side} pads={shown.pads} labels={shown.labels} />; })}
          {shown.grid && <rect className="pb-grid" x={b.x - 400} y={-b.y - 400} width={800} height={800} fill="url(#st-board-grid)" />}
          {wires.map((w, i) => <line key={i} className="pb-airwire" x1={w.from[0]} y1={-w.from[1]} x2={w.to[0]} y2={-w.to[1]} />)}
          {hoverBox && <rect className="pb-outline is-hover" x={hoverBox.x0} y={-hoverBox.y1} width={hoverBox.x1 - hoverBox.x0} height={hoverBox.y1 - hoverBox.y0} rx={0.4} />}
          {box && <rect className={`pb-outline is-picked${problems.some(p => p.includes(selected!.ref)) ? ' is-bad' : ''}`} x={box.x0} y={-box.y1} width={box.x1 - box.x0} height={box.y1 - box.y0} rx={0.4} />}
          {measure.a && measure.b && (
            <>
              <line className="pb-measure" x1={measure.a[0]} y1={-measure.a[1]} x2={measure.b[0]} y2={-measure.b[1]} />
              <circle className="pb-measure-end" cx={measure.a[0]} cy={-measure.a[1]} r={4 / view.s} />
              <circle className="pb-measure-end" cx={measure.b[0]} cy={-measure.b[1]} r={4 / view.s} />
            </>
          )}
        </g>
      </svg>
      {selected && box && <span className="st-board-tag" style={{ left: toScreen((box.x0 + box.x1) / 2, box.y1)[0], top: toScreen((box.x0 + box.x1) / 2, box.y1)[1] }}>{selected.ref}</span>}
      {measure.a && measure.b && distance > 0 && (
        <output className="st-measure-readout" style={{ left: toScreen((measure.a[0] + measure.b[0]) / 2, (measure.a[1] + measure.b[1]) / 2)[0], top: toScreen((measure.a[0] + measure.b[0]) / 2, (measure.a[1] + measure.b[1]) / 2)[1] }}>
          <strong>{distance.toFixed(2)} mm</strong>
          <span>{`Δx ${Math.abs(measure.a[0] - measure.b[0]).toFixed(2)} · Δy ${Math.abs(measure.a[1] - measure.b[1]).toFixed(2)}`}</span>
        </output>
      )}
      {tool === 'measure' && !measure.a && <p className="st-tool-hint" role="status">Click two points. It snaps to pads.</p>}
      {tool === 'move' && !moved && <p className="st-tool-hint" role="status">Drag a part. R turns it, arrow keys nudge it 1 mm.</p>}

      <div className="st-board-size" aria-label="Board size">
        {`${+shownBoard.w.toFixed(1)} × ${+shownBoard.h.toFixed(1)} mm`}
        {shown.grid && <em>{`Grid ${gridMm} mm`}</em>}
        {netInfo && <em className="is-net">{`${netInfo.name} · ${netInfo.pins.length} pins`}</em>}
      </div>

      <Rails>
        <ToolRail label="Show on the PCB" side="left">
          <RailButton label="Grid" keys="G" pressed={shown.grid} onClick={() => setShown({ grid: !shown.grid })}><Grid3x3 size={16} /></RailButton>
          <RailButton label="Pads" keys="P" pressed={shown.pads} onClick={() => setShown({ pads: !shown.pads })}><CircleDot size={16} /></RailButton>
          <RailButton label="Highlight nets" keys="N" pressed={shown.nets} onClick={() => { setShown({ nets: !shown.nets }); setHover(h => ({ ...h, net: null })); if (shown.nets) setSelection({ ...selection, net: null }); }}><Waypoints size={16} /></RailButton>
          <RailButton label="Airwires" keys="A" pressed={shown.airwires} onClick={() => setShown({ airwires: !shown.airwires })}><Cable size={16} /></RailButton>
          <RailButton label="Labels" keys="L" pressed={shown.labels} onClick={() => setShown({ labels: !shown.labels })}><Type size={16} /></RailButton>
          <RailSplit />
          <RailButton label="Front layer" pressed={shown.side === 'top'} onClick={() => setShown({ side: 'top' })}><span className="st-tool-text">F</span></RailButton>
          <RailButton label="Back layer" keys="B" pressed={shown.side === 'bottom'} onClick={() => setShown({ side: 'bottom' })}><span className="st-tool-text">B</span></RailButton>
        </ToolRail>
        <ToolRail label="PCB tools" side="right">
          <RailButton label="Select" keys="V" pressed={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={16} /></RailButton>
          <RailButton label="Measure" keys="M" pressed={tool === 'measure'} onClick={() => { setTool(t => (t === 'measure' ? 'select' : 'measure')); setMeasure({ a: null, b: null, live: false }); }}><Ruler size={16} /></RailButton>
          {edit.canEdit && (
            <>
              <RailSplit />
              <RailButton label="Move parts" keys="E" pressed={tool === 'move'} onClick={() => setTool(t => (t === 'move' ? 'select' : 'move'))}><Move size={16} /></RailButton>
              <RailButton label="Turn part 90°" keys="R" disabled={tool !== 'move' || !selected} onClick={rotate}><RotateCw size={16} /></RailButton>
              <RailButton label="Board size and USB edge" pressed={settings} onClick={() => setSettings(o => !o)}><Scaling size={16} /></RailButton>
            </>
          )}
          {(edit.onUndo || edit.onRedo) && (
            <>
              <RailSplit />
              <RailButton label="Undo: back to the build this came from" disabled={!edit.onUndo} onClick={() => edit.onUndo?.()}><Undo2 size={16} /></RailButton>
              <RailButton label="Redo" disabled={!edit.onRedo} onClick={() => edit.onRedo?.()}><Redo2 size={16} /></RailButton>
            </>
          )}
        </ToolRail>
      </Rails>

      {settings && <BoardSettings model={model} job={job} draft={draft} setDraft={d => { setDraft(d); setRejected(null); }} onClose={() => setSettings(false)} />}

      {moved ? (
        <div className="st-edit-bar st-sheet" role="status">
          <div className="st-edit-lines">
            {lines.map(line => <p key={line}>{line}</p>)}
            {rejected ? <p className="is-bad">{rejected}</p> : problems.map(p => <p key={p} className="is-warn">{p}</p>)}
          </div>
          <button type="button" className="st-ghost" onClick={() => { setDraft(NO_EDITS); setRejected(null); }}>Discard</button>
          <button type="button" className="st-primary" disabled={sending || !edit.canEdit} onClick={() => void onSubmit()}>{sending ? 'Sending' : 'Rebuild'}</button>
        </div>
      ) : origin && (
        <div className="st-edit-origin">
          <span>Edited from</span>
          {origin.baseJobId ? <button type="button" onClick={() => edit.onOpenJob(origin.baseJobId!)}>{origin.baseJobId.slice(0, 8)}</button> : <span>an earlier build</span>}
          {origin.lines.length > 0 && <em>{origin.lines.join(' · ')}</em>}
        </div>
      )}

      <ZoomPill label="PCB zoom" level={zoom} onOut={() => zoomAt(0.8)} onIn={() => zoomAt(1.25)} onFit={fitNow} atMin={zoom <= MIN_ZOOM + 0.001} atMax={zoom >= MAX_ZOOM - 0.001} />
    </div>
  );
}
