import { Download, ScanEye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useArtifact } from '../board/api';
import { formatBytes } from '../board/logic';
import type { Artifact, BoardJob } from '../board/types';
import { boxMm, num, obj, objects, str, type Json } from './facts';
import ModelPane from './ModelPane';
import { DockChoice, RailButton } from './Rail';
import { PaneState } from './PaneState';

const asJson = (res: Response) => res.json() as Promise<unknown>;
const FACES: Record<string, string> = { x_neg: 'left wall', x_pos: 'right wall', y_neg: 'front wall', y_pos: 'back wall', z_pos: 'lid', z_neg: 'floor' };
const PURPOSES: Record<string, string> = { usb: 'USB cable', vent: 'Vent slots', sound: 'Sound holes', 'encoder-shaft': 'Knob shaft', 'display-active-area': 'Display window', 'sensor-air': 'Sensor air vents', 'light-sensor': 'Light sensor window', indicator: 'Indicator light' };
const ONLY_SHELL = ['Box0'];
type Part = 'closed' | 'base' | 'lid';

function FileRow({ name, label, artifact }: { name: string; label: string; artifact: Artifact }) {
  return <a className="st-file" href={artifact.url} download={name}><Download size={14} aria-hidden="true" /><span>{label}</span><em>{formatBytes(artifact.bytes)}</em></a>;
}

const mm = (v: unknown) => { const n = num(v); return n === null ? null : `${+n.toFixed(2)} mm`; };

