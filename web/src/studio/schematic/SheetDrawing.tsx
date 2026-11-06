import { memo } from 'react';
import type { LaidPart, LaidPin, LaidPort, LaidSection, SheetLayout } from './layout';
import { GRID } from './layout';
import type { SymbolKind } from './sheet';

export interface SheetShow { pins: boolean; labels: boolean; marks: boolean; small: boolean }
export interface TitleRow { k: string; v: string }

function Symbol2({ kind, x, y, w }: { kind: SymbolKind; x: number; y: number; w: number }) {
  const cy = y + GRID;
  const mid = x + w / 2;
  switch (kind) {
    case 'resistor': return <><path className="sc-lead" d={`M${x} ${cy}H${mid - 2.6}M${mid + 2.6} ${cy}H${x + w}`} /><rect className="sc-body" x={mid - 2.6} y={cy - 1} width={5.2} height={2} /></>;
    case 'ldr': return <><path className="sc-lead" d={`M${x} ${cy}H${mid - 2.6}M${mid + 2.6} ${cy}H${x + w}`} /><rect className="sc-body" x={mid - 2.6} y={cy - 1} width={5.2} height={2} /><path className="sc-lead" d={`M${mid - 2} ${cy - 3.4}l1.4 1.6m-.3-1l.3 1-.9-.4M${mid - .2} ${cy - 3.4}l1.4 1.6m-.3-1l.3 1-.9-.4`} /></>;
    case 'capacitor': return <path className="sc-lead" d={`M${x} ${cy}H${mid - .5}M${mid - .5} ${cy - 1.9}V${cy + 1.9}M${mid + .5} ${cy - 1.9}V${cy + 1.9}M${mid + .5} ${cy}H${x + w}`} />;
    case 'inductor': return <path className="sc-lead" d={`M${x} ${cy}H${mid - 2.7}a.9 .9 0 0 1 1.8 0a.9 .9 0 0 1 1.8 0a.9 .9 0 0 1 1.8 0H${x + w}`} />;
    case 'led':
    case 'diode': return <><path className="sc-lead" d={`M${x} ${cy}H${mid - 1.4}M${mid + 1.4} ${cy}H${x + w}M${mid + 1.4} ${cy - 1.6}V${cy + 1.6}`} /><path className="sc-body" d={`M${mid - 1.4} ${cy - 1.6}L${mid + 1.4} ${cy}L${mid - 1.4} ${cy + 1.6}Z`} />{kind === 'led' && <path className="sc-lead" d={`M${mid} ${cy - 2.2}l1.2 -1.4m-.8 .1l.8 -.1 -.1 .8M${mid + 1.5} ${cy - 2}l1.2 -1.4m-.8 .1l.8 -.1 -.1 .8`} />}</>;
    case 'piezo': return <><path className="sc-lead" d={`M${x} ${cy}H${mid - 1.8}M${mid + 1.8} ${cy}H${x + w}`} /><circle className="sc-body" cx={mid} cy={cy} r={1.8} /><path className="sc-lead" d={`M${mid - .8} ${cy - 1}v2M${mid + .8} ${cy - 1}v2`} /></>;
    case 'switch': return <><path className="sc-lead" d={`M${x} ${cy}H${mid - 1.8}M${mid + 1.8} ${cy}H${x + w}M${mid - 1.8} ${cy}L${mid + 1.5} ${cy - 1.6}`} /><circle className="sc-dot" cx={mid - 1.8} cy={cy} r={.35} /><circle className="sc-dot" cx={mid + 1.8} cy={cy} r={.35} /></>;
    default: return null;
  }
}

const dir = (pin: LaidPin) => (pin.side === 'left' ? -1 : 1);

function PinEnd({ pin }: { pin: LaidPin }) {
  const d = dir(pin);
  const x = pin.ex;
  const y = pin.y;
  if (pin.end === 'ground') {
    return (
      <g className="sc-flag is-ground">
        <path d={`M${x} ${y - 1.5}V${y + 1.5}M${x + d * .55} ${y - 1}V${y + 1}M${x + d * 1.1} ${y - .5}V${y + .5}`} />
        <text className="sc-tag-text" x={x + d * 1.7} y={y} textAnchor={d < 0 ? 'end' : 'start'} dominantBaseline="central">GND</text>
      </g>
    );
  }
  if (pin.end === 'power') {
    return (
      <g className="sc-flag is-power">
        <path d={`M${x} ${y - 1.3}V${y + 1.3}`} />
        <text className="sc-tag-text" x={x + d * .8} y={y} textAnchor={d < 0 ? 'end' : 'start'} dominantBaseline="central">{pin.netName}</text>
      </g>
    );
  }
  if (pin.end === 'label') {
    const len = (pin.netName?.length ?? 0) * 1.22 + 1.6;
    const tip = 1;
    return (
      <g className="sc-flag is-label">
        <path className="sc-tag" d={`M${x} ${y}l${d * tip} -1.15h${d * len}v2.3h${-d * len}Z`} />
        <text className="sc-tag-text" x={x + d * (tip + .7)} y={y} textAnchor={d < 0 ? 'end' : 'start'} dominantBaseline="central">{pin.netName}</text>
      </g>
    );
  }
  return null;
}

