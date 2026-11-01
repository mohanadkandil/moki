import type { PhysicalLayout, PhysicalPart, PhysicalPin } from '../../../src/circuit/layout';
import type { Selection } from './selection';

const HIGHLIGHT = '#ffe14d';
const MAT = '#2e7657';
const MAT_LINE = '#3f8868';
const LABEL = '#f3f6f1';
const GOLD = '#d8b04a';
const LEG = '#c3c7cc';
const UI_FONT = "'Manrope Variable', Manrope, system-ui, sans-serif";
const ID_FONT = "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

export default function WiringView({ layout, selection, onSelect, fresh, screenText }: {
  layout: PhysicalLayout; selection: Selection; onSelect: (s: Selection) => void; fresh: ReadonlySet<string>; screenText: string;
}) {
  const netSel = selection?.kind === 'net' ? selection.id : null;
  const partSel = selection?.kind === 'part' ? selection.id : null;
  const { width, height } = layout;
  return (
    <g fontFamily={UI_FONT}>
      <defs>
        <pattern id="mat-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0 L0 0 0 10" fill="none" stroke={MAT_LINE} strokeWidth="0.2" />
        </pattern>
      </defs>
      <rect width={width} height={height} rx="3" fill={MAT} />
      <rect width={width} height={height} rx="3" fill="url(#mat-grid)" />

      {layout.rails.map(rail => (
        <g key={rail.side}>
          <rect x={rail.x1} y={rail.y} width={rail.x2 - rail.x1} height="13" rx="1.2" fill="#f2f1ea" />
          {rail.rows.map(row => (
            <g key={row.net} className={netSel && netSel !== row.net ? 'is-dim' : ''} onClick={() => onSelect({ kind: 'net', id: row.net })} style={{ cursor: 'pointer' }}>
              {netSel === row.net && <rect data-export="skip" className="hl" x={rail.x1 + 1} y={row.y - 2.2} width={rail.x2 - rail.x1 - 2} height="4.4" rx="1" fill={HIGHLIGHT} />}
              <line x1={rail.x1 + 11} x2={rail.x2 - 2} y1={row.y + (row.kind === 'power' ? -1.75 : 1.75)} y2={row.y + (row.kind === 'power' ? -1.75 : 1.75)} stroke={row.kind === 'power' ? '#d43c3c' : '#2d63c8'} strokeWidth="0.35" />
              {holes(rail.x1 + 12, rail.x2 - 3, row.y)}
              <text x={rail.x1 + 1.8} y={row.y + 0.7} fontSize="1.9" fontWeight="700" fill={row.kind === 'power' ? '#b3262f' : '#1e4a9c'}>{row.label}</text>
            </g>
          ))}
        </g>
      ))}

      {partSel && layout.parts.filter(p => p.id === partSel).map(p => (
        <rect key={p.id} data-export="skip" className="hl" x={p.x - 2.5} y={p.y - 2.5} width={p.w + 5} height={p.h + 5} rx="2" fill={HIGHLIGHT} />
      ))}
      {layout.parts.filter(p => fresh.has(p.id)).map(p => (
        <rect key={`fresh-${p.id}`} data-export="skip" className="fresh-mark" x={p.x - 2.5} y={p.y - 2.5} width={p.w + 5} height={p.h + 5} rx="2" fill={HIGHLIGHT} />
      ))}

      {layout.parts.map(part => (
        <g key={part.id} className="wr-part" onClick={() => onSelect({ kind: 'part', id: part.id })}>
          <g transform={`translate(${part.x} ${part.y})`}>
            <Drawing part={part} screenText={screenText} />
          </g>
          <PartLabel part={part} />
        </g>
      ))}

      {netSel && (
        <g data-export="skip" className="hl">
          {layout.wires.filter(w => w.net === netSel).map((w, i) => <path key={i} d={w.d} fill="none" stroke={HIGHLIGHT} strokeWidth="3.4" strokeLinecap="round" />)}
        </g>
      )}
      {layout.wires.map((w, i) => (
        <g key={i} className={`wr-wire ${netSel && w.net !== netSel ? 'is-dim' : ''}`} onClick={() => onSelect({ kind: 'net', id: w.net })}>
          <path d={w.d} fill="none" stroke="#0b2117" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
          <path d={w.d} fill="none" stroke={w.color} strokeWidth="1.05" strokeLinecap="round" />
          <path d={w.d} fill="none" stroke="transparent" strokeWidth="3.5" data-export="skip" />
          <circle cx={w.from.x} cy={w.from.y} r="0.7" fill={w.color} stroke="#0b2117" strokeWidth="0.25" />
          <circle cx={w.to.x} cy={w.to.y} r="0.7" fill={w.color} stroke="#0b2117" strokeWidth="0.25" />
        </g>
      ))}
      {layout.splices.map((s, i) => (
        <circle key={i} className={netSel && s.net !== netSel ? 'is-dim' : ''} cx={s.at.x} cy={s.at.y} r="1.15" fill="#e4e4dc" stroke="#0b2117" strokeWidth="0.35" onClick={() => onSelect({ kind: 'net', id: s.net })} />
      ))}
      {layout.parts.flatMap(p => p.pins).filter(p => p.net).map(pin => (
        <circle key={`${pin.part}.${pin.pin}`} cx={pin.at.x} cy={pin.at.y} r="1.4" fill="transparent" data-export="skip" style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onSelect({ kind: 'net', id: pin.net! }); }} />
      ))}
    </g>
  );
}

