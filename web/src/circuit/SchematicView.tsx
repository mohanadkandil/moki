import type { SchematicLayout, SchematicPart, SchematicPin } from '../../../src/circuit/layout';
import type { Selection } from './selection';

const INK = '#1b2129';
const BODY = '#f4f7fb';
const NET_BLUE = '#1f5bb8';
const POWER_RED = '#c22d3a';
const HIGHLIGHT = '#ffe14d';
const UI_FONT = "'Manrope Variable', Manrope, system-ui, sans-serif";
const ID_FONT = "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

export default function SchematicView({ layout, title, revision, selection, onSelect, fresh }: {
  layout: SchematicLayout; title: string; revision: number; selection: Selection; onSelect: (s: Selection) => void; fresh: ReadonlySet<string>;
}) {
  const netSel = selection?.kind === 'net' ? selection.id : null;
  const partSel = selection?.kind === 'part' ? selection.id : null;
  const dim = (net: string | null) => (netSel && net !== netSel ? 'is-dim' : '');
  const height = layout.height + 56;
  const width = Math.max(layout.width, 520);

  return (
    <g fontFamily={UI_FONT}>
      <defs>
        <pattern id="sch-dots" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="5" cy="5" r="0.75" fill="#d5dacf" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="#ffffff" />
      <rect width={width} height={height} fill="url(#sch-dots)" data-export="keep" />

      {/* Highlighter: drawn first so ink sits on top of it, like a marker on a printout. */}
      {netSel && (
        <g data-export="skip" className="hl">
          {layout.wires.filter(w => w.net === netSel).map((w, i) => <line key={i} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={HIGHLIGHT} strokeWidth="11" strokeLinecap="round" />)}
          {layout.parts.flatMap(p => p.pins).filter(p => p.net === netSel).map((p, i) => <line key={`p${i}`} x1={p.base.x} y1={p.base.y} x2={p.end.x} y2={p.end.y} stroke={HIGHLIGHT} strokeWidth="11" strokeLinecap="round" />)}
          {layout.flags.filter(f => f.net === netSel).map((f, i) => <circle key={`f${i}`} cx={f.at.x} cy={f.at.y + (f.dir === 'up' ? -10 : 10)} r="15" fill={HIGHLIGHT} />)}
        </g>
      )}
      {partSel && layout.parts.filter(p => p.id === partSel).map(p => (
        <rect key={p.id} data-export="skip" className="hl" x={p.box.x - 12} y={p.box.y - 12} width={p.box.w + 24 + (p.symbol === 'block' ? 0 : 48)} height={p.box.h + 24} rx="8" fill={HIGHLIGHT} />
      ))}
      {layout.parts.filter(p => fresh.has(p.id)).map(p => (
        <rect key={`fresh-${p.id}`} data-export="skip" className="fresh-mark" x={p.box.x - 12} y={p.box.y - 12} width={p.box.w + 24 + (p.symbol === 'block' ? 0 : 48)} height={p.box.h + 24} rx="8" fill={HIGHLIGHT} />
      ))}

      {layout.wires.map((w, i) => (
        <g key={`w${i}`} className={`sch-wire ${dim(w.net)}`} onClick={() => onSelect({ kind: 'net', id: w.net })}>
          <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={INK} strokeWidth="1.6" strokeLinecap="square" />
          <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="transparent" strokeWidth="12" data-export="skip" />
        </g>
      ))}
      {layout.junctions.map((j, i) => <circle key={`j${i}`} className={dim(j.net)} cx={j.at.x} cy={j.at.y} r="3.2" fill={INK} />)}
      {layout.labels.map((l, i) => (
        <text key={`l${i}`} className={`sch-label ${dim(l.net)}`} x={l.at.x} y={l.at.y} fontFamily={ID_FONT} fontSize="9.5" fontWeight="600" fill={NET_BLUE} onClick={() => onSelect({ kind: 'net', id: l.net })}>{l.text}</text>
      ))}
      {layout.flags.map((f, i) => <Flag key={`f${i}`} flag={f} className={dim(f.net)} onSelect={onSelect} />)}

      {layout.parts.map(part => (
        <g key={part.id} className={`sch-part ${netSel && !part.pins.some(p => p.net === netSel) ? 'is-dim' : ''}`}>
          <g onClick={() => onSelect({ kind: 'part', id: part.id })} className="sch-hit">
            {part.symbol === 'block' ? <Block part={part} /> : <TwoPin part={part} />}
          </g>
          {part.pins.map(pin => <Pin key={pin.pin} pin={pin} block={part.symbol === 'block'} onSelect={onSelect} dimmed={Boolean(netSel && pin.net !== netSel)} />)}
        </g>
      ))}

      <g transform={`translate(14 ${height - 50})`} fontSize="9.5" fill={INK}>
        <rect width="236" height="38" fill="#ffffff" stroke={INK} strokeWidth="1" />
        <line x1="0" y1="19" x2="236" y2="19" stroke={INK} strokeWidth="0.6" />
        <line x1="150" y1="0" x2="150" y2="38" stroke={INK} strokeWidth="0.6" />
        <text x="8" y="13" fontWeight="700">{title}</text>
        <text x="158" y="13">Revision {revision}</text>
        <text x="8" y="32" fill="#4c5560">Preview · not ERC-checked</text>
        <text x="158" y="32" fill="#4c5560">ESP32 · 3.3 V</text>
      </g>
    </g>
  );
}

