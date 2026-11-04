import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { layoutFromCircuit } from '../src/board/edits.js';
import { verifyLayout, applyLayout } from '../eda/apply-layout.js';

const root = resolve('docs/engineering/2026-11-04-realism/review/evidence/copper/temp-monitor');
const cj = JSON.parse(readFileSync(resolve(root,'circuit.json'),'utf8'));
const meta = JSON.parse(readFileSync(resolve(root,'board-metadata.json'),'utf8'));
test('render verification checks actual pads, outline, layers and complete hole/component sets', () => {
  const expected = layoutFromCircuit(cj, meta); verifyLayout(cj,expected);
  for (const mutate of [
    (c: any[]) => { c.find(e => e.type === 'pcb_plated_hole').x += 1; },
    (c: any[]) => { c.find(e => e.type === 'pcb_board').outline = undefined; },
    (c: any[]) => { c.find(e => e.type === 'pcb_board').num_layers = 4; },
    (c: any[]) => { c.push({...c.find(e => e.type === 'pcb_hole'), x: 0, y: 0}); },
    (c: any[]) => { c.splice(c.findIndex(e => e.type === 'pcb_component'),1); },
  ]) { const mutant = structuredClone(cj); mutate(mutant); assert.throws(() => verifyLayout(mutant,expected)); }
});
test('source labels use the original manual placement as their transform anchor', () => {
  const layout = layoutFromCircuit(cj,meta);
  const make = (props: any) => ({ props, setProps(next: any) { this.props = next; } });
  const labels = layout.parts.map(p => make({ text:p.refdes, pcbX:p.origin.x+1, pcbY:p.origin.y+2 }));
  const board = { ...make({manualEdits:{pcb_placements:layout.parts.map(p=>({selector:p.refdes,center:p.origin}))}}), children:labels };
  const parts = new Map(layout.parts.map(p=>[p.refdes,{...make({pcbRotation:p.rotation}),parent:board}]));
  const circuit = {_getBoard:()=>board,selectOne:(s:string)=>parts.get(s.slice(1))};
  applyLayout(circuit as any,layout);
  labels.forEach((label,i)=>{assert.equal(label.props.pcbX,layout.parts[i]!.origin.x+1);assert.equal(label.props.pcbY,layout.parts[i]!.origin.y+2);});
});
