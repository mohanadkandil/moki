/** Private diagnostic fixes for pinned native ownership inference.
 * Pathfinding, copper generation and fabrication constraints are unchanged.
 * The installed SDK is never written; only an audited private ESM copy loads.
 */
import { readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const OWNER_GUARD_SDK_VERSION = '0.0.1037';
export const OWNER_GUARD_UPSTREAM_SHA256 = '9424629cc1f77f18fba24335effb5e5fc40da9a15e25aa97213b6c34af47f6fa';
export const OWNER_GUARD_ORIGINAL = '(0===n.length||t.netIsAssignable||t.connectedTo.some(e=>h.has(e)))';
export const OWNER_GUARD_REPLACEMENT = '(t.connectedTo.some(e=>h.has(e))||((0===n.length||t.netIsAssignable)&&t.connectedTo.length===0))';
export const OWNER_GUARD_MARKER_ORIGINAL = 'e=>{const t=e.filter(e=>"pcb_port"===e.type),n=e.filter(e=>"pcb_smtpad"===e.type),o=e.filter(e=>"pcb_trace"===e.type);';
export const OWNER_GUARD_MARKER_REPLACEMENT = 'e=>{const __mokiKnownOwners=__mokiNativeDeclaredOwnerIds(e);const t=e.filter(e=>"pcb_port"===e.type),n=e.filter(e=>"pcb_smtpad"===e.type),o=e.filter(e=>"pcb_trace"===e.type).filter(e=>!__mokiKnownOwners.has(e.source_trace_id));';
// Only structural, unique declared ownership suppresses geometric inference.
// This does not validate electrical ownership or remove existing endpoint IDs.
export const OWNER_GUARD_MARKER_HELPER = 'function __mokiNativeDeclaredOwnerIds(e){const t=new Map,n=new Set;for(const o of e){if(o.type!=="source_trace"||typeof o.source_trace_id!=="string"||!o.source_trace_id.length)continue;const i=o.source_trace_id;t.set(i,(t.get(i)||0)+1);if([o.connected_source_port_ids,o.connected_source_net_ids].every(e=>Array.isArray(e)&&e.length>0&&Array.from(e).every(e=>typeof e==="string"&&e.length>0)))n.add(i)}for(const[e,o]of t)if(o!==1)n.delete(e);return n}';
const SDK = new URL('../node_modules/@tscircuit/capacity-autorouter/dist/index.js', import.meta.url);
const PACKAGE = new URL('../node_modules/@tscircuit/capacity-autorouter/package.json', import.meta.url);
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const occurrences = (value: string, needle: string) => value.split(needle).length - 1;

export interface NativeOwnerGuardOptions {clearanceFloorMm?:number}
// These are exact active runtime sites in the SHA-pinned bundle, rather than
// all copies appearing in its source map. Every affected native function keeps
// its own existing search, displacement, acceptance and geometry logic.
export const NATIVE_CLEARANCE_PATCHES = [
  {id:'repair-error-severity-floor',original:'t=hP.traceClearance??.1;if(Number.isFinite(e))',replacement:'t=__mokiNativeTraceClearance();if(Number.isFinite(e))',count:1},
  {id:'repair-spatial-envelope',original:'r=(hP.traceClearance??.1)+Sb;return Math.max',replacement:'r=__mokiNativeTraceClearance(e)+Sb;return Math.max',count:1},
  {id:'repair-board-edge-proximity',original:'Math.max(.16,e.defaultObstacleMargin??0,hP.traceClearance??.1)',replacement:'Math.max(.16,e.defaultObstacleMargin??0,__mokiNativeTraceClearance(e))',count:1},
  {id:'repair-via-segment-target',original:'p=t.radius+n.radius+(hP.traceClearance??.1)+Sb-u',replacement:'p=t.radius+n.radius+__mokiNativeTraceClearance(o)+Sb-u',count:1},
  {id:'repair-segment-segment-target',original:'h=t.radius+n.radius+(hP.traceClearance??.1)+Sb-l',replacement:'h=t.radius+n.radius+__mokiNativeTraceClearance(o)+Sb-l',count:1},
  {id:'repair-trace-error-target',original:'Number.isFinite(f)?f:hP.traceClearance??.1',replacement:'__mokiNativeTraceClearance(e,Number.isFinite(f)?f:undefined)',count:1},
  {id:'repair-via-error-target',original:'Number.isFinite(_)?_:hP.traceClearance??.1',replacement:'__mokiNativeTraceClearance(e,Number.isFinite(_)?_:undefined)',count:1},
  {id:'repair-layer-corridor-target',original:'(e.minTraceToPadEdgeClearance??hP.traceClearance??.1)',replacement:'__mokiNativeTraceClearance(e)',count:1},
  {id:'repair-reference-evaluator',original:'traceClearance:a.minTraceToPadEdgeClearance??hP.traceClearance',replacement:'traceClearance:__mokiNativeReferenceTraceClearance(a)',count:1},
  {id:'repair-indexed-engine-entries',original:'traceClearance:e.srj.minTraceToPadEdgeClearance??hP.traceClearance',replacement:'traceClearance:__mokiNativeFabricationTraceClearance(e.srj)',count:2},
  {id:'indexed-engine-default',original:'this.traceClearance=t.traceClearance??.1',replacement:'this.traceClearance=__mokiNativeReferenceTraceClearance(e,t.traceClearance)',count:1},
  {id:'projection-default',original:'o=e.traceClearance??.1,i=e.viaClearance??.1',replacement:'o=__mokiNativeTraceClearance(e.srj,e.traceClearance),i=e.viaClearance??.1',count:1},
  {id:'pipeline9-reference-evaluator',original:'traceClearance:n.traceClearance??hR',replacement:'traceClearance:__mokiNativeReferenceTraceClearance(e,n.traceClearance)',count:1},
  // These two known internal sites derive a global reference-check target
  // from the planning reserve. Their references include immutable clock Cu,
  // which follows the actual fabrication rule, not the new-route reserve.
  {id:'pipeline9-joint-internal-reference-target',original:'s=e.originalSrj.minTraceToPadEdgeClearance??e.originalSrj.defaultObstacleMargin??hR,a=dR',replacement:'s=__mokiNativeFabricationTraceClearance(e.originalSrj),a=dR',count:1},
  {id:'pipeline9-cleanup-internal-reference-target',original:'drcOptions:{traceClearance:e.originalSrj.minTraceToPadEdgeClearance??e.originalSrj.defaultObstacleMargin??.1,viaClearance:',replacement:'drcOptions:{traceClearance:__mokiNativeFabricationTraceClearance(e.originalSrj),viaClearance:',count:1},
] as const;
export function nativeClearanceHelperSource(floor:number):string {
  return 'function __mokiNativeTraceClearance(e,t){const n=['+JSON.stringify(floor)+',e?.minTraceToPadEdgeClearance,e?.minPadEdgeToPadEdgeClearance,t].filter(e=>e!==undefined);if(n.some(e=>typeof e!=="number"||!Number.isFinite(e)||e<0))throw Error("Invalid guarded native clearance rule");return Math.max(...n)}function __mokiNativeFabricationTraceClearance(e,t){__mokiNativeTraceClearance(e,t);return Math.max('+JSON.stringify(floor)+',e?.minPadEdgeToPadEdgeClearance??0,t??0)}function __mokiNativeReferenceTraceClearance(e,t){return __mokiNativeFabricationTraceClearance(e,t)+.005000001}';
}
function configuredFloor(options:NativeOwnerGuardOptions):number|undefined {
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>options[k as keyof NativeOwnerGuardOptions]!==undefined&&k!=='clearanceFloorMm'))throw Error('Unsupported native owner-guard options');
  const floor=options.clearanceFloorMm;
  if(floor!==undefined&&(typeof floor!=='number'||!Number.isFinite(floor)||floor<.127))throw Error('Native clearance floor must be finite and at least 0.127 mm');
  return floor;
}

