import { X } from 'lucide-react';
import { moduleDef } from '../../../src/circuit/catalog';
import type { CircuitDesign, Net } from '../../../src/circuit/model';
import type { Selection } from './selection';

function pinLabel(design: CircuitDesign, part: string, pin: string): string {
  const instance = design.parts.find(p => p.id === part);
  return instance ? moduleDef(instance.module).pins.find(p => p.id === pin)?.label ?? pin : pin;
}

function netKind(net: Net): string {
  if (net.kind === 'power') return `Power · ${net.volts ?? '?'} V`;
  if (net.kind === 'ground') return 'Ground';
  return net.analog ? 'Signal · analog reading' : 'Signal';
}

export default function Inspector({ design, selection, onSelect, colors }: {
  design: CircuitDesign; selection: Selection; onSelect: (s: Selection) => void; colors: ReadonlyMap<string, string>;
}) {
  const net = selection?.kind === 'net' ? design.nets.find(n => n.id === selection.id) : undefined;
  const part = selection?.kind === 'part' ? design.parts.find(p => p.id === selection.id) : undefined;

  return (
    <aside className="lab-inspector" aria-labelledby="inspect-heading">
      <h2 id="inspect-heading" className="sr-only">Inspect</h2>
      <section className="lab-detail" aria-live="polite">
        {!net && !part && (
          <p className="lab-detail-empty">Select a part or a connection, in the drawing or the lists below, to see what it is and why it is wired that way.</p>
        )}
        {net && (
          <>
            <header className="lab-detail-head">
              <span className="lab-swatch" style={{ background: colors.get(net.id) }} aria-hidden="true" />
              <div>
                <h3 className="lab-mono">{net.name}</h3>
                <p>{netKind(net)} · {net.endpoints.length} pins</p>
              </div>
              <button type="button" className="lab-icon-button" onClick={() => onSelect(null)} aria-label="Clear selection"><X size={16} /></button>
            </header>
            <h4>Why these connect</h4>
            <p className="lab-why">{net.why}</p>
            <h4>Pins on this connection</h4>
            <ul className="lab-pinlist">
              {net.endpoints.map(e => (
                <li key={`${e.part}.${e.pin}`}>
                  <button type="button" onClick={() => onSelect({ kind: 'part', id: e.part })}>
                    <span className="lab-mono">{e.part} · {pinLabel(design, e.part, e.pin)}</span>
                    <span>{moduleDef(design.parts.find(p => p.id === e.part)!.module).name}</span>
                  </button>
                </li>
              ))}
            </ul>
            {design.notes.filter(n => n.net === net.id).map((n, i) => <p key={i} className={`lab-note is-${n.level}`}>{n.text}</p>)}
          </>
        )}
        {part && <PartDetail design={design} partId={part.id} onSelect={onSelect} colors={colors} />}
      </section>

      <section className="lab-lists">
        <h3>Parts</h3>
        <ul>
          {design.parts.map(p => (
            <li key={p.id}>
              <button type="button" aria-pressed={selection?.kind === 'part' && selection.id === p.id} onClick={() => onSelect({ kind: 'part', id: p.id })}>
                <span className="lab-mono lab-ref">{p.id}</span>
                <span>{moduleDef(p.module).name}{p.value ? `, ${p.value}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
        <h3>Connections</h3>
        <ul>
          {design.nets.map(n => (
            <li key={n.id}>
              <button type="button" aria-pressed={selection?.kind === 'net' && selection.id === n.id} onClick={() => onSelect({ kind: 'net', id: n.id })}>
                <span className="lab-swatch" style={{ background: colors.get(n.id) }} aria-hidden="true" />
                <span className="lab-mono">{n.name}</span>
                <span className="lab-count">{n.endpoints.length} pins</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function PartDetail({ design, partId, onSelect, colors }: { design: CircuitDesign; partId: string; onSelect: (s: Selection) => void; colors: ReadonlyMap<string, string> }) {
  const part = design.parts.find(p => p.id === partId)!;
  const def = moduleDef(part.module);
  const connected = def.pins
    .map(pin => ({ pin, net: design.nets.find(n => n.endpoints.some(e => e.part === part.id && e.pin === pin.id)) }))
    .filter(x => x.net);
  const hidden = def.pins.length - connected.length;
  return (
    <>
      <header className="lab-detail-head">
        <span className="lab-mono lab-ref is-large">{part.id}</span>
        <div>
          <h3>{def.name}</h3>
          <p>{part.value ? `${part.value} · ` : ''}{def.supply ? `Supply ${def.supply.min}–${def.supply.max} V` : def.provides ? `Provides ${def.provides} V` : 'Passive'}</p>
        </div>
        <button type="button" className="lab-icon-button" onClick={() => onSelect(null)} aria-label="Clear selection"><X size={16} /></button>
      </header>
      <h4>Why it’s here</h4>
      <p className="lab-why">{part.role}</p>
      <h4>Pins</h4>
      <ul className="lab-pinlist">
        {connected.map(({ pin, net }) => (
          <li key={pin.id}>
            <button type="button" onClick={() => onSelect({ kind: 'net', id: net!.id })}>
              <span className="lab-mono">{pin.label}</span>
              <span className="lab-pin-net"><span className="lab-swatch" style={{ background: colors.get(net!.id) }} aria-hidden="true" /><span className="lab-mono">{net!.name}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="lab-quiet">{hidden} unused pins not shown.</p>}
      <h4>Check on your module</h4>
      <ul className="lab-notes">
        {[...design.notes.filter(n => n.part === part.id).map(n => n.text), ...def.notes].map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </>
  );
}