function Pin({ pin, show, tall }: { pin: LaidPin; show: SheetShow; tall: boolean }) {
  const d = dir(pin);
  const open = pin.end === 'open';
  return (
    <g className={`sc-pin${pin.draft ? ` is-${pin.draft}` : ''}${pin.required ? ' is-missing' : ''}`} data-net={pin.net ?? undefined} data-pinref={`${pin.part}.${pin.id}`}>
      <path className="sc-wire" d={`M${pin.x} ${pin.y}H${pin.ex}`} />
      {tall && show.pins && <text className="sc-pin-label" x={pin.x - d * .9} y={pin.y} textAnchor={d < 0 ? 'start' : 'end'} dominantBaseline="central">{pin.label}</text>}
      {tall && show.pins && pin.number && <text className="sc-pin-number" x={pin.x + d * .6} y={pin.y - .55} textAnchor={d < 0 ? 'end' : 'start'}>{pin.number}</text>}
      {show.labels && <PinEnd pin={pin} />}
      {open && show.marks && !pin.required && <path className="sc-nc" d={`M${pin.ex - .75} ${pin.y - .75}l1.5 1.5m0 -1.5l-1.5 1.5`} />}
      {pin.required && <circle className="sc-missing" cx={pin.ex} cy={pin.y} r={.75} />}
      {pin.was && show.labels && <text className="sc-was" x={pin.ex + d * 1} y={pin.y - 1.6} textAnchor={d < 0 ? 'end' : 'start'}>{pin.was}</text>}
      <circle className="sc-pin-hit" cx={pin.ex} cy={pin.y} r={1.9} data-pin={pin.id} data-part={pin.part} data-pin-net={pin.net ?? undefined} />
    </g>
  );
}

const Part = memo(function Part({ part, show, picked }: { part: LaidPart; show: SheetShow; picked: boolean }) {
  const tall = part.symbol === 'chip';
  return (
    <g className={`sc-part${picked ? ' is-picked' : ''}${part.draft ? ` is-${part.draft}` : ''}`} data-part={part.ref} data-section={part.section}>
      {tall ? <rect className="sc-body sc-chip" x={part.x} y={part.y} width={part.w} height={part.h} /> : <Symbol2 kind={part.symbol} x={part.x} y={part.y} w={part.w} />}
      <rect className="sc-part-hit" x={part.x - .6} y={part.y - (tall ? 3.6 : 3)} width={part.w + 1.2} height={part.h + (tall ? 7.6 : 5.4)} rx=".6" />
      {picked && <rect className="sc-pick" x={part.x - .9} y={part.y - (tall ? 3.8 : 3.2)} width={part.w + 1.8} height={part.h + (tall ? 8 : 5.8)} rx=".8" />}
      <text className="sc-ref" x={part.x} y={part.y - (tall ? 1 : .8)}>{part.ref}</text>
      {tall && <text className="sc-name" x={part.x} y={part.y + part.h + 2.2}>{part.name.length > 34 ? `${part.name.slice(0, 33)}…` : part.name}</text>}
      {!tall && <text className="sc-value" x={part.x} y={part.y + part.h + 1.4}>{part.value ?? (part.symbol === 'led' || part.symbol === 'piezo' || part.symbol === 'ldr' ? part.name.split(/[ ,]/)[0] : '')}</text>}
      {part.pins.map(pin => <Pin key={pin.id} pin={pin} show={show} tall={tall} />)}
    </g>
  );
});

export const portFamily = (kind: string): 'ground' | 'power' | 'bus' | 'signal' => (kind === 'ground' ? 'ground' : kind.startsWith('power') ? 'power' : kind === 'bus' ? 'bus' : 'signal');

function Port({ port, from }: { port: LaidPort; from: LaidPort | null }) {
  const family = portFamily(port.kind);
  // While a wire is in hand, what it can't sensibly join steps back. The server still has the last word.
  const dim = from && from.key !== port.key && (from.inst === port.inst || portFamily(from.kind) !== family);
  const cls = ['sc-port', `is-${family}`, port.links.length ? 'is-linked' : '', from?.key === port.key ? 'is-from' : '', dim ? 'is-dim' : '', port.draft ? `is-${port.draft}` : ''].filter(Boolean).join(' ');
  return (
    <g className={cls} data-port={port.key}>
      <title>{port.links.length ? `${port.full}, linked to ${port.links.join(', ')}` : `${port.full}, not linked`}</title>
      <rect x={port.x} y={port.y} width={port.w} height={port.h} rx=".7" />
      <text x={port.x + port.w / 2} y={port.y + port.h / 2} textAnchor="middle" dominantBaseline="central">{port.label}</text>
    </g>
  );
}

