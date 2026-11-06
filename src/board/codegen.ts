import { moduleDef } from '../circuit/catalog.js';
import { contentId } from '../circuit/graph.js';
import type { CircuitDesign } from '../circuit/model.js';
import { checkDesign } from '../circuit/validate.js';
import { footprintFor } from './catalog-footprints.js';
import { clearSilkSpot, compactBoard, drawnBody, REFERENCE_ABOVE_MM, referenceText } from './compact.js';
import { previewModel } from './preview-model.js';

const q = JSON.stringify;
const r = (n: number) => Math.round(n * 1000) / 1000;
/** 3 mm fillet, sampled to <0.02 mm chord error; exact extents and mounting holes stay fixed. */
export function roundedBoardOutline(width: number, height: number, radius = 3) {
  return [[width/2-radius,height/2-radius,0],[-width/2+radius,height/2-radius,90],[-width/2+radius,-height/2+radius,180],[width/2-radius,-height/2+radius,270]].flatMap(([x,y,start]) =>
    Array.from({length:13},(_,i)=>{const a=(start!+i*90/12)*Math.PI/180;return {x:r(x!+radius*Math.cos(a)),y:r(y!+radius*Math.sin(a))};}));
}
export function boardMetadata(design: CircuitDesign) {
  const ordered = [...design.parts].sort((a, b) => a.id.localeCompare(b.id));
  const { widthMm, heightMm, at } = compactBoard(ordered, design.nets);
  const parts = ordered.map(p => {
    const m = moduleDef(p.module);
    const placed = at.get(p.id)!;
    return { id: p.id, module: p.module, ...(p.value ? { value: p.value } : {}), ...placed, widthMm: m.size.w, heightMm: m.size.h,
      pins: footprintFor(p.module).pins.map(pin => ({ id: pin.id, x: r(placed.x + pin.x), y: r(placed.y + pin.y) })) };
  });
  return { widthMm, heightMm, layers: 2, dimensionsVerified: false, cornerRadiusMm: 3, outline: roundedBoardOutline(widthMm, heightMm),
    mountingHoles: [-1, 1].flatMap(x => [-1, 1].map(y => ({ x: x * (widthMm / 2 - 4), y: y * (heightMm / 2 - 4), diameterMm: 3.2 }))), parts };
}