export function patchNativeOwnerGuardBundle(source: string, version: string,options:NativeOwnerGuardOptions={}): string {
  const floor=configuredFloor(options);
  if (version !== OWNER_GUARD_SDK_VERSION) throw Error('Unsupported native owner-guard SDK version');
  if (digest(source) !== OWNER_GUARD_UPSTREAM_SHA256) throw Error('Native owner-guard upstream SHA mismatch');
  if (occurrences(source, OWNER_GUARD_ORIGINAL) !== 1 || source.includes(OWNER_GUARD_REPLACEMENT))
    throw Error('Native owner-guard predicate must occur exactly once');
  if (occurrences(source, OWNER_GUARD_MARKER_ORIGINAL) !== 2 || source.includes('__mokiNativeDeclaredOwnerIds'))
    throw Error('Native owner-guard marker functions must occur exactly twice');
  let patched=source.replace(OWNER_GUARD_ORIGINAL, OWNER_GUARD_REPLACEMENT)
    .split(OWNER_GUARD_MARKER_ORIGINAL).join(OWNER_GUARD_MARKER_REPLACEMENT) + '\n' + OWNER_GUARD_MARKER_HELPER + '\n';
  if(floor!==undefined){
    if(source.includes('__mokiNativeTraceClearance'))throw Error('Native clearance helper already exists');
    for(const p of NATIVE_CLEARANCE_PATCHES){
      if(occurrences(patched,p.original)!==p.count)throw Error('Native clearance site count mismatch: '+p.id);
      patched=patched.split(p.original).join(p.replacement);
    }
    patched+='\n'+nativeClearanceHelperSource(floor)+'\n';
  }
  return patched;
}

