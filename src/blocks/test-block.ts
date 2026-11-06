import { mkdir, mkdtemp, lstat, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { BlockDef, BlockDraft, BlockTestReceipt, BoardPlan, GateResult } from './contract.js';
import {
  catalogPart,
  checkBlockDraft,
  checkPlan,
  contentHash,
  materializeDraft,
  resolvePlanBlocks,
} from './library.js';
import { planGraph } from './graph.js';
import { nativeComponentPorts } from './native-ports.js';
import { checkSchematicReview, schematicHash } from './review.js';
import { runSpiceChecks } from './spice.js';
import { runWorker } from '../board/process.js';

export interface TestBlockOptions {
  plan: BoardPlan;
  outputDir?: string;
  timeoutMs?: number;
}
export interface NativeImportMap {
  schema: 'moki.import-map/1';
  inputHash: string;
  parts: Array<{
    ref: string;
    inst: string;
    localRef: string;
    blockContentHash: string;
    lcsc: string;
    catalogReceipt: string;
    footprintSha256: string;
    pins: Record<string, string>;
    omitPads: string[];
  }>;
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const object = (v: unknown): v is Record<string, any> =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const failure = (gate: GateResult['gate'], rule: string, message: string): GateResult => ({
  gate,
  ok: false,
  issues: [{ rule, severity: 'error', message }],
});
const sorted = (s: string[]) => [...s].sort().join('\0');
async function outputRoot(supplied?: string): Promise<string> {
  if (
    supplied !== undefined &&
    (typeof supplied !== 'string' ||
      !supplied.trim() ||
      supplied.includes('\0') ||
      supplied.split(/[\\/]/).includes('..'))
  )
    throw new Error('Unsafe block-test output path');
  const path = resolve(supplied ?? join(root, 'var/block-tests'));
  const within = (base: string) => {
    const rel = relative(resolve(base), path);
    return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  };
  if (!within(root) && !within(tmpdir()))
    throw new Error('Block-test output must be inside the workspace or OS temporary directory');
  let cursor = path;
  for (;;) {
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error('Block-test output cannot traverse a symbolic link');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  await mkdir(path, { recursive: true });
  return path;
}
async function readJson(path: string, maxBytes = 2 * 1024 * 1024): Promise<any> {
  if ((await stat(path)).size > maxBytes) throw new Error(`Oversized native artifact ${path}`);
  return JSON.parse(await readFile(path, 'utf8'));
}
function validPad(p: any): boolean {
  if (p.ccw_rotation !== undefined && !finite(p.ccw_rotation)) return false;
  if (p.type === 'pcb_smtpad' && !['top', 'bottom'].includes(p.layer)) return false;
  if (p.shape === 'polygon' && p.type === 'pcb_smtpad') {
    if (
      !Array.isArray(p.points) ||
      p.points.length < 3 ||
      p.points.some((q: any) => !finite(q.x) || !finite(q.y))
    )
      return false;
    const area = p.points.reduce((sum: number, a: any, i: number) => {
      const b = p.points[(i + 1) % p.points.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0);
    return Math.abs(area) > 1e-9;
  }
  if (!finite(p.x) || !finite(p.y)) return false;
  if (p.type === 'pcb_smtpad') {
    if (!['top', 'bottom'].includes(p.layer)) return false;
    if (p.shape === 'circle') return finite(p.radius) && p.radius > 0;
    // Native SMT placement emits rotated_pill when a valid pill land rotates.
    // Its dimensions stay in the local pad frame; the finite angle is required.
    if (['rotated_rect', 'rotated_pill'].includes(p.shape) && !finite(p.ccw_rotation)) return false;
    return (
      ['rect', 'rotated_rect', 'pill', 'rotated_pill'].includes(p.shape) &&
      finite(p.width) &&
      p.width > 0 &&
      finite(p.height) &&
      p.height > 0
    );
  }
  if (!Array.isArray(p.layers) || !p.layers.includes('top') || !p.layers.includes('bottom')) return false;
  if (p.shape === 'circle')
    return (
      finite(p.outer_diameter) &&
      finite(p.hole_diameter) &&
      p.hole_diameter > 0 &&
      p.outer_diameter > p.hole_diameter
    );
  return (
    p.shape === 'pill' &&
    finite(p.outer_width) &&
    finite(p.outer_height) &&
    finite(p.hole_width) &&
    finite(p.hole_height) &&
    p.hole_width > 0 &&
    p.hole_height > 0 &&
    p.outer_width > p.hole_width &&
    p.outer_height > p.hole_height
  );
}
/** Pure inspection of actual native PCB shapes; declaration-only pin lists cannot pass. */
export function inspectBlockPadGeometry(
  draft: BlockDraft,
  plan: BoardPlan,
  blocks: BlockDef[],
  circuit: unknown,
  imports: NativeImportMap,
): GateResult {
  const gate: GateResult = { gate: 'block-test', ok: false, issues: [], measurements: [] };
  try {
    if (
      !Array.isArray(circuit) ||
      !object(imports) ||
      imports.schema !== 'moki.import-map/1' ||
      !Array.isArray(imports.parts)
    )
      throw new Error('Native circuit/import-map evidence is missing');
    if (imports.inputHash !== schematicHash(plan, blocks))
      throw new Error('Native import map belongs to a different electrical plan');
    const hash = contentHash(draft),
      instances = new Set(
        plan.blocks.filter((i) => i.block === draft.id && i.version === draft.version).map((i) => i.inst),
      );
    const expected = planGraph(plan, blocks).parts.filter(
      (p) => instances.has(p.inst) && p.block.contentHash === hash,
    );
    if (!expected.length || expected.length !== instances.size * draft.parts.length)
      throw new Error('Native pad inspection has no identical draft instances');
    for (const placed of expected) {
      const p = placed.part,
        records = imports.parts.filter(
          (m) => m.ref === placed.ref && m.inst === placed.inst && m.localRef === placed.localRef,
        );
      if (records.length !== 1) throw new Error(`Missing/duplicate native import identity ${placed.ref}`);
      const imported = records[0]!;
      const catalog = catalogPart(p.lcsc, p.catalogReceipt);
      if (
        imported.blockContentHash !== hash ||
        imported.lcsc !== p.lcsc ||
        imported.catalogReceipt !== p.catalogReceipt ||
        imported.footprintSha256 !== catalog.footprintSha256 ||
        !object(imported.pins) ||
        !Array.isArray(imported.omitPads) ||
        sorted(imported.omitPads) !== sorted(p.omitPads ?? [])
      )
        throw new Error(`Native imported part identity differs for ${placed.ref}`);
      const declared = Object.values(p.pins).map((pin) => pin.pad),
        omitted = p.omitPads ?? [],
        all = [...declared, ...omitted];
      if (
        new Set(all).size !== all.length ||
        sorted(Object.keys(imported.pins)) !== sorted(all) ||
        Object.values(imported.pins).some((v) => typeof v !== 'string' || !v)
      )
        throw new Error(`Actual import pad coverage differs for ${placed.ref}`);
      const sources = circuit.filter((c) => c.type === 'source_component' && c.name === placed.ref);
      if (sources.length !== 1) throw new Error(`Missing native source component ${placed.ref}`);
      const components = circuit.filter(
        (c) => c.type === 'pcb_component' && c.source_component_id === sources[0].source_component_id,
      );
      if (components.length !== 1) throw new Error(`Missing native PCB component ${placed.ref}`);
      const component = components[0],
        pads = circuit.filter(
          (c) =>
            ['pcb_smtpad', 'pcb_plated_hole'].includes(c.type) &&
            c.pcb_component_id === component.pcb_component_id,
        );
      if (!pads.length || pads.some((p) => !validPad(p)))
        throw new Error(`Missing/degenerate/unsupported physical pad shape ${placed.ref}`);
      const resolved = nativeComponentPorts(
        circuit,
        sources[0],
        all.map((p) => imported.pins[p]!),
        new Set(omitted.map((p) => imported.pins[p]!)),
      );
      const matched = new Set<any>();
      for (const physical of all) {
        const native = imported.pins[physical]!;
        const ports = resolved.byNative.get(native)!;
        const pcbPorts = new Set(
          circuit
            .filter(
              (c) =>
                c.type === 'pcb_port' &&
                c.pcb_component_id === component.pcb_component_id &&
                ports.some((p) => p.source_port_id === c.source_port_id),
            )
            .map((c) => c.pcb_port_id),
        );
        const actual = pads.filter((c) =>
          omitted.includes(physical)
            ? pcbPorts.has(c.pcb_port_id) || (Array.isArray(c.port_hints) && c.port_hints.includes(native))
            : pcbPorts.has(c.pcb_port_id) && Array.isArray(c.port_hints) && c.port_hints.includes(native),
        );
        if (omitted.includes(physical)) {
          if (actual.length)
            throw new Error(`Omitted physical pad ${placed.ref}.${physical} remains in PCB geometry`);
        } else {
          if (!ports.length || !actual.length)
            throw new Error(`Declared physical pad ${placed.ref}.${physical} has no native PCB geometry`);
          for (const shape of actual) {
            if (matched.has(shape))
              throw new Error(`One PCB pad aliases multiple physical pins on ${placed.ref}`);
            matched.add(shape);
          }
        }
      }
      if (matched.size !== pads.length)
        throw new Error(`Unmapped native copper pad remains on ${placed.ref}`);
      gate.measurements!.push({
        where: `${placed.inst}.${placed.localRef}`,
        name: 'native-physical-pads',
        measured: declared.length,
        target: declared.length,
        tolerance: 0,
        unit: 'pads',
        ok: true,
      });
    }
    gate.ok = true;
    gate.issues.push({
      rule: 'block-pad-scope',
      severity: 'warning',
      message:
        'Actual physical pad presence/omission and native import correspondence checked; independent circuit review and DRC remain separate gates',
    });
  } catch (error) {
    gate.issues.push({ rule: 'block-pad-geometry', severity: 'error', message: errorText(error) });
  }
  return gate;
}

/** A real qualified context is mandatory: this function never fabricates power, bus pullups or a review. */
export async function testBlock(draft: BlockDraft, options: TestBlockOptions): Promise<BlockTestReceipt> {
  const start = performance.now();
  let hash = '',
    job: string | undefined;
  const receipt: BlockTestReceipt = {
    contentHash: hash,
    at: new Date().toISOString(),
    gates: [],
    artifacts: {},
    ms: 0,
  };
  const required: GateResult['gate'][] = [
    'erc',
    'power',
    'spice',
    'review',
    'drc',
    'block-test',
    ...(draft?.mcu ? ['compile' as const] : []),
  ];
  const set = (g: GateResult) => {
    const index = receipt.gates.findIndex((r) => r.gate === g.gate);
    if (index >= 0) receipt.gates[index] = g;
    else receipt.gates.push(g);
  };
  for (const gate of required)
    set(failure(gate, 'block-test-not-run', 'Not run: block test prerequisites are incomplete'));
  const save = async (name: string, data: unknown) => {
    if (!job) return;
    const path = join(job, name);
    await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
    receipt.artifacts[name] = path;
  };
  try {
    const draftBytes = JSON.stringify(draft);
    if (!draftBytes || draftBytes.length > 1024 * 1024) throw new Error('Draft is missing/oversized');
    hash = contentHash(draft);
    receipt.contentHash = hash;
    if (!object(options) || Object.keys(options).some((k) => !['plan', 'outputDir', 'timeoutMs'].includes(k)))
      throw new Error('testBlock requires a context plan and fixed execution options');
    const timeout = options.timeoutMs ?? 240_000;
    if (!finite(timeout) || timeout < 1000 || timeout > 600_000)
      throw new Error('Block test timeout must be between 1000 and 600000 ms');
    const directory = await outputRoot(options.outputDir);
    job = await mkdtemp(join(directory, 'run-'));
    const planBytes = JSON.stringify(options.plan);
    if (!planBytes || planBytes.length > 8 * 1024 * 1024)
      throw new Error('Qualified context is missing/oversized');
    const local = checkBlockDraft(draft);
    if (local.some((g) => !g.ok)) {
      for (const g of local) if (!g.ok) set(g);
      throw new Error('Catalog-backed local draft validation failed');
    }
    const block = materializeDraft(draft),
      plan = structuredClone(options.plan),
      blocks = resolvePlanBlocks(plan);
    const matching = blocks.find((b) => b.id === block.id && b.version === block.version);
    if (
      !plan.blocks.some((i) => i.block === block.id && i.version === block.version) ||
      !matching ||
      matching.contentHash !== hash
    )
      throw new Error('Context must contain an instance resolving to the identical draft content hash');
    const context = checkPlan(plan, blocks);
    for (const g of context) set(g);
    if (context.some((g) => !g.ok || g.issues.some((i) => i.severity === 'error')))
      throw new Error('Qualified context ERC/power validation failed');
    // Preserve the exact reviewed context. New revisions are supplied as inline drafts;
    // cached revisions remain bound by both native input and block content hashes.
    await save('plan.json', plan);
    await save('draft.json', draft);
    const missingApplication = Boolean(
      draft.mcu && (typeof plan.app?.source !== 'string' || !plan.app.source.trim()),
    );
    if (missingApplication)
      set(
        failure(
          'compile',
          'block-test-application',
          'An MCU draft needs a context application source for sandboxed compilation',
        ),
      );
    const review = checkSchematicReview(plan, blocks);
    set(review);
    if (!review.ok) throw new Error('Current independent schematic review is required before native layout');
    if (missingApplication) throw new Error('MCU compilation cannot be omitted');
    const remaining = () => {
      const ms = Math.floor(timeout - (performance.now() - start));
      if (ms < 100) throw new Error('Block test exhausted its execution deadline');
      return ms;
    };
    const spice = await runSpiceChecks(plan, blocks, {
      artifactDir: join(job, 'spice'),
      timeoutMs: Math.min(60_000, remaining()),
    });
    set(spice);
    await save('spice.json', spice);
    if (!spice.ok || spice.inputHash !== schematicHash(plan, blocks))
      throw new Error('Current SPICE gate did not pass');
    const native = await runWorker(
      process.env.MOKI_BUN ?? join(homedir(), '.bun/bin/bun'),
      [join(root, 'eda/blocks/build.ts'), '--job', job],
      root,
      remaining(),
    );
    await writeFile(join(job, 'native.log'), native.stdout + native.stderr, { mode: 0o600 });
    receipt.artifacts['native.log'] = join(job, 'native.log');
    if (![0, 2].includes(native.code))
      throw new Error(`Native block build failed (exit ${native.code}): ${native.stderr.slice(-1500)}`);
    const nativeReceipt = await readJson(join(job, 'receipt.json')),
      circuit = await readJson(join(job, 'circuit.json'), 32 * 1024 * 1024),
      imports = await readJson(join(job, 'import-map.json'), 4 * 1024 * 1024);
    for (const name of ['receipt.json', 'circuit.json', 'import-map.json'])
      receipt.artifacts[name] = join(job, name);
    const errors = Array.isArray(circuit)
      ? circuit.filter((c) => typeof c.type === 'string' && c.type.endsWith('_error'))
      : [{ message: 'Native circuit data is missing' }];
    const drc = nativeReceipt.drc;
    if (!object(drc) || drc.checked !== true || !Array.isArray(drc.errors))
      throw new Error('Native DRC was not actually checked');
    const drcIssues: GateResult['issues'] = [...drc.errors, ...errors].map((e) => ({
      rule: String(e.type ?? 'native-drc'),
      severity: 'error',
      message: String(e.message ?? e.type ?? 'Native geometry error'),
    }));
    if (native.code !== 0 && !drcIssues.length)
      drcIssues.push({
        rule: 'native-drc-exit',
        severity: 'error',
        message: `Native worker reported nonzero DRC status ${native.code}`,
      });
    set({ gate: 'drc', ok: native.code === 0 && !drc.errors.length && !errors.length, issues: drcIssues });
    set(inspectBlockPadGeometry(draft, plan, blocks, circuit, imports));
    if (receipt.gates.some((g) => ['drc', 'block-test'].includes(g.gate) && !g.ok)) return receipt;
    if (draft.mcu) {
      const compiled = await runWorker(
        process.execPath,
        [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'src/board/chip-firmware-worker.ts'), job],
        root,
        remaining(),
      );
      await writeFile(join(job, 'firmware.log'), compiled.stdout + compiled.stderr, { mode: 0o600 });
      receipt.artifacts['firmware.log'] = join(job, 'firmware.log');
      let build: any;
      try {
        build = await readJson(join(job, 'firmware-build.json'));
        receipt.artifacts['firmware-build.json'] = join(job, 'firmware-build.json');
      } catch {
        /* Missing native compile evidence fails below. */
      }
      set({
        gate: 'compile',
        ok: compiled.code === 0 && build?.compiled === true,
        issues:
          compiled.code === 0 && build?.compiled === true
            ? []
            : [
                {
                  rule: 'block-test-compile',
                  severity: 'error',
                  message: String(
                    build?.note || compiled.stderr.slice(-1500) || 'MCU application was not compiled',
                  ),
                },
              ],
      });
    }
  } catch (error) {
    set(failure('block-test', 'block-test-execution', errorText(error)));
  } finally {
    receipt.ms = performance.now() - start;
    if (job) {
      receipt.artifacts['block-test.json'] = join(job, 'block-test.json');
      try {
        await writeFile(join(job, 'block-test.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
      } catch (error) {
        set(
          failure(
            'block-test',
            'block-test-receipt',
            `Could not persist block test receipt: ${errorText(error)}`,
          ),
        );
        delete receipt.artifacts['block-test.json'];
      }
    }
  }
  return receipt;
}