/** Pure codegen: imports resolve against the isolated EDA runtime, never the web server. */
export function generateBoardSource(design: CircuitDesign): string {
  const issues = checkDesign(design);
  if (issues.length) throw new Error(`Invalid design: ${issues.map(i => i.message).join('; ')}`);
  const metadata = boardMetadata(design);
  const parts = [...design.parts].sort((a, b) => a.id.localeCompare(b.id));
  const peripheralIds = parts.filter(p => moduleDef(p.module).category !== 'controller').map(p => p.id);
  if (parts.filter(p => moduleDef(p.module).category === 'controller').length !== 1) throw new Error('A carrier design requires exactly one controller');
  for (const p of parts) if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(p.id)) throw new Error('Part identifiers must be alphanumeric reference designators');
  const lines = ['// Generated module carrier: verify actual module dimensions before fabrication.', '// @jsxRuntime automatic', '// @jsxImportSource react', `export const boardMetadata = ${q(metadata)};`, 'export default function Board() {',
    `  return <board width={${metadata.widthMm}} height={${metadata.heightMm}} layers={2} outline={${q(metadata.outline)}} schAutoLayoutEnabled minTraceWidth={0.25} minTraceToPadEdgeClearance={0.2} minPadEdgeToPadEdgeClearance={0.2} minViaEdgeToPadEdgeClearance={0.2} minViaHoleDiameter={0.3} minViaPadDiameter={0.6} pcbStyle={{viaHoleDiameter: 0.3, viaPadDiameter: 0.6}} autorouter={{preset: "auto", traceClearance: 0.2}}>`];
  for (const p of parts) {
    const m = moduleDef(p.module); const f = footprintFor(p.module); const at = metadata.parts.find(a => a.id === p.id)!;
    lines.push(`    <chip name={${q(p.id)}} manufacturerPartNumber={${q(`${m.name}${p.value ? ` ${p.value}` : ''} (${f.kind})`)}} pinLabels={${q(Object.fromEntries(Object.entries(f.pinLabels).map(([k,v]) => [k,v === '+' ? 'PLUS' : v === '-' ? 'MINUS' : v])))}} cadModel={${q(previewModel(p.module, p.value))}} pcbX={${at.x}} pcbY={${at.y}} schX={${m.category === 'controller' ? -3.5 : 3.5}} schY={${m.category === 'controller' ? 0 : (peripheralIds.length - 1) * 1.5 - peripheralIds.indexOf(p.id) * 3}} footprint={<footprint>`);
    for (const pin of f.pins) lines.push(`      <platedhole portHints={[${q(`pin${pin.number}`)}]} pcbX={${pin.x}} pcbY={${pin.y}} holeDiameter={${pin.holeDiameter}} outerDiameter={${pin.outerDiameter}} shape="circle" />`);
    for (const pin of f.pins) {
      const def = m.pins[pin.number - 1]!;
      const vertical = def.physical.dir === 'left' || def.physical.dir === 'right';
      const inward = def.physical.dir === 'left' ? 1 : -1;
      const label = pin.id.startsWith('GND') ? 'GND' : pin.id === 'A' ? 'A +' : pin.id === 'K' ? 'K -' : pin.id === '-' ? '-' : pin.id;
      const fontSize = m.drawing === 'to92' ? 0.5 : 0.65;
      // Keep labels inside socket rows; bottom lead labels go below the pads.
      const x = vertical ? pin.x + inward * (1.4 + label.length * fontSize * 0.3) : pin.x;
      const y = vertical ? pin.y : pin.y + (def.physical.dir === 'up' ? -1.7 : -1.6);
      lines.push(`      <silkscreentext text={${q(label)}} pcbX={${r(x)}} pcbY={${r(y)}} fontSize={${fontSize}} />`);
      if (['VCC', 'VIN', 'VDD', '3V3', '5V'].includes(pin.id)) {
        const plusY = vertical ? pin.y : pin.y + (def.physical.dir === 'up' ? -3 : -2.7);
        lines.push(`      <silkscreentext text="+" pcbX={${vertical ? r(pin.x - inward * 1.65) : pin.x}} pcbY={${r(plusY)}} fontSize={0.7} />`);
      }
      if (pin.id === 'K' || pin.id === '-') lines.push(`      <silkscreenpath route={${q([{ x: r(pin.x - 0.85), y: r(pin.y + 1.2) }, { x: r(pin.x + 0.85), y: r(pin.y + 1.2) }])}} strokeWidth={0.3} />`);
    }
    if (m.drawing === 'to92') {
      // Flat face is toward the lead row (negative PCB Y); a D-shaped body mark.
      lines.push(`      <silkscreenpath route={${q([{x:-2.2,y:3.5},{x:-2.2,y:5.1},{x:-1.2,y:6},{x:1.2,y:6},{x:2.2,y:5.1},{x:2.2,y:3.5},{x:-2.2,y:3.5}])}} strokeWidth={0.25} />`, '      <silkscreentext text="FLAT" pcbX={0} pcbY={2.4} fontSize={0.6} />');
    }
    const body = drawnBody(p.module);
    lines.push(`      <silkscreenrect pcbX={${r(body.x)}} pcbY={${r(body.y)}} width={${r(body.w - 0.8)}} height={${r(body.h - 0.8)}} strokeWidth={0.15} />`, '    </footprint>} />');
    lines.push(`    <silkscreentext text={${q(referenceText(p))}} pcbX={${r(at.x + body.x)}} pcbY={${r(at.y + body.y + body.h / 2 + REFERENCE_ABOVE_MM)}} fontSize={0.8} />`);
  }
  const usedNetNames = new Set<string>();
  const groundNames: string[] = [];
  for (const [i, net] of [...design.nets].sort((a, b) => a.id.localeCompare(b.id)).entries()) {
    const sanitized = net.name.replace(/\+/g, 'PLUS_').replace(/[^A-Za-z0-9_]/g, '_');
    let name = (/^[0-9]/.test(sanitized) ? `N_${sanitized}` : sanitized) || `N${i}`;
    let suffix = 0;
    while (usedNetNames.has(name)) name = `${sanitized}_N${i}_${suffix++}`;
    usedNetNames.add(name);
    if (net.kind === 'ground') groundNames.push(name);
    lines.push(`    <net name={${q(name)}} />`);
    for (const end of [...net.endpoints].sort((a, b) => a.part.localeCompare(b.part) || a.pin.localeCompare(b.pin))) {
      const part = parts.find(p => p.id === end.part)!;
      const pin = footprintFor(part.module).pins.find(p => p.id === end.pin)!;
      lines.push(`    <trace from={${q(`.${end.part} > .pin${pin.number}`)}} to={${q(`net.${name}`)}} thickness={${net.kind === 'power' || net.kind === 'ground' ? 0.4 : 0.25}} />`);
    }
  }
  for (const name of groundNames) for (const layer of ['top','bottom']) lines.push(`    <copperpour name={${q(`GND_${layer}`)}} layer={${q(layer)}} connectsTo={${q(`net.${name}`)}} clearance={0.25} boardEdgeMargin={0.35} useThermalReliefs coveredWithSolderMask />`);
  for (const h of metadata.mountingHoles) lines.push(`    <hole pcbX={${h.x}} pcbY={${h.y}} diameter={3.2} />`);
  // The board's identity goes wherever a clear strip is left. On a board packed full, that's under the controller, between its sockets.
  const identity = `CARRIER ${contentId(design)}`;
  const controller = metadata.parts.find(p => moduleDef(p.module).category === 'controller')!;
  const identityAt = clearSilkSpot(metadata, identity.length * 0.7, 1.2) ?? { x: controller.x, y: controller.y };
  lines.push(`    <silkscreentext text={${q(identity)}} pcbX={${identityAt.x}} pcbY={${identityAt.y}} fontSize={1} />`, '  </board>;', '}', '');
  return lines.join('\n');
}
export const codegen = generateBoardSource;