export interface NativeOwnerGuardAudit {
  schema: 'moki.private-native-owner-guard/2';
  sdkVersion: string; upstreamBundleSha256: string; predicatePatchedSha256: string;
  loadedModuleSha256: string; helperSha256: string; moduleUrl: string;
  predicateReplacementCount: 1; nativePathfindingChanged: false; clearanceRulesChanged: false;
  markerReplacementCount: 2; markerHelperInjectionCount: 1;
  markerFunctionPaths: string[];
  utilityIsolation: { version: string; sourceTreeSha256: string; copiedTreeSha256: string; directory: string; files: Array<{path:string; sourceSha256:string; copiedSha256:string}>; sharedGraphicsDebugUrl:string; sharedGraphicsDebugSha256:string; graphicsManifestSha256:string; manifestSha256:string };
  clearanceGuard?:{floorMm:number;referenceEpsilonCompensationMm:number;nativeClearancePropagationChanged:true;declaredFabricationRulesChanged:false;mutableForceUsesPlanningReserve:true;globalReferenceUsesFabricationRule:true;sites:Array<{id:string;replacementCount:number;originalExpressionSha256:string;replacementExpressionSha256:string}>;replacementCount:number};
  dependencyRelocations: Array<{ specifier: string; replacements: number; url: string; sha256: string; originalSha256?:string; manifestSha256?: string; version?: string }>;
  scope: 'private-offline-declared-owner-inference';
}

async function immutableFile(path: string, value: string) {
  try { await writeFile(path, value, { flag: 'wx', mode: 0o600 }); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || digest(await readFile(path)) !== digest(value))
    throw Error('Native owner-guard cached module is not the exact prepared copy');
}

