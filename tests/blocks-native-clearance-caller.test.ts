import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Test the actual private caller boundary without importing/running the build
// entrypoint or the separately reviewed native module-copy implementation.
const source = readFileSync(new URL('../eda/blocks/build.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('build.ts', source, ts.ScriptTarget.Latest, true);
let guard: ts.IfStatement | undefined, dependency: ts.IfStatement | undefined, loader: ts.VariableStatement | undefined;
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(tree) === 'nativeClearanceFloor') {
    assert.equal(guard, undefined); guard = node;
  }
  if (ts.isIfStatement(node) && node.expression.getText(tree) === 'nativeClearanceFloor && !nativeOwnerGuard') {
    assert.equal(dependency, undefined); dependency = node;
  }
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(tree) === 'ownerGuard')) {
    assert.equal(loader, undefined); loader = node;
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'chipRouter') {
    assert.ok(node.initializer && ts.isArrowFunction(node.initializer) && ts.isBlock(node.initializer.body));
    assert.ok(node.initializer.body.statements[0]?.getText(tree).startsWith('if (nativeClearanceFloor)'), 'actual-board validation precedes locking/planning/native construction');
  }
  ts.forEachChild(node, visit);
}
visit(tree); assert.ok(guard); assert.ok(dependency); assert.ok(loader);
const compiled = ts.transpileModule(`
export function check(nativeClearanceFloor:any,records:any[]){const c={getCircuitJson:()=>records};${guard.getText(tree)}}
export async function load(nativeClearanceFloor:any,nativeOwnerGuard:any,loadNativeOwnerGuard:any){const job='private-fixture';${dependency.getText(tree)}${loader.getText(tree)}return ownerGuard;}
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} as any }; new Function('exports', 'module', compiled)(module.exports, module);
const fixture = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/rp-signal-escape-fixture.json', import.meta.url), 'utf8'));
const actualBoard = fixture.circuit.find((record: any) => record.type === 'pcb_board');

test('clearance propagation requires one actual board with both exact explicit numeric fabrication rules', () => {
  const records = [structuredClone(actualBoard)], before = structuredClone(records);
  assert.doesNotThrow(() => module.exports.check(true, records)); assert.deepEqual(records, before);
  for (const bad of [[], [actualBoard, actualBoard], [{ ...actualBoard, type: 'source_board' }]]) assert.throws(() => module.exports.check(true, bad), /actual 0.127mm/);
  for (const field of ['min_trace_to_pad_edge_clearance', 'min_pad_edge_to_pad_edge_clearance']) {
    for (const value of [undefined, '.127', null, NaN, Infinity, .126999999, .127000001, .2]) {
      assert.throws(() => module.exports.check(true, [{ ...actualBoard, [field]: value }]), /actual 0.127mm/);
    }
  }
  assert.doesNotThrow(() => module.exports.check(false, []), 'default routing does not require this diagnostic-only assertion');
});

test('private owner-guard dependency and fixed floor option are preserved at the real loader call', async () => {
  for (const enabled of [false, true]) for (const owner of [false, true]) {
    const calls: any[] = [], load = async (job: string, options: any) => { calls.push({ job, options }); return { proof: 'fake constructor bundle' }; };
    if (enabled && !owner) {
      await assert.rejects(module.exports.load(enabled, owner, load), /requires the ownership guard/); assert.deepEqual(calls, []);
    } else {
      await module.exports.load(enabled, owner, load);
      assert.deepEqual(calls, owner ? [{ job: 'private-fixture', options: enabled ? { clearanceFloorMm: .127 } : {} }] : []);
    }
  }
});