function Block({ part }: { part: SchematicPart }) {
  const { x, y, w, h } = part.box;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx="3" fill={BODY} stroke={INK} strokeWidth="1.5" />
      <text x={x} y={y - 6} fontSize="11" fontWeight="700" fill={INK}>{part.id}</text>
      <text x={x + w / 2} y={y + 34} fontSize="9.5" textAnchor="middle" fill="#47505b">{shortName(part.name)}</text>
    </>
  );
}

function shortName(name: string): string {
  return name.replace(', 4-pin I²C', '').replace(' temperature sensor (TO-92)', '').replace(', SSD1306, I²C', '').replace(' rotary encoder', ' encoder');
}

function TwoPin({ part }: { part: SchematicPart }) {
  const cx = part.box.x + part.box.w / 2;
  const cy = part.box.y + part.box.h / 2;
  const top = part.pins[0]!;
  const label = (
    <>
      <text x={cx + 16} y={cy - 2} fontSize="11" fontWeight="700" fill={INK}>{part.id}</text>
      <text x={cx + 16} y={cy + 12} fontSize="10" fill="#47505b">{part.value ?? symbolWord(part.symbol)}</text>
    </>
  );
  const stroke = { stroke: INK, strokeWidth: 1.5, fill: 'none' } as const;
  if (part.symbol === 'resistor' || part.symbol === 'ldr') {
    return (
      <>
        <rect x={cx - 6} y={cy - 18} width="12" height="36" rx="1" fill={BODY} stroke={INK} strokeWidth="1.5" />
        <line x1={cx} y1={cy - 20} x2={cx} y2={cy - 18} {...stroke} />
        <line x1={cx} y1={cy + 18} x2={cx} y2={cy + 20} {...stroke} />
        {part.symbol === 'ldr' && (
          <g {...stroke} strokeWidth={1.2}>
            <path d={`M${cx - 26} ${cy - 18} L${cx - 10} ${cy - 6} M${cx - 15} ${cy - 6} L${cx - 10} ${cy - 6} L${cx - 11} ${cy - 11}`} />
            <path d={`M${cx - 26} ${cy - 4} L${cx - 10} ${cy + 8} M${cx - 15} ${cy + 8} L${cx - 10} ${cy + 8} L${cx - 11} ${cy + 3}`} />
          </g>
        )}
        {label}
      </>
    );
  }
  if (part.symbol === 'led') {
    const down = top.pin === 'A'; // triangle points from anode to cathode
    const tip = down ? cy + 8 : cy - 8;
    const base = down ? cy - 8 : cy + 8;
    return (
      <>
        <rect x={cx - 12} y={cy - 20} width="24" height="40" fill="transparent" />
        <path d={`M${cx - 10} ${base} L${cx + 10} ${base} L${cx} ${tip} Z`} fill={BODY} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
        <line x1={cx - 10} y1={tip} x2={cx + 10} y2={tip} {...stroke} />
        <line x1={cx} y1={cy - 20} x2={cx} y2={cy - 8} {...stroke} />
        <line x1={cx} y1={cy + 8} x2={cx} y2={cy + 20} {...stroke} />
        <g {...stroke} strokeWidth={1.2}>
          <path d={`M${cx + 9} ${cy - 2} L${cx + 20} ${cy - 11} M${cx + 15} ${cy - 11} L${cx + 20} ${cy - 11} L${cx + 19} ${cy - 6}`} />
        </g>
        <text x={cx + 26} y={cy + 4} fontSize="11" fontWeight="700" fill={INK}>{part.id}</text>
        <text x={cx + 26} y={cy + 17} fontSize="10" fill="#47505b">{part.value ?? 'LED'}</text>
      </>
    );
  }
  // Piezo: a crystal between two plates.
  return (
    <>
      <rect x={cx - 12} y={cy - 20} width="24" height="40" fill="transparent" />
      <line x1={cx} y1={cy - 20} x2={cx} y2={cy - 9} {...stroke} />
      <line x1={cx} y1={cy + 9} x2={cx} y2={cy + 20} {...stroke} />
      <line x1={cx - 11} y1={cy - 9} x2={cx + 11} y2={cy - 9} {...stroke} strokeWidth={2} />
      <line x1={cx - 11} y1={cy + 9} x2={cx + 11} y2={cy + 9} {...stroke} strokeWidth={2} />
      <rect x={cx - 8} y={cy - 5} width="16" height="10" fill={BODY} stroke={INK} strokeWidth="1.3" />
      {label}
    </>
  );
}

