import { Bot, CircleDot, CircleOff, Eraser, FileText, Grid3x3, Hand, Minus, MousePointer2, Package, Plus, Redo2, Ruler, Scan, Spline, Tag, Type, Undo2, Zap, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { contentId } from '../../../../src/circuit/graph';
import type { CircuitDesign } from '../../../../src/circuit/model';
import type { BoardPlan } from '../../../../src/blocks/contract';
import type { CheckResult } from './api';
import { fitView, gridStep, layOutSheet, type LaidPin, type LaidPort, type SheetLayout } from './layout';
import { blockers, describeOp, draftOps, draftOverlay, dropLastStep, applyOps, graphForPlan, NO_DRAFT, nextInst, nextRef, planAfter, portMarksOf, redoDraft, tryPlanStep, tryStep, undoDraft, wireOps, type Draft, type SheetOp } from './ops';
import { partLabelOf, sheetFromDesign, sheetFromGraph, withPorts, type BlockInfo, type Sheet, type SheetGraph } from './sheet';
import { LibraryDrawer } from './Library';
import { SheetDrawing, type SheetShow, type TitleRow } from './SheetDrawing';
import './schematic.css';

export type Tool = 'select' | 'hand' | 'wire' | 'label' | 'power' | 'text' | 'delete' | 'measure';
/** A chip board, as far as editing needs one: its plan, the graph it was drawn from, and the library that names its ports. */
export interface ChipTarget { plan: BoardPlan; graph: SheetGraph; blocks: readonly BlockInfo[] }

export interface SchematicEdit {
  /**
   * Null when accepted. Otherwise the reason, and nothing was built. `next` is the design a carrier edit makes.
   * It's null on a chip board, where the edit goes to the agent for review rather than straight to a build.
   */
  submit: (ops: readonly SheetOp[], lines: readonly string[], next: CircuitDesign | null) => Promise<string | null>;
  /** The server's verdict on the draft so far. Null if it couldn't be asked. */
  check: (ops: readonly SheetOp[], signal: AbortSignal) => Promise<CheckResult | null>;
  /** Why editing is off right now, in words. Null when it's on. */
  blocked: string | null;
}
/** Who is changing the sheet right now, in the pill's words. Null `who` means nobody. */
export interface LiveState { who: string | null; step: string | null }

interface View { s: number; x: number; y: number }
interface Prompt { kind: 'label' | 'power' | 'note' | 'value' | 'rename' | 'unlink'; x: number; y: number; part?: string; pin?: string; net?: string; value?: string; section?: string; title?: string; options?: readonly string[]; port?: string; links?: readonly string[] }
type Picked = { part: string | null; net: string | null };

const TOOLS: readonly { id: Tool; label: string; key: string; icon: LucideIcon; hint?: string; edits?: boolean }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'hand', label: 'Hand', key: 'H', icon: Hand },
  { id: 'wire', label: 'Wire', key: 'W', icon: Spline, hint: 'Click a pin, then the pin to join it to.', edits: true },
  { id: 'label', label: 'Net label', key: 'N', icon: Tag, hint: 'Click a pin to put it on a net, or a net to rename it.', edits: true },
  { id: 'power', label: 'Power', key: 'P', icon: Zap, hint: 'Click a pin to tie it to a rail or ground.', edits: true },
  { id: 'text', label: 'Text', key: 'T', icon: Type, hint: 'Click where the note belongs.', edits: true },
  { id: 'delete', label: 'Delete', key: 'D', icon: Eraser, hint: 'Click a part to remove it, or a pin’s wire to disconnect it.', edits: true },
  { id: 'measure', label: 'Measure', key: 'M', icon: Ruler, hint: 'Click two points on the sheet.' },
];

// What you show stays as you left it when you look at another tab.
let shownBefore: SheetShow & { grid: boolean; hidden: boolean } = { grid: true, pins: true, labels: true, marks: true, small: false, hidden: false };
let keptDraft: { key: string; draft: Draft } | null = null;

const MIN = 0.4;
const MAX = 24;
/** The room the rails leave. A draft bar takes the top of it, so an open draft fits below the bar and never covers a section's title. */
const roomFor = (width: number, drafting: boolean) => (width < 720 ? { left: 8, right: 8, top: drafting ? 120 : 64, bottom: 92 } : { left: 78, right: 86, top: drafting ? 84 : 18, bottom: 64 });
const near = (a: View, b: View) => Math.abs(a.s - b.s) < 1e-3 && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/** The rails clip what's inside them, so one tooltip lives on the canvas and a button only says what it would show. */
const TipContext = createContext<(tip: { text: string; x: number; y: number; side: 'left' | 'right' } | null) => void>(() => {});

function ToolButton({ label, keys, icon: Icon, pressed, disabled, title, onClick }: { label: string; keys?: string; icon: LucideIcon; pressed?: boolean; disabled?: boolean; title?: string; onClick: () => void }) {
  const setTip = useContext(TipContext);
  const tip = title ?? (keys ? `${label}  ·  ${keys}` : label);
  const show = (el: HTMLElement) => {
    const canvas = el.closest('.sc-canvas')!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const side = el.closest('.sc-rail-tools') ? 'right' : 'left';
    setTip({ text: tip, side, x: side === 'right' ? canvas.right - r.left + 8 : r.right - canvas.left + 8, y: r.top + r.height / 2 - canvas.top });
  };
  return (
    <span className="sc-tool-slot" onMouseEnter={e => show(e.currentTarget.firstElementChild as HTMLElement)} onMouseLeave={() => setTip(null)}>
      <button type="button" className="sc-tool" aria-label={label} aria-keyshortcuts={keys} aria-pressed={pressed} disabled={disabled} onFocus={e => { if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget); }} onBlur={() => setTip(null)} onClick={() => { setTip(null); onClick(); }}>
        <Icon size={17} aria-hidden="true" /><span>{label}</span>
      </button>
    </span>
  );
}