function Section({ section, picked, wirePort }: { section: LaidSection; picked: boolean; wirePort: LaidPort | null }) {
  const noteTop = section.y + section.h - (section.reference ? 3.2 : 0) - section.notes.length * 3.2 - .4;
  return (
    <g className={`sc-section${picked ? ' is-picked' : ''}${section.draft ? ` is-${section.draft}` : ''}`} data-section={section.id}>
      <rect className="sc-section-box" x={section.x} y={section.y} width={section.w} height={section.h} />
      <text className="sc-section-title" x={section.x + 1.6} y={section.y + 4.2}>{section.title}</text>
      {section.notes.map((line, i) => <text key={i} className="sc-note" x={section.x + 1.6} y={noteTop + i * 3.2}>{line}</text>)}
      {section.reference && <text className="sc-reference" x={section.x + 1.6} y={section.y + section.h - 1.2}>{section.reference}</text>}
      {section.ports.map(port => <Port key={port.key} port={port} from={wirePort} />)}
    </g>
  );
}

/** The sheet, in sheet millimetres. Frame and title block are part of the drawing, on the same paper as the canvas. */
export const SheetDrawing = memo(function SheetDrawing({ layout, show, part, net, title, reveal, wirePort = null }: { layout: SheetLayout; show: SheetShow; part: string | null; net: string | null; title: readonly TitleRow[]; reveal?: boolean; wirePort?: LaidPort | null }) {
  const { frame, titleBlock: block } = layout;
  const rowH = block.h / Math.max(Math.ceil(title.length / 2), 3);
  return (
    <g className={`sc-sheet${show.small ? ' is-small' : ''}${net ? ' has-net' : ''}${reveal ? ' is-live' : ''}`}>
      {net && <style>{`.sc-sheet.has-net [data-net="${CSS.escape(net)}"]{opacity:1}.sc-sheet.has-net [data-net="${CSS.escape(net)}"] .sc-wire,.sc-sheet.has-net path.sc-wire[data-net="${CSS.escape(net)}"]{stroke:var(--sc-pick);stroke-width:.42px}`}</style>}
      <rect className="sc-frame-outer" x={frame.x - 5} y={frame.y - 5} width={frame.w + 10} height={frame.h + 10} />
      <rect className="sc-frame" x={frame.x} y={frame.y} width={frame.w} height={frame.h} />
      {layout.zoneTicks.map((t, i) => <line key={i} className="sc-frame-tick" {...t} />)}
      {layout.zones.map((z, i) => <text key={i} className="sc-zone" x={z.x} y={z.y} textAnchor="middle">{z.label}</text>)}
      {layout.sections.map(s => <Section key={s.id} section={s} picked={false} wirePort={wirePort} />)}
      {layout.wires.map(w => (
        <g key={w.net} className="sc-trunk" data-net={w.net}>
          <path className="sc-wire" d={w.d} data-net={w.net} />
          {w.junctions.map(([x, y], i) => <circle key={i} className="sc-junction" cx={x} cy={y} r={.45} />)}
          <path className="sc-wire-hit" d={w.d} data-wire-net={w.net} data-pin={w.pins[0]!.pin} data-part={w.pins[0]!.part} />
        </g>
      ))}
      {layout.parts.map(p => <Part key={p.ref} part={p} show={show} picked={p.ref === part} />)}
      <g className="sc-title-block">
        <rect className="sc-frame" x={block.x} y={block.y} width={block.w} height={block.h} />
        {title.map((row, i) => {
          const col = i % 2;
          const x = block.x + (col ? block.w * .62 : 0);
          const y = block.y + Math.floor(i / 2) * rowH;
          return (
            <g key={row.k}>
              {i % 2 === 0 && i > 0 && <line className="sc-frame-tick" x1={block.x} x2={block.x + block.w} y1={y} y2={y} />}
              <text className="sc-tb-key" x={x + 1.4} y={y + 2.6}>{row.k}</text>
              <text className="sc-tb-value" x={x + 1.4} y={y + rowH - 1.5}>{row.v.length > (col ? 16 : 32) ? `${row.v.slice(0, col ? 15 : 31)}…` : row.v}</text>
            </g>
          );
        })}
        <line className="sc-frame-tick" x1={block.x + block.w * .62} x2={block.x + block.w * .62} y1={block.y} y2={block.y + block.h} />
      </g>
    </g>
  );
});