async function isolateSolverUtils(directory: string, behaviorHash: string): Promise<NativeOwnerGuardAudit['utilityIsolation']> {
  const manifestUrl = new URL('../node_modules/@tscircuit/solver-utils/package.json', import.meta.url);
  const manifest = await readFile(manifestUrl), pkg = JSON.parse(manifest.toString());
  if (pkg.version !== '0.0.23' || pkg.exports?.['.'] !== './dist/index.js') throw Error('Unsupported isolated solver-utils entry');
  const pins = [['index.js','8dccabc62b65504da61bd35f007565c1f8733310cae4c4bba3c025c53f094bb5'], ['chunk-FCNBEO2E.js','af1bc555661669f65a26d5973e1faf7de9688004843f4b3270c522c1f09f2de7']] as const;
  const raw = await Promise.all(pins.map(async ([path,hash]) => {
    const value = await readFile(new URL('./dist/' + path, manifestUrl), 'utf8');
    if (digest(value) !== hash) throw Error('Isolated solver-utils source SHA mismatch: ' + path);
    return {path,value,sourceSha256:hash};
  }));
  // Resolve the ESM import condition explicitly: graphics-debug has no require
  // export. This shared debug dependency does not own the solver registry.
  const graphicsManifestUrl = new URL('../node_modules/graphics-debug/package.json', import.meta.url);
  const graphicsManifest = await readFile(graphicsManifestUrl), graphics = JSON.parse(graphicsManifest.toString());
  const entry = graphics.exports?.['.']?.import;
  if (typeof entry !== 'string' || graphics.module !== undefined) throw Error('Unsupported graphics-debug ESM entry');
  const graphicsPath = await realpath(fileURLToPath(new URL(entry, graphicsManifestUrl)));
  const sharedGraphicsDebugUrl = pathToFileURL(graphicsPath).href;
  if (occurrences(raw[0]!.value, 'from "graphics-debug"') !== 1) throw Error('Isolated utility import layout changed');
  const copied = raw.map(f=>({...f, value:f.path==='index.js' ? f.value.replace('from "graphics-debug"','from '+JSON.stringify(sharedGraphicsDebugUrl)) : f.value}));
  const files = copied.map(f=>({path:f.path,sourceSha256:f.sourceSha256,copiedSha256:digest(f.value)}));
  const sourceTreeSha256 = digest(JSON.stringify(files.map(f=>[f.path,f.sourceSha256]))), copiedTreeSha256 = digest(JSON.stringify(files.map(f=>[f.path,f.copiedSha256])));
  const utilityDirectory = resolve(directory, 'solver-utils-' + digest(behaviorHash + ':' + copiedTreeSha256));
  await mkdir(utilityDirectory, {mode:0o700,recursive:true});
  if (await realpath(utilityDirectory) !== utilityDirectory) throw Error('Isolated utility directory may not be a symlink');
  await immutableFile(resolve(utilityDirectory,'package.json'), '{"type":"module"}\n');
  for (const f of copied) await immutableFile(resolve(utilityDirectory,f.path), f.value);
  return {version:pkg.version,sourceTreeSha256,copiedTreeSha256,directory:utilityDirectory,files,sharedGraphicsDebugUrl,sharedGraphicsDebugSha256:digest(await readFile(graphicsPath)),graphicsManifestSha256:digest(graphicsManifest),manifestSha256:digest(manifest)};
}

/** Prepare an immutable copy with the three pinned inference changes. Bare
 * imports retain original ESM resolution, except the exact official utility
 * graph copied into a private module namespace to isolate its solver registry.
 */
