import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function toolVersions(): Promise<Record<string, string>> {
  const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const versions: Record<string, string> = { bun: process.versions.bun ?? 'unavailable', toolchainLockSha256: createHash('sha256').update(await readFile(new URL('./bun.lock', import.meta.url))).digest('hex') };
  versions.mokiRendererSha256 = createHash('sha256').update(await readFile(new URL('./render.ts', import.meta.url))).digest('hex');
  for (const file of ['blocks/build.ts', 'blocks/routing-frame.ts', 'blocks/locked-pads.ts', 'blocks/native-owner-guard.ts', 'blocks/immutable-preloads.ts', 'blocks/auto-placement.ts', 'blocks/sensor-exits.ts', 'blocks/repair-saved-sources.ts', 'blocks/repair-native-exits.ts', 'blocks/ground-plane.ts', 'blocks/rp-clock.ts', 'blocks/rp-escape.ts', 'blocks/rp-signal-escape.ts', 'blocks/usb-sink-escape.ts', 'blocks/native-handoffs.ts', 'blocks/native-width.ts', 'blocks/native-replay.ts', 'blocks/no-via-in-pad.ts', 'blocks/robust-routing-checks.ts', 'blocks/normalize-native-copper.ts', 'blocks/rp-phase-order.ts', 'blocks/drv8833-escape.ts', 'blocks/grouped-breakouts.ts', 'blocks/copper-netlist.ts', 'blocks/debug-source.ts', 'blocks/stitch-ground.ts', 'blocks/imported.ts', 'blocks/legalize.ts', 'blocks/schematic.ts', '../src/blocks/native-netlist.ts', '../src/blocks/native-ports.ts', '../src/blocks/native-placement.ts', '../src/blocks/test-block.ts', '../src/blocks/native-trace-width.ts', '../src/board/chip-firmware-worker.ts'])
    versions[file] = createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex');
  for (const file of ['../src/board/bom.ts', '../src/circuit/catalog.ts', 'models/render-board.ts', 'models/catalog-models.ts', 'models/glb.ts', 'models/compact-glb.ts', 'apply-layout.ts', 'edit-router.ts', 'blocks/router.ts', 'blocks/fanout.ts', 'blocks/schematic-notes.ts', '../src/blocks/fanout.ts', '../src/blocks/router-planning.ts', '../src/board/router-planning.ts', '../src/board/edits.ts', 'enclosure/module-preview.ts', 'enclosure/module-mech.ts']) versions[file] = createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex');
  for (const name of [...Object.keys(pkg.dependencies), '@tscircuit/core'].sort()) {
    let directory = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', name);
    for (;;) {
      try { const p = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); if (p.name === name) { versions[name] = p.version; break; } } catch {}
      const parent = dirname(directory); if (parent === directory) throw new Error(`Cannot read version of ${name}`); directory = parent;
    }
  }
  return versions;
}
if (import.meta.main) console.log(JSON.stringify(await toolVersions()));
