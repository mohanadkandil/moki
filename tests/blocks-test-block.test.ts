import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectBlockPadGeometry, testBlock, type NativeImportMap } from '../src/blocks/test-block.js';
import { catalogPart, checkPlan, contentHash, resolvePlanBlocks } from '../src/blocks/library.js';
import { planGraph } from '../src/blocks/graph.js';
import { schematicHash } from '../src/blocks/review.js';
import type { BlockDef, BlockDraft, BoardPlan } from '../src/blocks/contract.js';
const read = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
async function context() {
  const draft = await read<BlockDraft>('../src/blocks/data/sht40-draft.json');
  const plan = await read<BoardPlan>('../src/blocks/data/spike-plan.json');
  plan.drafts = [...(plan.drafts ?? []), structuredClone(draft)];
  plan.blocks.push({
    inst: 'ambient',
    block: draft.id,
    version: draft.version,
    params: {},
    at: { x: 20, y: -5 },
  });
  plan.links.push(
    { from: 'ambient.V3V3', to: 'ldo-ap2112-3v3.V3V3' },
    { from: 'ambient.GND', to: 'esp32-s3-core.GND' },
    { from: 'ambient.I2C', to: 'i2c-header.I2C' },
  );
  plan.sections?.push({
    id: 'ambient',
    title: 'Ambient',
    purpose: 'Test context',
    insts: ['ambient'],
    notes: ['Real imported SHT40, no physical proof'],
    reference: {
      lcsc: 'C2909890',
      datasheetUrl: draft.parts[0]!.datasheet.url,
      page: 17,
      quote: 'No central copper',
    },
  });
  return { draft, plan };
}
async function isolated(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'moki-test-block-')),
    previous = process.env.MOKI_SCHEMATIC_REVIEWS_DIR;
  process.env.MOKI_SCHEMATIC_REVIEWS_DIR = join(directory, 'absent-reviews');
  t.after(async () => {
    if (previous === undefined) delete process.env.MOKI_SCHEMATIC_REVIEWS_DIR;
    else process.env.MOKI_SCHEMATIC_REVIEWS_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('real catalog-backed SHT context requires current review before any SPICE/native execution', async (t) => {
  const outputDir = await isolated(t),
    { draft, plan } = await context();
  assert.ok(
    checkPlan(plan).every((g) => g.ok),
    JSON.stringify(checkPlan(plan)),
  );
  const receipt = await testBlock(draft, { plan, outputDir });
  assert.equal(receipt.contentHash, contentHash(draft));
  assert.ok(receipt.gates.find((g) => g.gate === 'erc')!.ok);
  assert.ok(receipt.gates.find((g) => g.gate === 'power')!.ok);
  assert.equal(receipt.gates.find((g) => g.gate === 'review')!.ok, false);
  assert.equal(receipt.gates.find((g) => g.gate === 'spice')!.ok, false);
  assert.equal(receipt.gates.find((g) => g.gate === 'drc')!.ok, false);
  assert.match(
    receipt.gates.find((g) => g.gate === 'block-test')!.issues[0]!.message,
    /independent schematic review/,
  );
  assert.ok(receipt.artifacts['block-test.json']);
  assert.equal(receipt.artifacts['native.log'], undefined);
  assert.equal(receipt.artifacts['circuit.json'], undefined);
  const saved = JSON.parse(await readFile(receipt.artifacts['block-test.json']!, 'utf8'));
  assert.equal(saved.contentHash, receipt.contentHash);
  const children = await readdir(outputDir);
  assert.equal(children.length, 1);
  assert.deepEqual((await readdir(join(outputDir, children[0]!))).sort(), [
    'block-test.json',
    'draft.json',
    'plan.json',
  ]);
  const second = await testBlock(draft, { plan, outputDir });
  assert.notEqual(second.artifacts['block-test.json'], receipt.artifacts['block-test.json']);
});

test('missing, stale or electrically incomplete context cannot run a native block test', async (t) => {
  const outputDir = await isolated(t);
  for (const mutate of [
    (p: BoardPlan) => {
      p.blocks = p.blocks.filter((i) => i.inst !== 'ambient');
    },
    (p: BoardPlan) => {
      p.drafts![0]!.summary += ' changed';
    },
    (p: BoardPlan) => {
      p.links = p.links.filter((l) => l.from !== 'ambient.V3V3');
    },
    (p: BoardPlan) => {
      p.links = p.links.filter((l) => l.from !== 'ambient.I2C');
    },
  ]) {
    const { draft, plan } = await context();
    mutate(plan);
    const receipt = await testBlock(draft, { plan, outputDir });
    assert.equal(receipt.gates.find((g) => g.gate === 'block-test')!.ok, false);
    assert.equal(receipt.gates.find((g) => g.gate === 'drc')!.ok, false);
    assert.equal(receipt.artifacts['native.log'], undefined);
  }
});

test('authored review flags and invalid catalog identities fail, and MCU compile cannot disappear', async (t) => {
  const outputDir = await isolated(t),
    original = await context();
  for (const mutate of [
    (d: any) => {
      d.status = 'reviewed';
    },
    (d: BlockDraft) => {
      d.parts[0]!.catalogReceipt = `sha256:${'0'.repeat(64)}`;
    },
  ]) {
    const { draft, plan } = await context();
    mutate(draft);
    const result = await testBlock(draft, { plan, outputDir });
    assert.ok(result.gates.some((g) => !g.ok));
    assert.equal(result.artifacts['native.log'], undefined);
  }
  const defs = await read<BlockDef[]>('../src/blocks/data/seed.json'),
    core = defs.find((b) => b.mcu)!;
  const { contentHash: _hash, status: _status, provenance, ...fields } = structuredClone(core);
  const mcu: BlockDraft = {
    ...fields,
    provenance: {
      author: provenance.author,
      ...(provenance.authorId ? { authorId: provenance.authorId } : {}),
    },
  };
  const result = await testBlock(mcu, {
    plan: await read<BoardPlan>('../src/blocks/data/spike-plan.json'),
    outputDir,
  });
  assert.equal(result.gates.filter((g) => g.gate === 'compile').length, 1);
  assert.equal(result.gates.find((g) => g.gate === 'compile')!.ok, false);
  assert.ok(
    result.gates.find((g) => g.gate === 'compile')!.issues.some((i) => i.rule === 'block-test-application'),
  );
  assert.equal(result.artifacts['native.log'], undefined);
  assert.equal(original.draft.provenance.author, 'agent');
});

test('output paths reject traversal/symlink/foreign roots and unsupported worker injection', async (t) => {
  const outputDir = await isolated(t),
    { draft, plan } = await context();
  await mkdir(join(outputDir, 'real'));
  await symlink(join(outputDir, 'real'), join(outputDir, 'link'));
  for (const path of [
    join(outputDir, 'link', 'child'),
    `${outputDir}/../escape`,
    '/etc/moki-block-test',
    'bad\0path',
  ]) {
    const result = await testBlock(draft, { plan, outputDir: path });
    assert.equal(result.gates.find((g) => g.gate === 'block-test')!.ok, false);
    assert.deepEqual(result.artifacts, {});
    assert.equal(result.contentHash, contentHash(draft));
  }
  for (const options of [
    { plan, outputDir, timeoutMs: 0 },
    { plan, outputDir, timeoutMs: NaN },
    { plan, outputDir, worker: () => ({ code: 0 }) },
  ]) {
    const result = await testBlock(draft, options as any);
    assert.deepEqual(result.artifacts, {});
    assert.ok(result.gates.some((g) => !g.ok));
  }
  assert.deepEqual((await readdir(outputDir)).sort(), ['link', 'real']);
});

async function shapeFixture() {
  const { draft, plan } = await context(),
    blocks = resolvePlanBlocks(plan),
    parts = planGraph(plan, blocks).parts.filter((p) => p.inst === 'ambient');
  const circuit: any[] = [],
    imports: NativeImportMap = {
      schema: 'moki.import-map/1',
      inputHash: schematicHash(plan, blocks),
      parts: [],
    };
  // SYNTHETIC shape fixture verifies inspection logic only; it is not a native DRC result.
  for (const p of parts) {
    const c = catalogPart(p.part.lcsc, p.part.catalogReceipt),
      sid = `source-${p.ref}`,
      pid = `pcb-${p.ref}`;
    const pins = Object.fromEntries(c.pins.map((pin) => [pin.pad, `pin${pin.pad}`]));
    imports.parts.push({
      ref: p.ref,
      inst: p.inst,
      localRef: p.localRef,
      blockContentHash: contentHash(draft),
      lcsc: c.lcsc,
      catalogReceipt: c.catalogReceipt,
      footprintSha256: c.footprintSha256,
      pins,
      omitPads: p.part.omitPads ?? [],
    });
    circuit.push(
      { type: 'source_component', name: p.ref, source_component_id: sid },
      { type: 'pcb_component', source_component_id: sid, pcb_component_id: pid },
    );
    for (const pad of c.pins) {
      const source_port_id = `${sid}-${pad.pad}`,
        pcb_port_id = `${pid}-${pad.pad}`;
      circuit.push(
        { type: 'source_port', source_component_id: sid, source_port_id, name: pins[pad.pad] },
        { type: 'pcb_port', pcb_component_id: pid, source_port_id, pcb_port_id },
      );
      if (p.part.omitPads?.includes(pad.pad)) continue;
      circuit.push({
        type: 'pcb_smtpad',
        pcb_component_id: pid,
        pcb_port_id,
        port_hints: [pins[pad.pad]],
        layer: 'top',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5,
      });
    }
  }
  return { draft, plan, blocks, circuit, imports };
}

test('pad gate requires actual PCB shapes and correct source/PCB/import correspondence, including omitted EP absence', async () => {
  const good = await shapeFixture();
  assert.equal(
    inspectBlockPadGeometry(good.draft, good.plan, good.blocks, good.circuit, good.imports).ok,
    true,
  );
  for (const mutate of [
    (f: Awaited<ReturnType<typeof shapeFixture>>) => {
      f.circuit = f.circuit.filter((c) => c.type !== 'pcb_smtpad');
    },
    (f: Awaited<ReturnType<typeof shapeFixture>>) => {
      f.circuit.find((c) => c.type === 'pcb_smtpad')!.width = 0;
    },
    (f: Awaited<ReturnType<typeof shapeFixture>>) => {
      f.circuit.find((c) => c.type === 'pcb_smtpad')!.port_hints = ['wrong'];
    },
    (f: Awaited<ReturnType<typeof shapeFixture>>) => {
      f.imports.inputHash = '0'.repeat(64);
    },
    (f: Awaited<ReturnType<typeof shapeFixture>>) => {
      f.imports.parts[0]!.blockContentHash = '0'.repeat(64);
    },
    (f: Awaited<ReturnType<typeof shapeFixture>>) => {
      f.imports.parts[0]!.footprintSha256 = '0'.repeat(64);
    },
    (f: Awaited<ReturnType<typeof shapeFixture>>) => {
      f.imports.parts[0]!.pins['1'] = 'pin2';
    },
    (f: Awaited<ReturnType<typeof shapeFixture>>) => {
      const port = f.circuit.find((c) => c.type === 'pcb_port' && c.pcb_port_id.endsWith('-5'))!;
      f.circuit.push({
        type: 'pcb_smtpad',
        pcb_component_id: port.pcb_component_id,
        pcb_port_id: port.pcb_port_id,
        port_hints: ['pin5'],
        shape: 'rect',
        layer: 'top',
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5,
      });
    },
    (f: Awaited<ReturnType<typeof shapeFixture>>) => {
      f.circuit.push({
        ...f.circuit.find((c) => c.type === 'pcb_smtpad'),
        pcb_port_id: 'unmapped',
        port_hints: ['unmapped'],
      });
    },
  ]) {
    const f = await shapeFixture();
    mutate(f);
    const gate = inspectBlockPadGeometry(f.draft, f.plan, f.blocks, f.circuit, f.imports);
    assert.equal(gate.ok, false, JSON.stringify(gate));
  }
});

test('actual imported source aliases such as SDA retain their canonical physical pin correspondence', async () => {
  const evidence = '../docs/engineering/2026-11-05-chip-level/evidence/chip_eda/sht40-board/';
  const plan = await read<BoardPlan>(evidence + 'plan.json'),
    draft = await read<BlockDraft>('../src/blocks/data/sht40-draft.json'),
    blocks = resolvePlanBlocks(plan);
  const circuit = await read<any[]>(evidence + 'circuit.json'),
    imports = await read<NativeImportMap>(evidence + 'import-map.json');
  assert.equal(inspectBlockPadGeometry(draft, plan, blocks, circuit, imports).ok, true);
  const sid = circuit.find(
    (c) => c.type === 'source_component' && c.name === imports.parts.find((p) => p.lcsc === 'C2909890')!.ref,
  )!.source_component_id;
  const alias = circuit.find(
    (c) => c.type === 'source_port' && c.source_component_id === sid && c.name === 'SDA',
  );
  assert.ok(alias);
  assert.equal(alias.pin_number, 1);
  assert.ok(alias.port_hints.includes('pin1'));
  alias.pin_number = 2;
  assert.equal(inspectBlockPadGeometry(draft, plan, blocks, circuit, imports).ok, false);
});

test('actual microphone four-shape physical ground pad is covered, and alias/shape corruption fails', async () => {
  const base = '../docs/engineering/2026-11-05-chip-level/evidence/chip_eda/full-template/';
  const plan = await read<BoardPlan>(base + 'native-port-plan.json'),
    blocks = resolvePlanBlocks(plan),
    mic = plan.drafts!.find((b) => b.id === 'i2s-mic-ics43434')!;
  const fixture = await read<{ circuit: any[] }>(base + 'native-port-fixture.json'),
    imports = await read<NativeImportMap>(base + 'native-port-import-map.json');
  assert.equal(inspectBlockPadGeometry(mic, plan, blocks, fixture.circuit, imports).ok, true);
  for (const kind of ['wrong-alias', 'rogue-shape', 'missing-internal-record']) {
    const c = structuredClone(fixture.circuit),
      a = c.find((p) => p.type === 'source_port' && p.name === 'pin3_internal_1');
    if (kind === 'wrong-alias') a.port_hints = ['pin4', '4'];
    if (kind === 'missing-internal-record')
      c.splice(
        c.findIndex(
          (p) =>
            p.type === 'source_component_internal_connection' &&
            p.source_component_id === a.source_component_id,
        ),
        1,
      );
    if (kind === 'rogue-shape') {
      const source = c.find(
          (p) => p.type === 'source_component' && p.source_component_id === a.source_component_id,
        ),
        pcb = c.find(
          (p) => p.type === 'pcb_component' && p.source_component_id === source.source_component_id,
        );
      c.push({
        ...c.find((p) => p.type === 'pcb_smtpad' && p.pcb_component_id === pcb.pcb_component_id),
        pcb_port_id: 'unmapped-shape',
        port_hints: ['pin3'],
      });
    }
    assert.equal(inspectBlockPadGeometry(mic, plan, blocks, c, imports).ok, false, kind);
  }
});

test('native footprint-derived ports associate every repeated ESP32-S3 EP land', async () => {
  const base = '../docs/engineering/2026-11-05-chip-level/evidence/chip_eda/full-template/';
  const plan = await read<BoardPlan>(base + 'native-port-plan.json'),
    blocks = resolvePlanBlocks(plan),
    draft = plan.drafts!.find((d) => d.id === 'esp32-s3-audio-core')!;
  const { circuit } = await read<{ circuit: any[] }>(base + 'associated-port-fixture.json'),
    imports = await read<NativeImportMap>(base + 'associated-port-import-map.json');
  assert.equal(inspectBlockPadGeometry(draft, plan, blocks, circuit, imports).ok, true);
  const eps = circuit.filter((p) => p.type === 'pcb_smtpad' && p.port_hints?.includes('pin41'));
  assert.equal(eps.length, 9);
  assert.ok(eps.every((p) => p.pcb_port_id));
  for (const pad of eps) pad.pcb_port_id = null;
  assert.equal(inspectBlockPadGeometry(draft, plan, blocks, circuit, imports).ok, false);
});