function holes(from: number, to: number, y: number) {
  const out = [];
  for (let x = from; x <= to; x += 2.54) out.push(<rect key={x} x={x - 0.4} y={y - 0.4} width="0.8" height="0.8" fill="#bdbbb0" />);
  return out;
}

function PartLabel({ part }: { part: PhysicalPart }) {
  const passive = ['resistor', 'ldr', 'led', 'piezo', 'to92'].includes(part.drawing);
  const text = `${part.id}${part.value ? ` · ${part.value}` : ''}`;
  if (passive) {
    return <text x={part.x + part.w + 1.6} y={part.y + 3} fontSize="2.5" fontWeight="700" fill={LABEL}>{text}</text>;
  }
  return (
    <text x={part.x} y={part.y - 1.8} fontSize="2.5" fill={LABEL}>
      <tspan fontWeight="700">{part.id}</tspan>
      <tspan dx="1.2" fillOpacity="0.85">{part.name}</tspan>
    </text>
  );
}

function pinLabel(pin: PhysicalPin, part: PhysicalPart, x: number, y: number, anchor: 'start' | 'middle' | 'end') {
  return (
    <text key={`t${pin.pin}`} x={x} y={y} fontFamily={ID_FONT} fontSize="1.45" textAnchor={anchor} fontWeight={pin.net ? 700 : 400} fill={pin.net ? '#ffffff' : '#858b91'}>
      {pin.label}
    </text>
  );
}

function headerPin(pin: PhysicalPin, part: PhysicalPart) {
  const x = pin.at.x - part.x;
  const y = pin.at.y - part.y;
  return (
    <g key={pin.pin}>
      <rect x={x - 0.8} y={y - 0.8} width="1.6" height="1.6" fill={GOLD} rx="0.15" />
      <circle cx={x} cy={y} r="0.38" fill="#3a2f12" />
    </g>
  );
}

const BAND = ['#1b1b1b', '#7a4a2a', '#d0342c', '#ef7d22', '#f2c230', '#2e8b57', '#2d63c8', '#7d4fb5', '#8a8a8a', '#f2f2f2'];

export function resistorBands(value: string | undefined): string[] {
  const m = value?.match(/([\d.]+)\s*(k|M)?/);
  if (!m) return [];
  const ohms = Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'M' ? 1e6 : 1);
  if (!Number.isFinite(ohms) || ohms < 10) return [];
  const exp = Math.floor(Math.log10(ohms)) - 1;
  const sig = Math.round(ohms / 10 ** exp);
  return [BAND[Math.floor(sig / 10)]!, BAND[sig % 10]!, BAND[exp]!, '#c9a227'];
}