function symbolWord(symbol: string): string {
  return symbol === 'ldr' ? 'LDR' : symbol === 'piezo' ? 'piezo' : '';
}

function Pin({ pin, block, onSelect, dimmed }: { pin: SchematicPin; block: boolean; onSelect: (s: Selection) => void; dimmed: boolean }) {
  const select = () => pin.net && onSelect({ kind: 'net', id: pin.net });
  let label = null;
  if (block) {
    const places: Record<SchematicPin['side'], { x: number; y: number; a: 'start' | 'middle' | 'end' }> = { left: { x: pin.base.x + 6, y: pin.base.y + 3.5, a: 'start' }, right: { x: pin.base.x - 6, y: pin.base.y + 3.5, a: 'end' }, up: { x: pin.base.x, y: pin.base.y + 13, a: 'middle' }, down: { x: pin.base.x, y: pin.base.y - 6, a: 'middle' } };
    const inside = places[pin.side];
    label = <text x={inside.x} y={inside.y} fontFamily={ID_FONT} fontSize="9.5" textAnchor={inside.a} fill={INK}>{pin.label}</text>;
  } else if (pin.label !== '1' && pin.label !== '2') {
    label = <text x={pin.base.x - 7} y={pin.side === 'up' ? pin.base.y - 4 : pin.base.y + 11} fontFamily={ID_FONT} fontSize="9" textAnchor="end" fill="#47505b">{pin.label}</text>;
  }
  return (
    <g className={`sch-pin ${dimmed ? 'is-dim' : ''}`} onClick={select}>
      <line x1={pin.base.x} y1={pin.base.y} x2={pin.end.x} y2={pin.end.y} stroke={INK} strokeWidth="1.5" />
      <line x1={pin.base.x} y1={pin.base.y} x2={pin.end.x} y2={pin.end.y} stroke="transparent" strokeWidth="10" data-export="skip" />
      {label}
    </g>
  );
}

function Flag({ flag, className, onSelect }: { flag: SchematicLayout['flags'][number]; className: string; onSelect: (s: Selection) => void }) {
  const { x, y } = flag.at;
  const s = flag.dir === 'up' ? -1 : 1;
  return (
    <g className={`sch-flag ${className}`} onClick={() => onSelect({ kind: 'net', id: flag.net })}>
      <rect x={x - 14} y={Math.min(y, y + s * 26)} width="28" height="26" fill="transparent" data-export="skip" />
      <line x1={x} y1={y} x2={x} y2={y + s * 8} stroke={INK} strokeWidth="1.5" />
      {flag.kind === 'power' ? (
        <>
          <line x1={x - 8} y1={y + s * 8} x2={x + 8} y2={y + s * 8} stroke={POWER_RED} strokeWidth="2" />
          <text x={x} y={y + s * 8 + (s < 0 ? -5 : 13)} fontSize="9.5" fontWeight="700" textAnchor="middle" fill={POWER_RED}>{flag.label}</text>
        </>
      ) : (
        <g stroke={INK} strokeWidth="1.5">
          <line x1={x - 9} y1={y + s * 8} x2={x + 9} y2={y + s * 8} />
          <line x1={x - 5.5} y1={y + s * 11.5} x2={x + 5.5} y2={y + s * 11.5} />
          <line x1={x - 2} y1={y + s * 15} x2={x + 2} y2={y + s * 15} />
        </g>
      )}
    </g>
  );
}

export function schematicSize(layout: SchematicLayout) {
  return { width: Math.max(layout.width, 520), height: layout.height + 56 };
}