export function Rows({ rows }: { rows: readonly (readonly [string, string | null])[] }) {
  const shown = rows.filter((r): r is readonly [string, string] => r[1] !== null);
  if (!shown.length) return null;
  return <dl className="st-rows">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function shell(v: unknown): string | null {
  const s = obj(obj(v).stl);
  if (typeof s.watertight !== 'boolean') return null;
  const bad = num(s.nonManifoldEdges);
  return `${s.watertight ? 'Watertight' : 'Not watertight'}${bad ? `, ${bad} open edges` : ''}`;
}

/** The case's footprint and height at true proportion, so its size reads before its numbers do. */
function SizePlan({ value }: { value: unknown }) {
  const size = obj(value);
  const [w, d, h] = [num(size.width) ?? num(size.x), num(size.depth) ?? num(size.y), num(size.height) ?? num(size.z)];
  if (w === null || d === null || h === null) return null;
  const scale = 76 / Math.max(w, d, 1);
  const [pw, pd, ph] = [w * scale, d * scale, h * scale];
  return (
    <svg className="st-size-plan" width={pw + ph + 52} height={Math.max(pd, ph) + 22} role="img" aria-label={`${+w.toFixed(1)} wide, ${+d.toFixed(1)} deep, ${+h.toFixed(1)} high, in millimetres`}>
      <rect x="1" y="1" width={pw} height={pd} rx="3" />
      <text x={pw / 2} y={pd + 15} textAnchor="middle">{+w.toFixed(1)}</text>
      <text x={pw + 8} y={pd / 2 + 4}>{+d.toFixed(1)}</text>
      <rect x={pw + 48} y={pd - ph + 1} width={ph} height={ph} rx="2" />
      <text x={pw + 48 + ph / 2} y={pd + 15} textAnchor="middle">{+h.toFixed(1)}</text>
    </svg>
  );
}

export default function CaseTab({ job, part: selectedPart, onPart }: { job: BoardJob; part: string | null; onPart: (ref: string | null) => void }) {
  const info = job.artifacts?.['enclosure.json'];
  const assembly = job.artifacts?.['assembly.glb'];
  const base = job.artifacts?.['enclosure-base.stl'];
  const lid = job.artifacts?.['enclosure-lid.stl'];
  const step = job.artifacts?.['enclosure.step'];
  const loaded = useArtifact(info, asJson);
  const [part, setPart] = useState<Part>('closed');
  const [selected, setSelected] = useState<string | null>(null);
  const [insideByHand, setInside] = useState(false);
  // A part selected on another tab has to be visible here too, so the shell opens around it.
  const inside = insideByHand || Boolean(selectedPart);
  const openings = objects(obj(loaded.state === 'ready' ? loaded.value : null).apertures);
  useEffect(() => {
    if (!selectedPart) return;
    const own = openings.find(a => str(a.part) === selectedPart);
    setSelected(own ? str(own.id) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPart, loaded.state]);

  if (!info && !base) {
    const stage = job.stages?.find(s => s.name === 'enclosure');
    const waiting = job.status === 'running' || job.status === 'queued';
    return <PaneState what="the case" waiting={waiting} absent={stage?.note ?? (waiting ? 'The case appears when its stage finishes.' : 'This build has no case.')} />;
  }
  const data: Json = obj(loaded.state === 'ready' ? loaded.value : null);
  const dims = obj(data.dimensions);
  const fit = obj(data.clearancesMm);
  const fastening = obj(data.fastening);
  const estimate = obj(data.estimate);
  const validation = obj(data.validation);
  const print = obj(data.printOrientation);
  const engine = obj(data.engine);
  const apertures = objects(data.apertures);
  const chosen = apertures.find(a => str(a.id) === selected);
  const position = chosen ? obj(chosen.position) : null;
  const marker = position && num(position.x) !== null && num(position.y) !== null && num(position.z) !== null ? [position.x as number, position.y as number, position.z as number] as const : null;
  const grams = num(estimate.filamentG);
  const screws = num(fastening.count);
  const onlyShell = inside ? [] : ONLY_SHELL;
  const hidden = part === 'closed' ? onlyShell : part === 'base' ? [...onlyShell, 'enclosure-lid'] : [...onlyShell, 'enclosure-base'];

  return (
    <div className="st-split is-stage">
      <div className="st-split-view">
        {assembly || base ? (
          <>
            <ModelPane
              url={assembly ? assembly.url : base!.url}
              format={assembly ? 'glb' : 'stl'}
              label="The generated case, as a 3D model"
              hidden={assembly ? hidden : undefined}
              hideParts={Boolean(assembly) && !inside}
              lid={inside ? 'ghost' : 'solid'}
              selected={selectedPart}
              onSelect={inside ? onPart : undefined}
              tools={assembly ? <RailButton label="Show the parts inside" pressed={inside} disabled={Boolean(selectedPart)} onClick={() => setInside(v => !v)}><ScanEye size={16} /></RailButton> : undefined}
              marker={assembly ? marker : null}
              views={assembly ? <DockChoice<Part> label="Case part" value={part} onChange={setPart} options={[{ id: 'closed', label: 'Closed' }, { id: 'base', label: 'Base' }, { id: 'lid', label: 'Lid' }]} /> : undefined}
            />
          </>
        ) : <PaneState what="the case model" absent="This build has dimensions but no model file." />}
      </div>
      <aside className="st-inspector st-sheet" aria-label="Case spec sheet">
        <p className="st-sheet-title">Case spec</p>
        {loaded.state !== 'ready' && info && <PaneState what="the case data" error={loaded.state === 'error' ? loaded.message : undefined} />}
        {engine.fallback === true && <p className="st-warn-note">build123d failed on this board, so this is the simpler fallback box. It has no STEP file and may not be watertight.</p>}
        {boxMm(dims.outerMm) && (
          <section>
            <h3>Size</h3>
            <p className="st-inspector-big">{boxMm(dims.outerMm)}</p>
            <SizePlan value={dims.outerMm} />
            <Rows rows={[
              ['Inside', boxMm(dims.cavityMm)],
              ['Wall', mm(dims.wallMm)],
              ['Fit clearance', mm(fit.fit)],
              ['Board standoff', mm(dims.standoffMm)],
            ]} />
          </section>
        )}
        {apertures.length > 0 && (
          <section>
            <h3>Openings</h3>
            <ul className="st-openings">
              {apertures.map((a, i) => {
                const id = str(a.id) ?? String(i);
                const size = obj(a.sizeMm);
                const [w, h] = [num(size.width), num(size.height)];
                const count = num(a.count);
                const purpose = str(a.purpose);
                return (
                  <li key={id}>
                    <button type="button" aria-pressed={selected === id} onClick={() => { const next = selected === id ? null : id; setSelected(next); const owner = str(a.part); if (owner && owner !== 'enclosure') onPart(next ? owner : null); }} title={str(a.note) ?? undefined}>
                      <span className="st-opening-name">{(purpose && PURPOSES[purpose]) ?? purpose ?? id}</span>
                      <span className="st-opening-size">{w !== null && h !== null ? `${+w.toFixed(1)} × ${+h.toFixed(1)}` : ''}{count ? ` × ${count}` : ''}</span>
                      <span className="st-opening-where">{FACES[str(a.face) ?? ''] ?? str(a.face) ?? ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {loaded.state === 'ready' && (
          <section>
            <h3>Printing</h3>
            <Rows rows={[
              ['Filament, at most', grams !== null ? `${+grams.toFixed(1)} g${str(obj(data.material).name) ? ` ${str(obj(data.material).name)}` : ''}` : null],
              ['Screws', str(fastening.screw) ? `${screws !== null ? `${screws} × ` : ''}${str(fastening.screw)}` : null],
              ['Supports', str(print.supports)],
            ]} />
          </section>
        )}
        {(shell(validation.base) || shell(validation.lid)) && (
          <section>
            <h3>Checked in software</h3>
            <Rows rows={[
              ['Modeller', str(engine.name) ? `${str(engine.name)} ${str(engine.version) ?? ''}`.trim() : null],
              ['Base', shell(validation.base)],
              ['Lid', shell(validation.lid)],
            ]} />
            <p className="st-open-note">Calculated fit. Nothing has been printed or test-fitted.</p>
          </section>
        )}
        <section>
          <h3>Files</h3>
          {base && <FileRow name="enclosure-base.stl" label="Base STL" artifact={base} />}
          {lid && <FileRow name="enclosure-lid.stl" label="Lid STL" artifact={lid} />}
          {step && <FileRow name="enclosure.step" label="STEP for CAD" artifact={step} />}
        </section>
      </aside>
    </div>
  );
}