function Drawing({ part, screenText }: { part: PhysicalPart; screenText: string }) {
  const { w, h } = part;
  switch (part.drawing) {
    case 'esp32-devkitc':
      return (
        <>
          <rect x="0.4" y="0.6" width={w} height={h} rx="1.2" fill="#0d0f12" opacity="0.5" />
          <rect width={w} height={h} rx="1.2" fill="#1b1d21" stroke="#2c3036" strokeWidth="0.3" />
          <rect x="4.95" y="0.9" width="18" height="25.5" rx="0.6" fill="#22252a" stroke="#3a3f46" strokeWidth="0.2" />
          <path d="M6.5 2.4 h2.5 v3 h2 v-3 h2 v3 h2 v-3 h2 v3 h2.2" fill="none" stroke="#c99a3d" strokeWidth="0.45" />
          <rect x="5.9" y="7.6" width="16.1" height="17.6" rx="0.5" fill="#cdd2d8" stroke="#9aa1a9" strokeWidth="0.25" />
          <text x="13.95" y="15.4" fontSize="1.55" textAnchor="middle" fill="#4b525b" fontWeight="700">ESP32-WROOM-32</text>
          <text x="13.95" y="17.6" fontSize="1.2" textAnchor="middle" fill="#6b727b">Wi-Fi + Bluetooth</text>
          <rect x="10.45" y={h - 5.2} width="7" height="5.6" rx="0.6" fill="#b9bfc6" stroke="#8e959d" strokeWidth="0.2" />
          <text x="13.95" y={h - 6.4} fontSize="1.3" textAnchor="middle" fill="#9aa1a9">USB · 5 V in</text>
          <rect x="5.4" y={h - 4.2} width="2.6" height="2.6" rx="0.3" fill="#454a51" /><circle cx="6.7" cy={h - 2.9} r="0.75" fill="#15171a" />
          <rect x="19.9" y={h - 4.2} width="2.6" height="2.6" rx="0.3" fill="#454a51" /><circle cx="21.2" cy={h - 2.9} r="0.75" fill="#15171a" />
          {part.pins.map(p => headerPin(p, part))}
          {part.pins.map(p => {
            const x = p.at.x - part.x;
            const y = p.at.y - part.y + 0.5;
            return p.dir === 'left' ? pinLabel(p, part, x + 1.3, y, 'start') : pinLabel(p, part, x - 1.3, y, 'end');
          })}
        </>
      );
    case 'oled-ssd1306':
      return (
        <>
          <rect x="0.4" y="0.6" width={w} height={h} rx="1" fill="#0d0f12" opacity="0.45" />
          <rect width={w} height={h} rx="1" fill="#1d4f9e" />
          {[[1.6, 1.6], [w - 1.6, 1.6], [1.6, h - 1.6], [w - 1.6, h - 1.6]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="0.9" fill="#0f2f63" />)}
          <rect x="0.6" y="5.3" width={w - 1.2} height="18.6" rx="0.4" fill="#0b0c0f" />
          <rect x="2.6" y="7.6" width={w - 5.2} height="12.6" fill="#0e1524" />
          <text x={w / 2} y="15.9" fontSize="5" textAnchor="middle" fill="#9fd6ff" fontFamily={ID_FONT} fontWeight="700">{screenText}</text>
          {part.pins.map(p => headerPin(p, part))}
          {part.pins.map(p => pinLabel(p, part, p.at.x - part.x, 4.3, 'middle'))}
        </>
      );
    case 'ky040':
      return (
        <>
          <rect x="0.4" y="0.6" width={w} height={h} rx="1" fill="#0d0f12" opacity="0.45" />
          <rect width={w} height={h} rx="1" fill="#24272e" />
          <rect x="3" y="3.3" width="12.4" height="12.4" rx="0.6" fill="#9ca2a8" stroke="#6f767d" strokeWidth="0.25" />
          <circle cx="9.2" cy="9.5" r="6.6" fill="#33363c" stroke="#55595f" strokeWidth="0.3" />
          {Array.from({ length: 18 }, (_, i) => {
            const a = (i / 18) * Math.PI * 2;
            return <line key={i} x1={9.2 + Math.cos(a) * 5.2} y1={9.5 + Math.sin(a) * 5.2} x2={9.2 + Math.cos(a) * 6.4} y2={9.5 + Math.sin(a) * 6.4} stroke="#1f2125" strokeWidth="0.35" />;
          })}
          <circle cx="9.2" cy="9.5" r="2.9" fill="#bfc4c9" />
          <path d="M7.4 8.5 h3.6 v2 h-3.6 z" fill="#8c9298" />
          {part.pins.map(p => headerPin(p, part))}
          {part.pins.map(p => pinLabel(p, part, p.at.x - part.x - 1.4, p.at.y - part.y + 0.5, 'end'))}
        </>
      );
    case 'to92':
      return (
        <>
          {part.pins.map(p => <line key={p.pin} x1={p.at.x - part.x} y1="4.4" x2={p.at.x - part.x} y2={h} stroke={LEG} strokeWidth="0.42" />)}
          <path d="M0.1 4.6 L0.1 2.4 A2.4 2.4 0 0 1 4.9 2.4 L4.9 4.6 Z" fill="#17181b" stroke="#3b3e43" strokeWidth="0.2" />
          <text x="2.5" y="3.6" fontSize="0.9" textAnchor="middle" fill="#c9cdd2">18B20</text>
          {part.pins.map(p => pinLabel(p, part, p.at.x - part.x, 7.2 + (p.pin === 'DQ' ? 1.6 : 0), 'middle'))}
        </>
      );
    case 'bme280':
      return (
        <>
          <rect x="0.4" y="0.6" width={w} height={h} rx="0.8" fill="#0d0f12" opacity="0.45" />
          <rect width={w} height={h} rx="0.8" fill="#17616e" />
          <rect x="5.3" y="6" width="2.5" height="2.5" rx="0.2" fill="#cdd2d8" />
          <circle cx="6.15" cy="6.85" r="0.3" fill="#3b4148" />
          <circle cx="1.8" cy={h - 1.8} r="0.9" fill="#0d3d46" />
          <circle cx={w - 1.8} cy={h - 1.8} r="0.9" fill="#0d3d46" />
          {part.pins.map(p => headerPin(p, part))}
          {part.pins.map(p => pinLabel(p, part, p.at.x - part.x, 4.1, 'middle'))}
        </>
      );
    case 'resistor': {
      const bands = resistorBands(part.value);
      return (
        <>
          <line x1="1.3" y1="0" x2="1.3" y2={h} stroke={LEG} strokeWidth="0.42" />
          <rect x="0" y="4.5" width="2.6" height="7" rx="1.1" fill="#d9c49c" />
          {bands.map((c, i) => <rect key={i} x="0" y={5.4 + i * 1.35 + (i === 3 ? 0.7 : 0)} width="2.6" height="0.7" fill={c} />)}
        </>
      );
    }
    case 'ldr':
      return (
        <>
          {part.pins.map(p => <line key={p.pin} x1={p.at.x - part.x} y1="4" x2={p.at.x - part.x} y2={p.at.y - part.y} stroke={LEG} strokeWidth="0.42" />)}
          <circle cx="2.5" cy="2.5" r="2.5" fill="#e5c87a" stroke="#b39446" strokeWidth="0.2" />
          <path d="M0.9 1.4 h3.2 v0.7 h-3.2 v0.7 h3.2 v0.7 h-3.2 v0.7 h3.2" fill="none" stroke="#8c3b1c" strokeWidth="0.32" />
        </>
      );
    case 'led':
      return (
        <>
          {part.pins.map(p => <line key={p.pin} x1={p.at.x - part.x} y1="6" x2={p.at.x - part.x} y2={p.at.y - part.y} stroke={LEG} strokeWidth="0.42" />)}
          <rect x="0" y="4.9" width={w} height="1.2" rx="0.3" fill="#f3a632" />
          <path d={`M0.45 5 V2.9 A2.45 2.45 0 0 1 5.35 2.9 V5 Z`} fill="#ffb84a" fillOpacity="0.92" />
          <path d="M1.4 4.2 V2.9 A1.4 1.4 0 0 1 2.4 1.6" fill="none" stroke="#fff3d6" strokeWidth="0.35" strokeLinecap="round" />
          {part.pins.map(p => pinLabel(p, part, p.at.x - part.x + (p.pin === 'A' ? 1.2 : -1.2), p.at.y - part.y - 1.5, p.pin === 'A' ? 'start' : 'end'))}
        </>
      );
    case 'piezo':
      return (
        <>
          {part.pins.map(p => <line key={p.pin} x1={p.at.x - part.x} y1="10" x2={p.at.x - part.x} y2={p.at.y - part.y} stroke={LEG} strokeWidth="0.42" />)}
          <circle cx="6.4" cy="6.6" r="6" fill="#0d0f12" opacity="0.45" />
          <circle cx="6" cy="6" r="6" fill="#1d1f23" stroke="#3b3e44" strokeWidth="0.25" />
          <circle cx="6" cy="6" r="1.3" fill="#060607" />
          <text x="3.2" y="4" fontSize="2" fill="#c9cdd2" fontWeight="700">+</text>
          {part.pins.map(p => pinLabel(p, part, p.at.x - part.x + (p.pin === '+' ? -1 : 1), p.at.y - part.y - 0.6, p.pin === '+' ? 'end' : 'start'))}
        </>
      );
  }
}