export async function prepareNativeOwnerGuardModule(cacheDir: string,options:NativeOwnerGuardOptions={}): Promise<{ moduleUrl: string; audit: NativeOwnerGuardAudit }> {
  const floor=configuredFloor(options);
  if (typeof cacheDir !== 'string' || !cacheDir) throw Error('Native owner guard needs a private cache directory');
  const [source, pkg, helper] = await Promise.all([readFile(SDK, 'utf8'), readFile(PACKAGE, 'utf8'), readFile(new URL(import.meta.url))]);
  const version = JSON.parse(pkg).version;
  let relocated = patchNativeOwnerGuardBundle(source, version,options);
  const predicatePatchedSha256 = digest(relocated), dependencyRelocations: NativeOwnerGuardAudit['dependencyRelocations'] = [];
  const cacheRoot = await realpath(resolve(cacheDir));
  if (cacheRoot.split(sep).includes('node_modules')) throw Error('Native owner guard may not write inside installed dependencies');
  const directory = resolve(cacheRoot, 'native-owner-guard');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const actualDirectory = await realpath(directory);
  if (actualDirectory !== directory || actualDirectory.split(sep).includes('node_modules')) throw Error('Native owner guard needs a real private directory outside installed dependencies');
  const utilityIsolation = await isolateSolverUtils(actualDirectory, predicatePatchedSha256);
  const sdkRequire = createRequire(SDK);
  // Pinned bundle contains only these static import specifiers. No dynamic
  // imports or alternate loader is introduced by this patch.
  for (const [specifier, count] of [['./chunk-G3PMV62Z.js', 1], ['@tscircuit/solver-utils', 92], ['object-hash', 3]] as const) {
    const needle = 'from' + JSON.stringify(specifier);
    if (occurrences(relocated, needle) !== count) throw Error('Native owner-guard import layout changed: ' + specifier);
    const path = await realpath(sdkRequire.resolve(specifier));
    const url = pathToFileURL(specifier === '@tscircuit/solver-utils' ? resolve(utilityIsolation.directory,'index.js') : path).href;
    let manifestSha256: string | undefined, dependencyVersion: string | undefined;
    if (!specifier.startsWith('.')) {
      const manifestUrl = new URL('../node_modules/' + specifier + '/package.json', import.meta.url);
      const manifest = await readFile(manifestUrl), dependency = JSON.parse(manifest.toString('utf8'));
      // createRequire must not silently choose a different conditional entry
      // from the original ESM import. These two pinned dependencies expose
      // unconditional exports/main only; a changed layout requires review.
      const entry = dependency.exports === undefined ? dependency.main : typeof dependency.exports === 'string' ? dependency.exports : dependency.exports?.['.'];
      if (typeof entry !== 'string' || dependency.module !== undefined)
        throw Error('Native owner-guard dependency has conditional/alternate ESM entry: ' + specifier);
      const expected = await realpath(fileURLToPath(new URL(entry.startsWith('.') ? entry : './' + entry, manifestUrl)));
      if (path !== expected) throw Error('Native owner-guard ESM/require dependency resolution differs: ' + specifier);
      manifestSha256 = digest(manifest); dependencyVersion = dependency.version;
    }
    relocated = relocated.split(needle).join('from' + JSON.stringify(url));
    dependencyRelocations.push({ specifier, replacements: count, url, sha256: digest(await readFile(new URL(url))), ...(specifier === '@tscircuit/solver-utils' ? {originalSha256:digest(await readFile(path))}:{}), ...(manifestSha256 ? { manifestSha256, version: dependencyVersion } : {}) });
  }
  const loadedModuleSha256 = digest(relocated);
  const path = resolve(actualDirectory, 'sdk-' + loadedModuleSha256 + '.mjs');
  await immutableFile(path, relocated);
  const moduleUrl = pathToFileURL(path).href;
  const audit: NativeOwnerGuardAudit = {
    schema: 'moki.private-native-owner-guard/2', sdkVersion: version,
    upstreamBundleSha256: digest(source), predicatePatchedSha256, loadedModuleSha256,
    helperSha256: digest(helper), moduleUrl, predicateReplacementCount: 1,
    markerReplacementCount:2,markerHelperInjectionCount:1,
    markerFunctionPaths:['@tscircuit/checks:addStartAndEndPortIdsIfMissing (inline iP)', 'lib/utils/autorouting-drc/annotateTraceEndpointPorts.ts (aR)'],utilityIsolation,
    nativePathfindingChanged: false, clearanceRulesChanged: false, dependencyRelocations,
    ...(floor!==undefined?{clearanceGuard:{floorMm:floor,referenceEpsilonCompensationMm:.005000001,nativeClearancePropagationChanged:true as const,declaredFabricationRulesChanged:false as const,mutableForceUsesPlanningReserve:true as const,globalReferenceUsesFabricationRule:true as const,sites:NATIVE_CLEARANCE_PATCHES.map(p=>({id:p.id,replacementCount:p.count,originalExpressionSha256:digest(p.original),replacementExpressionSha256:digest(p.replacement)})),replacementCount:NATIVE_CLEARANCE_PATCHES.reduce((n,p)=>n+p.count,0)}}:{}),
    scope: 'private-offline-declared-owner-inference',
  };
  await writeFile(resolve(actualDirectory, 'sdk-' + loadedModuleSha256 + '.audit.json'), JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
  return { moduleUrl, audit };
}

/** Caller must gate this behind its private diagnostic flag. Loading does not
 * instantiate a solver. Only the official native Pipeline9 constructor escapes.
 */
export async function loadNativeOwnerGuard(cacheDir: string,options:NativeOwnerGuardOptions={}): Promise<{ Pipeline9: new (...args: any[]) => any; audit: NativeOwnerGuardAudit }> {
  const prepared = await prepareNativeOwnerGuardModule(cacheDir,options);
  const module = await import(prepared.moduleUrl);
  if (typeof module.AutoroutingPipelineSolver9_PreloadedTraceGraph !== 'function')
    throw Error('Guarded native SDK lacks the public Pipeline9 constructor');
  return { Pipeline9: module.AutoroutingPipelineSolver9_PreloadedTraceGraph, audit: prepared.audit };
}