function SmallForm({ prompt, room, label, value, placeholder, submit, onCancel, options, children }: { prompt: Prompt; room: { w: number; h: number }; label: string; value: string; placeholder?: string; submit: string; onCancel: () => void; options?: readonly string[]; children: (value: string) => void; }) {
  const [text, setText] = useState(value);
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) children(text.trim()); };
  const x = Math.min(Math.max(prompt.x, 8), Math.max(room.w - 256, 8));
  const y = Math.min(Math.max(prompt.y + 10, 8), Math.max(room.h - 150, 8));
  return (
    <form className="sc-prompt" style={{ left: x, top: y }} onSubmit={onSubmit} onPointerDown={e => e.stopPropagation()}>
      <label>
        <span>{label}</span>
        <input autoFocus value={text} onFocus={e => e.currentTarget.select()} placeholder={placeholder} list={options ? 'sc-net-options' : undefined} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }} />
      </label>
      {options && <datalist id="sc-net-options">{options.map(o => <option key={o} value={o} />)}</datalist>}
      <div className="sc-prompt-actions">
        <button type="button" className="sc-text-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="sc-solid-button" disabled={!text.trim()}>{submit}</button>
      </div>
    </form>
  );
}

export default function SchematicCanvas({ sheet, design, chip, title, live, edit, part, onPart, readOnlyReason }: {
  sheet: Sheet;
  /** The carrier design under the sheet. */
  design: CircuitDesign | null;
  /** Or the chip plan. With neither, the sheet can be read but not edited. */
  chip: ChipTarget | null;
  title: readonly TitleRow[];
  live: LiveState;
  edit: SchematicEdit;
  part: string | null;
  onPart: (ref: string | null) => void;
  readOnlyReason?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const sentRef = useRef(false);
  const designKeyRef = useRef<string | null>(design ? contentId(design) : chip ? JSON.stringify(chip.plan) : null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const [animate, setAnimate] = useState(false);
  const following = useRef(true); // Fit as it grows, until the maker moves the view themselves.
  const [tool, setToolState] = useState<Tool>('select');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [show, setShowState] = useState(shownBefore);
  const [picked, setPicked] = useState<Picked>({ part: null, net: null });
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [wireFrom, setWireFrom] = useState<LaidPin | null>(null);
  const [wirePort, setWirePort] = useState<string | null>(null);
  const [check, setCheck] = useState<{ key: string; result: CheckResult } | null>(null);
  const [lastGraph, setLastGraph] = useState<SheetGraph | null>(null);
  // A chip edit sent for review. Its draft stays on the sheet until the new build replaces it, or the maker changes their mind.
  const [sentForReview, setSentForReview] = useState(false);
  const [measure, setMeasure] = useState<[number, number][]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [library, setLibrary] = useState(false);
  const designKey = design ? contentId(design) : chip ? JSON.stringify(chip.plan) : null;
  const [draft, setDraftState] = useState<Draft>(() => (keptDraft && keptDraft.key === designKey ? keptDraft.draft : NO_DRAFT));
  // Looking at another tab unmounts the canvas. A draft is work, so it's still here when you come back.
  const setDraft = useCallback((next: Draft | ((d: Draft) => Draft)) => setDraftState(prev => {
    const value = typeof next === 'function' ? next(prev) : next;
    if (designKeyRef.current) keptDraft = value.steps.length || value.undone.length ? { key: designKeyRef.current, draft: value } : null;
    return value;
  }), []);
  const [refused, setRefused] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [tip, setTip] = useState<{ text: string; x: number; y: number; side: 'left' | 'right' } | null>(null);
  const refusalTimer = useRef<number | null>(null);

  const setShow = (patch: Partial<typeof show>) => { const next = { ...show, ...patch }; shownBefore = next; setShowState(next); };
  const refuse = useCallback((reason: string | null) => {
    setRefused(reason);
    if (refusalTimer.current) window.clearTimeout(refusalTimer.current);
    if (reason) refusalTimer.current = window.setTimeout(() => setRefused(null), 9000);
  }, []);

  // Ops only mean something against the design they were made on. If that changes underneath them, say so.
  useEffect(() => {
    const before = designKeyRef.current;
    if (designKey) designKeyRef.current = designKey;
    if (before && designKey && before !== designKey) {
      // An edit sent for review coming back built is the draft arriving, not being lost.
      setDraftState(d => { if (d.steps.length && !sentRef.current) refuse('The design changed, so your draft was dropped.'); return NO_DRAFT; });
      sentRef.current = false;
      setSentForReview(false);
      keptDraft = null;
    }
  }, [designKey, refuse]);

  const ops = useMemo(() => draftOps(draft), [draft]);
  const applied = useMemo(() => (design && ops.length ? applyOps(design, ops) : null), [design, ops]);
  const nextDesign = applied && 'design' in applied ? applied.design : design;
  const opsKey = useMemo(() => JSON.stringify(ops), [ops]);
  const plannedChip = useMemo(() => {
    if (!chip || !ops.length) return chip?.plan ?? null;
    const local = planAfter(chip.plan, ops);
    return 'plan' in local ? local.plan : chip.plan;
  }, [chip, ops]);
  // A chip draft's own graph comes from the server, because only it has the blocks. Until that answers,
  // the last graph still shows every link and note at once, and a new block as its titled section.
  const previewGraph = lastGraph ?? chip?.graph ?? null;
  const drawn = useMemo(() => {
    if (chip && plannedChip && previewGraph && ops.length) {
      const next = withPorts(sheetFromGraph(plannedChip, graphForPlan(previewGraph, plannedChip)), plannedChip, chip.blocks);
      return { ...draftOverlay(sheet, next), portMarks: portMarksOf(sheet, next) };
    }
    if (!design || !ops.length || !nextDesign) return { sheet, marks: undefined, pinMarks: undefined, portMarks: undefined };
    return { ...draftOverlay(sheet, sheetFromDesign(nextDesign)), portMarks: undefined };
  }, [sheet, design, chip, plannedChip, previewGraph, nextDesign, ops.length]);

  const wide = size.w === 0 || size.w >= 720;
  const hidden = show.hidden || (!chip && (tool === 'wire' || tool === 'label' || tool === 'power'));
  const layout: SheetLayout = useMemo(() => layOutSheet(drawn.sheet, { hidden, aspect: wide ? 1.3 : 0.62, marks: drawn.marks, pinMarks: drawn.pinMarks, portMarks: drawn.portMarks }), [drawn, hidden, wide]);
  const fit = useMemo(() => fitView(layout, size.w, size.h, roomFor(size.w, ops.length > 0)), [layout, size, ops.length]);
  const portAt = useCallback((key: string | null): LaidPort | null => (key ? layout.sections.flatMap(s => s.ports).find(p => p.key === key) ?? null : null), [layout]);
  const wirePortLaid = useMemo(() => portAt(wirePort), [portAt, wirePort]);

  // Measured and fitted before the first paint, so a sheet never shows a frame at the wrong scale.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);
  // The sheet growing is the one time the view moves by itself, and it eases there. Anything else is instant.
  const firstFit = useRef(true);
  useLayoutEffect(() => {
    if (!following.current || !size.w) return;
    setAnimate(!firstFit.current);
    firstFit.current = false;
    setView(fit);
  }, [fit, size.w]);

  const canEdit = Boolean(design || chip) && !edit.blocked && !readOnlyReason;
  const whyNot = readOnlyReason ?? edit.blocked ?? (design || chip ? null : 'This sheet can be read, but has no design to edit.');
  const toolOff = (t: Tool) => (chip && t === 'power' ? 'On this board, rails join through ports. Use Wire.' : null);

  const setTool = useCallback((next: Tool) => {
    setToolState(next);
    setWireFrom(null);
    setWirePort(null);
    setMeasure([]);
    setPrompt(null);
    if (next !== 'select') { setPicked({ part: null, net: null }); onPart(null); }
  }, [onPart]);
  useEffect(() => { if (!canEdit && TOOLS.find(t => t.id === tool)?.edits) setTool('select'); }, [canEdit, tool, setTool]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const rect = box.current?.getBoundingClientRect();
    const [ox, oy] = [cx ?? (rect ? rect.width / 2 : 0), cy ?? (rect ? rect.height / 2 : 0)];
    following.current = false;
    setAnimate(false);
    setView(p => {
      const lo = fit.s * MIN;
      const hi = fit.s * MAX;
      const s = Math.min(hi, Math.max(lo, p.s * factor));
      const k = s / p.s;
      return { s, x: ox - (ox - p.x) * k, y: oy - (oy - p.y) * k };
    });
  }, [fit.s]);
  const fitNow = useCallback(() => { following.current = true; setAnimate(true); setView(fit); }, [fit]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) < 1) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - rect.left, e.clientY - rect.top);
      else { following.current = false; setAnimate(false); setView(p => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY })); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const step = useCallback((opsToAdd: readonly SheetOp[]): boolean => {
    const result = chip ? tryPlanStep(chip.plan, draft, opsToAdd) : design ? tryStep(design, draft, opsToAdd) : null;
    if (!result) return false;
    if ('refused' in result) { refuse(result.refused); return false; }
    setDraft(result.draft);
    refuse(null);
    return true;
  }, [design, chip, draft, refuse, setDraft]);

  // Every draft goes past the server. An op that can't apply is dropped with its reason. One that applies but can't
  // build yet stays, and what's missing shows in the bar, because the maker's next edit may be what fixes it.
  useEffect(() => {
    if (!ops.length) { setCheck(null); setLastGraph(null); return; }
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void edit.check(ops, abort.signal).then(result => {
        if (abort.signal.aborted || !result) return;
        if (!result.ok && result.opIndex !== undefined && !result.plan && !result.design) {
          setDraft(dropLastStep);
          refuse(result.reason ?? 'That edit can’t be applied.');
          return;
        }
        setCheck({ key: opsKey, result });
        // A half-wired plan may have no drawing yet. The last one stands until there's a newer one.
        if (result.graph) setLastGraph(result.graph);
      });
    }, 120);
    return () => { abort.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsKey]);


  const addBlock = (block: BlockInfo) => {
    const inst = nextInst(block.id, plannedChip?.blocks.map(b => b.inst) ?? []);
    if (step([{ op: 'add_block', inst, block: block.id, version: block.version }])) setLibrary(false);
  };
  const addModule = (id: string) => {
    const taken = [...(design?.parts.map(p => p.id) ?? []), ...(nextDesign?.parts.map(p => p.id) ?? [])];
    const ref = nextRef(id, taken);
    if (step([{ op: 'add_part', id: ref, module: id, role: 'Added on the schematic.' }])) { setLibrary(false); setShow({ hidden: true }); }
  };

  const sheetAt = (clientX: number, clientY: number): [number, number] => {
    const rect = box.current!.getBoundingClientRect();
    return [(clientX - rect.left - view.x) / view.s, (clientY - rect.top - view.y) / view.s];
  };
  const pinOf = (el: Element | null): LaidPin | null => {
    const hit = el?.closest('[data-pin]');
    if (!hit) return null;
    const [ref, id] = [hit.getAttribute('data-part'), hit.getAttribute('data-pin')];
    return layout.parts.find(p => p.ref === ref)?.pins.find(p => p.id === id) ?? null;
  };

  function click(el: Element | null, clientX: number, clientY: number) {
    const rect = box.current!.getBoundingClientRect();
    const [px, py] = [clientX - rect.left, clientY - rect.top];
    const pin = pinOf(el);
    const partRef = el?.closest('[data-part]')?.getAttribute('data-part') ?? null;
    const wireNet = el?.closest('[data-wire-net]')?.getAttribute('data-wire-net') ?? null;
    const netId = wireNet ?? pin?.net ?? null;
    setPrompt(null);
    if (chip && tool !== 'select' && tool !== 'measure' && tool !== 'hand') { clickOnChip(el, clientX, clientY, px, py); return; }
    switch (tool) {
      case 'select': {
        const onlyPin = pin && pin.net;
        if (wireNet || (onlyPin && el?.closest('.sc-pin-hit'))) { setPicked({ part: null, net: netId }); onPart(null); return; }
        setPicked({ part: partRef, net: null });
        onPart(partRef);
        return;
      }
      case 'wire': {
        if (!pin) { if (!el?.closest('button')) setWireFrom(null); return; }
        if (!wireFrom) { setWireFrom(pin); return; }
        if (!nextDesign) return;
        const ops2 = wireOps(nextDesign, { part: wireFrom.part, pin: wireFrom.id, net: wireFrom.net }, { part: pin.part, pin: pin.id, net: pin.net });
        if ('refused' in ops2) refuse(ops2.refused);
        else step(ops2);
        setWireFrom(null);
        return;
      }
      case 'label': {
        if (wireNet) { setPrompt({ kind: 'rename', x: px, y: py, net: wireNet, value: nextDesign?.nets.find(n => n.id === wireNet)?.name ?? '' }); return; }
        if (!pin) return;
        if (pin.net) { setPrompt({ kind: 'rename', x: px, y: py, net: pin.net, value: pin.netName ?? '' }); return; }
        setPrompt({ kind: 'label', x: px, y: py, part: pin.part, pin: pin.id, value: '' });
        return;
      }
      case 'power': {
        if (!pin) return;
        if (pin.net) { refuse(`${pin.part}.${pin.label} is already on ${pin.netName}. Disconnect it first.`); return; }
        setPrompt({ kind: 'power', x: px, y: py, part: pin.part, pin: pin.id });
        return;
      }
      case 'text': {
        const [sx, sy] = sheetAt(clientX, clientY);
        const home = layout.sections.find(s => sx >= s.x && sx <= s.x + s.w && sy >= s.y && sy <= s.y + s.h);
        setPrompt({ kind: 'note', x: px, y: py, ...(home?.parts[0] ? { part: home.parts[0] } : {}), value: '' });
        return;
      }
      case 'delete': {
        if (pin?.net) { step([{ op: 'disconnect', net: pin.net, part: pin.part, pin: pin.id }]); return; }
        if (wireNet && nextDesign) {
          const net = nextDesign.nets.find(n => n.id === wireNet);
          if (net?.endpoints[0]) step([{ op: 'disconnect', net: net.id, part: net.endpoints[0].part, pin: net.endpoints[0].pin }]);
          return;
        }
        if (partRef) step([{ op: 'remove_part', id: partRef }]);
        return;
      }
      case 'measure': {
        const point = sheetAt(clientX, clientY);
        setMeasure(m => (m.length >= 2 ? [point] : [...m, point]));
        return;
      }
      default:
    }
  }

  /** A chip board is edited by its blocks and ports, never its pins: those belong to reviewed blocks. */
  function clickOnChip(el: Element | null, clientX: number, clientY: number, px: number, py: number) {
    const port = el?.closest('[data-port]')?.getAttribute('data-port') ?? null;
    const pin = pinOf(el);
    const partRef = el?.closest('[data-part]')?.getAttribute('data-part') ?? null;
    const wireNet = el?.closest('[data-wire-net]')?.getAttribute('data-wire-net') ?? null;
    const instOf = (ref: string) => drawn.sheet.parts.find(p => p.ref === ref)?.inst ?? null;
    switch (tool) {
      case 'wire': {
        if (!port) {
          if (pin || partRef) refuse('Blocks join by their ports. Click a port under a section’s title.');
          else setWirePort(null);
          return;
        }
        if (!wirePort) { setWirePort(port); refuse(null); return; }
        if (port === wirePort) { setWirePort(null); return; }
        if (portAt(port)?.inst === portAt(wirePort)?.inst) { refuse('Those two ports are on the same block.'); return; }
        step([{ op: 'link', from: wirePort, to: port }]);
        setWirePort(null);
        return;
      }
      case 'label': {
        const net = wireNet ?? pin?.net;
        if (!net) { if (pin) refuse(`${pin.part}.${pin.label} isn’t on a net.`); return; }
        setPrompt({ kind: 'rename', x: px, y: py, net, value: drawn.sheet.nets.find(n => n.id === net)?.name ?? net });
        return;
      }
      case 'text': {
        const [sx, sy] = sheetAt(clientX, clientY);
        const home = layout.sections.find(s => sx >= s.x && sx <= s.x + s.w && sy >= s.y && sy <= s.y + s.h);
        if (!home) { refuse('Click inside a section. Each note belongs to one.'); return; }
        setPrompt({ kind: 'note', x: px, y: py, section: home.id, title: home.title, value: '' });
        return;
      }
      case 'delete': {
        if (port) {
          const links = portAt(port)?.links ?? [];
          if (!links.length) { refuse('That port isn’t linked to anything.'); return; }
          if (links.length === 1) step([{ op: 'unlink', from: port, to: links[0]! }]);
          else setPrompt({ kind: 'unlink', x: px, y: py, port, links });
          return;
        }
        const inst = partRef ? instOf(partRef) : null;
        if (inst) step([{ op: 'remove_block', inst }]);
        return;
      }
      default:
    }
  }

  // ------- Pointer: pan with hand, space, the middle button, or a drag on nothing. Two fingers pinch.
  const pointers = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ dist: number; mid: [number, number]; view: View } | null>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean; pan: boolean } | null>(null);
  const panning = tool === 'hand' || spaceHeld;

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('.sc-chrome')) return;
    box.current?.focus({ preventScroll: true });
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [[number, number], [number, number]];
      const rect = e.currentTarget.getBoundingClientRect();
      pinch.current = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2 - rect.left, (a[1] + b[1]) / 2 - rect.top], view };
      drag.current = null;
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, pan: panning || e.button === 1 };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setCursor([(e.clientX - rect.left - view.x) / view.s, (e.clientY - rect.top - view.y) / view.s]);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [[number, number], [number, number]];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const { dist: d0, mid, view: v0 } = pinch.current;
      const s = Math.min(fit.s * MAX, Math.max(fit.s * MIN, v0.s * (dist / d0)));
      const k = s / v0.s;
      following.current = false;
      setAnimate(false);
      setView({ s, x: mid[0] - (mid[0] - v0.x) * k, y: mid[1] - (mid[1] - v0.y) * k });
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    d.moved = true;
    following.current = false;
    setAnimate(false);
    setView(p => ({ ...p, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
  }
  function endPointer(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || d.moved || d.pan || e.type !== 'pointerup') return;
    click(document.elementFromPoint(e.clientX, e.clientY), e.clientX, e.clientY);
  }

  // ------- Keys. One listener for the canvas's life, reading the latest handler: another listener on this
  // event can re-render us mid-dispatch, and a listener removed then never hears the key.
  const onKeyDownLatest = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyDownLatest.current = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.closest('.st-chat, .st-popover'))) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); setDraft(d => (e.shiftKey ? redoDraft(d) : undoDraft(d))); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest('[role="tablist"]') && e.key.length > 1 && e.key !== 'Escape') return;
      if (e.key === ' ') { if (!(e.target as HTMLElement | null)?.closest('button')) { e.preventDefault(); setSpaceHeld(true); } return; }
      if (e.key === 'Escape') { setPrompt(null); setWireFrom(null); setWirePort(null); setLibrary(false); setMeasure([]); setPicked({ part: null, net: null }); onPart(null); setTool('select'); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && picked.part && canEdit) { const inst = drawn.sheet.parts.find(q => q.ref === picked.part)?.inst; step([chip && inst ? { op: 'remove_block', inst } : { op: 'remove_part', id: picked.part }]); setPicked({ part: null, net: null }); onPart(null); return; }
      const key = e.key.toLowerCase();
      const found = TOOLS.find(t => t.key.toLowerCase() === key);
      if (found && (!found.edits || (canEdit && !toolOff(found.id)))) { setTool(found.id); return; }
      const views: Record<string, () => void> = {
        a: () => { if (canEdit) setLibrary(l => !l); },
        g: () => setShow({ grid: !show.grid }),
        i: () => setShow({ pins: !show.pins }),
        x: () => setShow({ hidden: !show.hidden }),
        l: () => setShow({ labels: !show.labels }),
        s: () => setShow({ small: !show.small }),
        f: fitNow,
        '+': () => zoomAt(1.25), '=': () => zoomAt(1.25), '-': () => zoomAt(0.8), '0': fitNow,
      };
      const run = views[key];
      if (run) { e.preventDefault(); run(); }
  };
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => onKeyDownLatest.current(e);
    const onUp = (e: KeyboardEvent) => { if (e.key === ' ') setSpaceHeld(false); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, []);

  // ------- Apply
  const lines = useMemo(() => ops.map(op => describeOp(op, design)), [ops, design]);
  const fresh = check?.key === opsKey ? check.result : null;
  const serverSays = fresh && !fresh.ok ? fresh.reason ?? null : null;
  async function apply() {
    if ((!design && !chip) || sending) return;
    const blocking = design && nextDesign ? blockers(design, nextDesign) : [];
    if (blocking.length) { refuse(blocking.length > 1 ? `${blocking[0]} And ${blocking.length - 1} more to fix.` : blocking[0]!); return; }
    if (serverSays) { refuse(serverSays); return; }
    setSending(true);
    const rejected = await edit.submit(ops, lines, chip ? null : nextDesign);
    setSending(false);
    if (rejected) { refuse(rejected); return; }
    refuse(null);
    if (chip) { sentRef.current = true; setSentForReview(true); return; }
    setDraft(NO_DRAFT);
  }
  // The review ended with no new build, so the draft is the maker's again. The reason is in the chat.
  const liveWho = live.who;
  useEffect(() => { if (!liveWho && !edit.blocked) { sentRef.current = false; setSentForReview(false); } }, [liveWho, edit.blocked]);

  const stillWiring = design && nextDesign && ops.length ? blockers(design, nextDesign).length : 0;
  const pickedPart = picked.part ?? part;
  const zoom = fit.s > 0 ? view.s / fit.s : 1;
  const step5 = gridStep(view.s);
  const dotSize = step5 * view.s;
  const toolInfo = TOOLS.find(t => t.id === tool)!;
  const selection = pickedPart ? partLabelOf(drawn.sheet, pickedPart) : picked.net ? `Net ${drawn.sheet.nets.find(n => n.id === picked.net)?.name ?? picked.net}` : null;
  const measured = measure.length === 2 ? { d: Math.hypot(measure[1]![0] - measure[0]![0], measure[1]![1] - measure[0]![1]), dx: Math.abs(measure[1]![0] - measure[0]![0]), dy: Math.abs(measure[1]![1] - measure[0]![1]) } : null;
  const rails = (nextDesign?.nets ?? []).filter(n => n.kind !== 'signal');
  const signalNames = (nextDesign?.nets ?? []).filter(n => n.kind === 'signal').map(n => n.name);
  const pickedInfo = pickedPart ? nextDesign?.parts.find(p => p.id === pickedPart) : null;
  const pickedNet = picked.net ? nextDesign?.nets.find(n => n.id === picked.net) : null;
  const pickedChipPart = chip && pickedPart ? drawn.sheet.parts.find(p => p.ref === pickedPart) ?? null : null;
  const pickedInst = pickedChipPart?.inst && plannedChip ? plannedChip.blocks.find(b => b.inst === pickedChipPart.inst) ?? null : null;
  const pickedBlock = pickedInst ? chip?.blocks.find(b => b.id === pickedInst.block) ?? null : null;
  const chipNet = chip && picked.net ? drawn.sheet.nets.find(n => n.id === picked.net) ?? null : null;
  const chipNetEnds = chipNet ? drawn.sheet.parts.flatMap(p => p.pins.filter(q => q.net === chipNet.id).map(q => `${p.ref}.${q.label}`)) : [];
  const room = { w: size.w, h: size.h };
  // The inspector sits bottom left, unless that's where the picked part is.
  const pickedAt = pickedPart ? layout.parts.find(p => p.ref === pickedPart) : null;
  const inspectorSide = pickedAt && pickedAt.x * view.s + view.x < size.w / 2 && pickedAt.y * view.s + view.y > size.h / 2 ? ' is-right' : '';
  const transition = animate ? 'transform 420ms var(--ease)' : 'none';

  let hint: ReactNode = null;
  if (chip && tool === 'wire') hint = wirePortLaid ? <>From <strong>{wirePortLaid.label}</strong>. Click the port to link it to.</> : 'Click a port under a section’s title, then the port to link it to.';
  else if (chip && tool === 'delete') hint = 'Click a block’s part to remove the block, or a port to unlink it.';
  else if (tool === 'wire' && wireFrom) hint = <>From <strong>{wireFrom.part}.{wireFrom.label}</strong>. Click the pin to join it to.</>;
  else if (toolInfo.hint && !prompt) hint = toolInfo.hint;

  return (
    <div
      ref={box}
      className={`sc-canvas${show.grid ? '' : ' no-grid'}`}
      data-tool={panning ? 'hand' : tool}
      tabIndex={0}
      role="group"
      aria-label="Schematic. Plus and minus zoom, F fits."
      style={{ backgroundSize: `${dotSize}px ${dotSize}px`, backgroundPosition: `${view.x}px ${view.y}px`, transition: animate ? 'background-position 420ms var(--ease), background-size 420ms var(--ease)' : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={() => setCursor(null)}
    >
      <svg className="sc-svg" aria-hidden={false} role="img" aria-label={`${sheet.title || 'Schematic'}: ${layout.parts.length} parts in ${layout.sections.length} sections`}>
        <g style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: '0 0', transition }} onTransitionEnd={() => setAnimate(false)}>
          <SheetDrawing layout={layout} show={show} part={pickedPart} net={picked.net} title={title} reveal={Boolean(live.who)} wirePort={wirePortLaid} />
          {wirePortLaid && cursor && <path className="sc-rubber" d={`M${wirePortLaid.x + wirePortLaid.w / 2} ${wirePortLaid.y + wirePortLaid.h / 2}L${cursor[0]} ${cursor[1]}`} />}
          {wireFrom && cursor && <path className="sc-rubber" d={`M${wireFrom.ex} ${wireFrom.y}L${cursor[0]} ${wireFrom.y}L${cursor[0]} ${cursor[1]}`} />}
          {measure[0] && <circle className="sc-measure-end" cx={measure[0][0]} cy={measure[0][1]} r={.6} />}
          {measure.length === 1 && cursor && <line className="sc-measure" x1={measure[0]![0]} y1={measure[0]![1]} x2={cursor[0]} y2={cursor[1]} />}
          {measure[1] && <><line className="sc-measure" x1={measure[0]![0]} y1={measure[0]![1]} x2={measure[1][0]} y2={measure[1][1]} /><circle className="sc-measure-end" cx={measure[1][0]} cy={measure[1][1]} r={.6} /></>}
        </g>
      </svg>

      <TipContext.Provider value={setTip}>
      <div className="sc-chrome sc-rail sc-rail-view" role="toolbar" aria-orientation="vertical" aria-label="Show on the schematic">
        <ToolButton label="Grid" keys="G" icon={Grid3x3} pressed={show.grid} onClick={() => setShow({ grid: !show.grid })} />
        <ToolButton label="Pins" keys="I" icon={CircleDot} pressed={show.pins} onClick={() => setShow({ pins: !show.pins })} />
        <ToolButton label="Hidden" keys="X" icon={CircleOff} pressed={show.hidden} title="Hidden pins and no-connect marks  ·  X" onClick={() => setShow({ hidden: !show.hidden })} />
        <ToolButton label="Labels" keys="L" icon={Tag} pressed={show.labels} onClick={() => setShow({ labels: !show.labels })} />
        <ToolButton label="Small" keys="S" icon={FileText} pressed={show.small} title="Small text  ·  S" onClick={() => setShow({ small: !show.small })} />
      </div>

      <div className="sc-chrome sc-rail sc-rail-tools" role="toolbar" aria-orientation="vertical" aria-label="Edit the schematic">
        {TOOLS.map(t => <ToolButton key={t.id} label={t.label} keys={t.key} icon={t.icon} pressed={tool === t.id} disabled={t.edits && (!canEdit || Boolean(toolOff(t.id)))} title={t.edits ? (!canEdit ? whyNot ?? undefined : toolOff(t.id) ?? undefined) : undefined} onClick={() => setTool(t.id)} />)}
        <span className="sc-rail-split" aria-hidden="true" />
        <ToolButton label={chip ? 'Add block' : 'Add part'} keys="A" icon={Package} pressed={library} disabled={!canEdit} title={!canEdit ? whyNot ?? undefined : undefined} onClick={() => setLibrary(l => !l)} />
      </div>

      </TipContext.Provider>
      {tip && <div key={tip.text} className={`sc-tip is-${tip.side}`} role="tooltip" style={tip.side === 'right' ? { right: tip.x, top: tip.y } : { left: tip.x, top: tip.y }}>{tip.text}</div>}

      {live.who && (
        <div className="sc-chrome sc-live" role="status">
          <span className="sc-live-dot" aria-hidden="true" /><strong>{live.who}</strong>{live.step && <span>· {live.step}</span>}
        </div>
      )}
      {!live.who && hint && !ops.length && !refused && <p className="sc-chrome sc-hint" role="status">{hint}</p>}
      {measured && <p className="sc-chrome sc-hint" role="status"><strong>{measured.d.toFixed(2)} mm</strong> on the sheet · ΔX {measured.dx.toFixed(2)} · ΔY {measured.dy.toFixed(2)}</p>}

      {(ops.length > 0 || refused) && (
        <div className="sc-chrome sc-draft" role="status">
          {ops.length > 0 && (
            <div className="sc-draft-row">
              <div className="sc-draft-text">
                <strong>{ops.length} {ops.length === 1 ? 'edit' : 'edits'}</strong>
                <span title={lines.join('\n')}>{lines.at(-1)}{stillWiring > 0 ? ` · ${stillWiring} left to connect` : ''}</span>
              </div>
              <button type="button" className="sc-icon-button" aria-label="Undo" title="Undo  ·  Ctrl Z" disabled={!draft.steps.length || sentForReview} onClick={() => setDraft(undoDraft)}><Undo2 size={15} /></button>
              <button type="button" className="sc-icon-button" aria-label="Redo" title="Redo  ·  Ctrl Shift Z" disabled={!draft.undone.length || sentForReview} onClick={() => setDraft(redoDraft)}><Redo2 size={15} /></button>
              <button type="button" className="sc-text-button" disabled={sentForReview} onClick={() => { setDraft(NO_DRAFT); refuse(null); }}>Discard</button>
              <button type="button" className="sc-solid-button" disabled={sending || !canEdit || sentForReview} title={!canEdit ? whyNot ?? undefined : chip ? 'A second agent checks this against the datasheets, then it builds. This uses the agent.' : undefined} onClick={() => void apply()}>{sending ? 'Sending' : sentForReview ? 'Reviewing' : chip ? 'Review and apply' : 'Apply'}</button>
            </div>
          )}
          {ops.length > 0 && !refused && !stillWiring && serverSays && <p className="sc-draft-note" role="status" title={serverSays}>Can’t build yet: {serverSays}</p>}
          {ops.length > 0 && !refused && !stillWiring && !serverSays && chip && <p className="sc-draft-note" role="status">{sentForReview ? 'The agent is checking this. It builds if the check passes.' : 'A second agent checks this against the datasheets, then it builds.'}</p>}
          {refused && <p className="sc-refused" role="alert" title={refused}>{refused}</p>}
        </div>
      )}

      {prompt?.kind === 'power' && (
        <div className="sc-chrome sc-prompt" style={{ left: Math.min(prompt.x, Math.max(room.w - 200, 8)), top: Math.min(prompt.y + 10, Math.max(room.h - 170, 8)) }} onPointerDown={e => e.stopPropagation()}>
          <span className="sc-prompt-title">Tie {prompt.part}.{prompt.pin} to</span>
          {rails.length === 0 && <p className="sc-library-note">This design has no rails yet.</p>}
          {rails.map(net => <button key={net.id} type="button" className="sc-prompt-option" onClick={() => { step([{ op: 'connect', net: net.id, endpoints: [{ part: prompt.part!, pin: prompt.pin! }] }]); setPrompt(null); }}>{net.name}</button>)}
        </div>
      )}
      {prompt?.kind === 'unlink' && (
        <div className="sc-chrome sc-prompt" style={{ left: Math.min(prompt.x, Math.max(room.w - 256, 8)), top: Math.min(prompt.y + 10, Math.max(room.h - 190, 8)) }} onPointerDown={e => e.stopPropagation()}>
          <span className="sc-prompt-title">Unlink {prompt.port} from</span>
          {prompt.links!.map(link => <button key={link} type="button" className="sc-prompt-option" onClick={() => { step([{ op: 'unlink', from: prompt.port!, to: link }]); setPrompt(null); }}>{link}</button>)}
        </div>
      )}
      {prompt?.kind === 'label' && (
        <div className="sc-chrome">
          <SmallForm prompt={prompt} room={room} label={`Net for ${prompt.part}.${prompt.pin}`} value="" placeholder="I2C_SDA" submit="Connect" options={signalNames} onCancel={() => setPrompt(null)}>
            {name => {
              const existing = nextDesign?.nets.find(n => n.name === name);
              const done = step([existing ? { op: 'connect', net: existing.id, endpoints: [{ part: prompt.part!, pin: prompt.pin! }] } : { op: 'connect', net: name, kind: 'signal', endpoints: [{ part: prompt.part!, pin: prompt.pin! }], why: 'Labelled on the schematic.' }]);
              if (done) setPrompt(null);
            }}
          </SmallForm>
        </div>
      )}
      {prompt?.kind === 'rename' && (
        <div className="sc-chrome">
          <SmallForm prompt={prompt} room={room} label="Rename net" value={prompt.value ?? ''} submit="Rename" onCancel={() => setPrompt(null)}>
            {name => { if (name === prompt.value || step([{ op: 'rename_net', net: prompt.net!, name }])) setPrompt(null); }}
          </SmallForm>
        </div>
      )}
      {prompt?.kind === 'note' && (
        <div className="sc-chrome">
          <SmallForm prompt={prompt} room={room} label={prompt.title ? `Note in ${prompt.title}` : prompt.part ? `Note beside ${prompt.part}` : 'Note on this sheet'} value="" placeholder="Keep this close to the sensor" submit="Add note" onCancel={() => setPrompt(null)}>
            {text => { if (step([{ op: 'add_note', text, ...(prompt.part ? { part: prompt.part } : {}), ...(prompt.section ? { section: prompt.section } : {}) }])) setPrompt(null); }}
          </SmallForm>
        </div>
      )}
      {prompt?.kind === 'value' && (
        <div className="sc-chrome">
          <SmallForm prompt={prompt} room={room} label={prompt.title ?? `Value of ${prompt.part}`} value={prompt.value ?? ''} placeholder={prompt.options?.[0] ?? '10k'} submit="Set" {...(prompt.options ? { options: prompt.options } : {})} onCancel={() => setPrompt(null)}>
            {value => { if (step([{ op: 'set_value', part: prompt.part!, value }])) setPrompt(null); }}
          </SmallForm>
        </div>
      )}

      {tool === 'select' && pickedInfo && (
        <aside className={`sc-chrome sc-inspector${inspectorSide}`} aria-label={`Part ${pickedInfo.id}`}>
          <strong>{pickedInfo.id}</strong>
          <span>{drawn.sheet.parts.find(p => p.ref === pickedInfo.id)?.name}</span>
          {pickedInfo.role && <p>{pickedInfo.role}</p>}
          <div className="sc-prompt-actions">
            {['resistor', 'capacitor', 'inductor'].includes(drawn.sheet.parts.find(p => p.ref === pickedInfo.id)?.symbol ?? '') && <button type="button" className="sc-text-button" disabled={!canEdit} onClick={() => setPrompt({ kind: 'value', x: size.w / 2, y: 80, part: pickedInfo.id, value: pickedInfo.value ?? '' })}>Set value</button>}
            <button type="button" className="sc-text-button" disabled={!canEdit} onClick={() => { if (step([{ op: 'remove_part', id: pickedInfo.id }])) { setPicked({ part: null, net: null }); onPart(null); } }}>Remove</button>
          </div>
        </aside>
      )}
      {tool === 'select' && pickedNet && (
        <aside className="sc-chrome sc-inspector" aria-label={`Net ${pickedNet.name}`}>
          <strong>{pickedNet.name}</strong>
          <span>{pickedNet.endpoints.map(e => `${e.part}.${e.pin}`).join(', ')}</span>
          <p>{pickedNet.why}</p>
          <div className="sc-prompt-actions">
            <button type="button" className="sc-text-button" disabled={!canEdit} onClick={() => setPrompt({ kind: 'rename', x: size.w / 2, y: 80, net: pickedNet.id, value: pickedNet.name })}>Rename</button>
          </div>
        </aside>
      )}

      {tool === 'select' && pickedChipPart && (
        <aside className={`sc-chrome sc-inspector${inspectorSide}`} aria-label={`Part ${pickedChipPart.ref}`}>
          <strong>{pickedChipPart.ref}</strong>
          <span>{pickedChipPart.name}</span>
          {pickedBlock && <p>Part of the {pickedBlock.title} block{pickedBlock.status === 'reviewed' ? '' : ', which hasn’t been reviewed'}.</p>}
          {pickedBlock?.params && pickedInst && pickedBlock.params.length > 0 && (
            <div className="sc-params">
              {pickedBlock.params.map(param => {
                const current = pickedInst.params[param.id] ?? param.default;
                const inst = pickedInst.inst;
                return <button key={param.id} type="button" className="sc-param" disabled={!canEdit} onClick={() => setPrompt({ kind: 'value', x: size.w / 2, y: 80, part: `${inst}.${param.id}`, title: `${param.id}${param.unit ? ` (${param.unit})` : ''}`, value: String(current), ...(param.options ? { options: param.options } : {}) })}><span>{param.id}</span><em>{String(current)}{param.unit ? ` ${param.unit}` : ''}</em></button>;
              })}
            </div>
          )}
          <div className="sc-prompt-actions">
            <button type="button" className="sc-text-button" disabled={!canEdit || !pickedInst} onClick={() => { if (pickedInst && step([{ op: 'remove_block', inst: pickedInst.inst }])) { setPicked({ part: null, net: null }); onPart(null); } }}>Remove block</button>
          </div>
        </aside>
      )}
      {tool === 'select' && chipNet && (
        <aside className="sc-chrome sc-inspector" aria-label={`Net ${chipNet.name}`}>
          <strong>{chipNet.name}</strong>
          <span>{chipNetEnds.join(', ')}</span>
        </aside>
      )}

      {library && (
        <div className="sc-chrome">
          <LibraryDrawer mode={chip ? 'chip' : 'carrier'} onModule={m => addModule(m.id)} onBlock={addBlock} onClose={() => setLibrary(false)} />
        </div>
      )}

      <div className="sc-chrome st-dock sc-zoom" role="toolbar" aria-label="Schematic zoom">
        <button type="button" className="st-tool" aria-label="Zoom out" data-tip="Zoom out  ·  -" disabled={zoom <= MIN + 0.001} onClick={() => zoomAt(0.8)}><Minus size={16} /></button>
        <output className="st-dock-zoom">{zoom.toFixed(1)}×</output>
        <button type="button" className="st-tool" aria-label="Zoom in" data-tip="Zoom in  ·  +" disabled={zoom >= MAX - 0.001} onClick={() => zoomAt(1.25)}><Plus size={16} /></button>
        <span className="st-tool-gap" aria-hidden="true" />
        <button type="button" className="st-tool" aria-label="Fit" data-tip="Fit  ·  F" aria-pressed={near(view, fit)} onClick={fitNow}><Scan size={16} /></button>
      </div>

      <footer className="sc-chrome sc-status">
        <Read label="X" value={cursor ? cursor[0].toFixed(2) : '–'} wide cursorOnly />
        <Read label="Y" value={cursor ? cursor[1].toFixed(2) : '–'} wide cursorOnly />
        <Read label="Units" value="mm" />
        <Read label="Grid" value={`${(step5 > 2.54 ? step5 : 2.54).toFixed(2)}`} />
        <Read label="Zoom" value={`${zoom.toFixed(1)}×`} />
        {selection && <Read label="Selected" value={selection} />}
        <span className="sc-status-grow" />
        {sheet.origin === 'board' && <span className="sc-status-note">Read from the board file</span>}
        {live.who
          ? <span className="sc-status-agent is-live"><Bot size={13} aria-hidden="true" />{live.who}</span>
          : ops.length > 0
            ? <span className="sc-status-agent">Draft · not built</span>
            : whyNot ? <span className="sc-status-agent" title={whyNot}>Read only</span> : <span className="sc-status-agent">Ready</span>}
      </footer>
    </div>
  );
}

function Read({ label, value, wide, cursorOnly }: { label: string; value: string; wide?: boolean; cursorOnly?: boolean }) {
  return <span className={`sc-read${wide ? ' is-wide' : ''}${cursorOnly ? ' is-cursor' : ''}`}><em>{label}</em><span>{value}</span></span>;
}
