import { ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { connectedPins, type BoardModel } from './pcbModel';

/** One part, wherever you selected it: what it is and what its pins are wired to. A net opens on the PCB. */
export function PartCard({ model, part: ref, net, onClose, onNet, children }: { model: BoardModel; part: string; net?: string | null; onClose: () => void; onNet?: (id: string | null) => void; children?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  // On a phone the card would cover what you picked, so its pins wait to be asked for.
  const [pinsOpen, setPinsOpen] = useState(() => !window.matchMedia('(max-width: 1000px)').matches);
  const part = model.parts.find(p => p.ref === ref);
  if (!part) return null;
  const wired = connectedPins(part);
  const pins = all ? part.pins : wired;
  return (
    <aside className="st-part-card st-sheet" aria-label={`Part ${ref}`}>
      <header>
        <strong>{ref}</strong>
        <button type="button" className="st-part-card-close" aria-label="Clear selection" title="Clear selection  ·  Esc" onClick={onClose}><X size={14} aria-hidden="true" /></button>
      </header>
      {part.name && <p className="st-part-card-name">{part.name}</p>}
      <p className="st-part-card-where">{`${+part.x.toFixed(1)}, ${+part.y.toFixed(1)} mm on the ${part.layer === 'bottom' ? 'back' : 'front'}`}</p>
      {part.pins.length > 0 && (
        <>
          <button type="button" className="st-part-card-head" aria-expanded={pinsOpen} onClick={() => setPinsOpen(o => !o)}>{`${wired.length} of ${part.pins.length} pins wired`}<ChevronRight size={13} aria-hidden="true" /></button>
          {pinsOpen && <><ul className="st-part-pins">
            {pins.map(pin => {
              const name = pin.net ? model.nets.get(pin.net)?.name ?? null : null;
              return (
                <li key={`${pin.number}-${pin.label}`}>
                  <span className="st-part-pin">{pin.label || pin.number}</span>
                  {name && onNet
                    ? <button type="button" aria-pressed={net === pin.net} onClick={() => onNet(net === pin.net ? null : pin.net)}>{name}</button>
                    : <span className="st-part-net">{name ?? 'Not connected'}</span>}
                </li>
              );
            })}
          </ul>
          {wired.length < part.pins.length && <button type="button" className="st-part-more" onClick={() => setAll(a => !a)}>{all ? 'Only wired pins' : `All ${part.pins.length} pins`}</button>}</>}
        </>
      )}
      {children}
    </aside>
  );
}
