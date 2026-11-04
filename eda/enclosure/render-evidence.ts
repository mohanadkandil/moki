// Dev tool: renders PNGs of a job's enclosure with three.js in headless Chromium. Evidence only, never part of a job.
//   bun eda/enclosure/render-evidence.ts --job <dir> --out <dir> [--prefix focus-timer]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const job = resolve(arg('job')!); const out = resolve(arg('out')!); const prefix = arg('prefix') ?? 'enclosure';
const CHROME = join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell');
const LIBS = join(homedir(), '.local/share/sogo-diagrams/lib');

const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'preview-page.ts')], target: 'browser', format: 'esm', minify: true });
if (!built.success) throw new Error(String(built.logs));
const script = (await built.outputs[0]!.text()).replace(/<\/script/g, '<\\/script');
const b64 = (name: string) => readFileSync(join(job, name)).toString('base64');
const stlBase = b64('enclosure-base.stl'); const stlLid = b64('enclosure-lid.stl'); const glb = b64('assembly.glb');

// glTF frame: x = -board x, y = up, z = board y. So the USB wall (board -y) faces glTF -z.
// STL pages rotate Z up to Y up, so the base keeps board x and its -y wall faces page +z.
const views: Array<{ name: string; view: object }> = [
  { name: 'base-usb-wall', view: { kind: 'stl', data: stlBase, dir: [-0.55, 0.6, 0.85] } },
  { name: 'base-usb-closeup', view: { kind: 'stl', data: stlBase, dir: [0, 0.12, 1] , zoom: 0.72 } },
  { name: 'base-back-mark', view: { kind: 'stl', data: stlBase, dir: [0.12, 0.25, -1], zoom: 0.8 } },
  { name: 'base-inside-top', view: { kind: 'stl', data: stlBase, dir: [0, 1, 0.001], up: [0, 0, -1] } },
  { name: 'base-underside', view: { kind: 'stl', data: stlBase, dir: [0.35, -0.8, 0.5] } },
  // The lid STL is printed upside down (x, -y, H - z), so its print pose shows the underside with the pillars rising.
  { name: 'lid-underside', view: { kind: 'stl', data: stlLid, dir: [0.4, 1, 0.6] } },
  { name: 'lid-top', view: { kind: 'stl', data: stlLid, dir: [0.001, -1, 0], up: [0, 0, 1] } },
  { name: 'assembly-closed', view: { kind: 'glb', data: glb, dir: [0.55, 0.75, -0.75], lidAlpha: 0.26 } },
  { name: 'assembly-lid-solid', view: { kind: 'glb', data: glb, dir: [0.2, 1, -0.45], lidAlpha: 1 } },
  { name: 'assembly-usb-front', view: { kind: 'glb', data: glb, dir: [-0.28, 0.1, -1], lidAlpha: 1, zoom: 0.42 } },
  { name: 'assembly-lid-off', view: { kind: 'glb', data: glb, dir: [0.25, 1, -0.5], hide: ['enclosure-lid'] } },
  { name: 'assembly-populated-board', view: { kind: 'glb', data: glb, dir: [0.45, 0.7, -0.7], hide: ['enclosure-lid', 'enclosure-base'] } },
  { name: 'assembly-bare-board-top', view: { kind: 'glb', data: glb, dir: [0.001, 1, 0], up: [0, 0, 1], hide: ['enclosure-lid', 'enclosure-base', 'modules-'] } },
];
const only = arg('only')?.split(',');
const dir = mkdtempSync(join(tmpdir(), 'moki-render-'));
try {
  for (const { name, view } of views) {
    if (only && !only.includes(name)) continue;
    const html = join(dir, `${name}.html`);
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><body><script>window.__VIEW=${JSON.stringify(view)}</script><script type="module">${script}</script></body>`);
    const png = join(out, `${prefix}-${name}.png`);
    const proc = Bun.spawnSync([CHROME, '--no-sandbox', '--hide-scrollbars', '--window-size=1400,1000', '--virtual-time-budget=20000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--screenshot=${png}`, `file://${html}`], { env: { ...process.env, LD_LIBRARY_PATH: LIBS }, stdout: 'pipe', stderr: 'pipe', timeout: 120000 });
    console.log(name, proc.exitCode, png);
    if (proc.exitCode !== 0) console.error(proc.stderr.toString().slice(-500));
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
