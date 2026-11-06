import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as e } from 'react';
import { fp } from '@tscircuit/footprinter';
import { KicadFootprintToCircuitJsonConverter } from 'kicad-to-circuit-json';
import { EasyEdaJsonSchema, convertEasyEdaJsonToCircuitJson, convertRawEasyEdaToTs } from 'easyeda';
import type { BlockPart, CatalogPart } from '../../src/blocks/contract.js';
import { catalogPartFromReceipt, importerUnavailable, loadCatalogReceipt } from '../../src/blocks/catalog.js';

const canonical = (v:unknown):string => JSON.stringify(v, (_k,x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k,x[k]])) : x);
const sha = (v:string) => createHash('sha256').update(v).digest('hex');
/** Pinned converter's actual pad-to-port mapping, including alphanumeric USB pads. */
export function importedPinMap(raw:any):Map<string,string> {
  const parsed = EasyEdaJsonSchema.parse(raw);
  const pads = parsed.packageDetail.dataStr.shape.filter((p:any) => p.type === 'PAD');
  const cj = convertEasyEdaJsonToCircuitJson(parsed);
  const map = new Map<string,string>();
  pads.forEach((p:any,i:number) => {
    const id = String(p.number).trim();
    const port:any = cj.find((e:any) => e.type === 'source_port' && e.source_port_id === `source_port_${i+1}`);
    if(port)map.set(id,port.name);
  });
  if(map.size !== new Set(pads.map((p:any) => String(p.number).trim())).size)throw new Error('Importer pad mapping is incomplete');
  return map;
}
/** Only trusted pinned importer output is executable; authors provide JSON, never TSX. */
export async function ensureImportedPart(part:CatalogPart,options:{cacheDir?:string;assetDir?:string}={}) {
  if(!/^C[1-9]\d*$/.test(part.lcsc))throw new Error('Invalid importer part number');
  if(!/^[a-f0-9]{64}$/.test(part.footprintSha256)||!/^[a-f0-9]{64}$/.test(part.rawSha256))throw new Error('Imported geometry and raw response must be pinned by SHA-256');
  const receipt=await loadCatalogReceipt(part.catalogReceipt,options),verified=catalogPartFromReceipt(receipt,part.lcsc);
  if(verified.mpn!==part.mpn||verified.rawSha256!==part.rawSha256||verified.footprintSha256!==part.footprintSha256)throw new Error('Imported part differs from its pinned immutable receipt');
  const dir = resolve(options.assetDir??resolve(fileURLToPath(new URL('.',import.meta.url)),'parts'),part.lcsc,part.footprintSha256); await mkdir(dir,{recursive:true});
  const writeImmutable=async(path:string,data:string)=>{try{await writeFile(path,data,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(path,'utf8')!==data)throw error;}};
  const rawPath=resolve(dir,`raw-${part.rawSha256}.json`);
  let raw:any=JSON.parse(receipt.rawBody).easyeda_component_details?.easyeda_json;
  if(typeof raw==='string')raw=JSON.parse(raw);
  const geometryOf=(r:any)=>typeof r?.packageDetail?.dataStr==='string'?JSON.parse(r.packageDetail.dataStr):r?.packageDetail?.dataStr;
  if(!raw||sha(canonical(geometryOf(raw)))!==part.footprintSha256)throw new Error(`Pinned importer response is unavailable for ${part.lcsc}`);
  if((raw.lcsc??raw.szlcsc)?.number !== part.lcsc)throw new Error(`Importer identity differs for ${part.lcsc}`);
  const geometry=typeof raw.packageDetail?.dataStr === 'string'?JSON.parse(raw.packageDetail.dataStr):raw.packageDetail?.dataStr;
  if(sha(canonical(geometry)) !== part.footprintSha256)throw new Error(`Imported footprint changed since catalog receipt: ${part.lcsc}`);
  const generated=await convertRawEasyEdaToTs({rawEasy:raw});
  // EasyEDA output omits a React value import; Node/classic JSX needs it, while
  // Bun's automatic JSX runtime accepts the same trusted generated module.
  const tsx=/^import(?:\s+\*\s+as)?\s+React\b/m.test(generated)?generated:`import * as React from 'react'\n${generated}`;
  const tsxHash=sha(tsx),modulePath=resolve(dir,`part-${tsxHash}.tsx`);
  await writeImmutable(rawPath,JSON.stringify(raw,null,2));
  await writeImmutable(modulePath,tsx);
  await writeImmutable(resolve(dir,`verified-${part.catalogReceipt.slice(7)}.json`),JSON.stringify({lcsc:part.lcsc,catalogReceipt:part.catalogReceipt,footprintSha256:part.footprintSha256,tsxSha256:tsxHash,importer:'easyeda@0.0.391'},null,2));
  const module=await import(modulePath);
  const component=Object.values(module).find(v=>typeof v==='function');
  if(!component)throw new Error(`No imported component for ${part.lcsc}`);
  return {raw,component:component as (props:any)=>any,pins:importedPinMap(raw)};
}

export interface EnsurePartOptions { cacheDir?: string; fetch?: typeof globalThis.fetch; assetDir?: string }
function cited(c: BlockPart['datasheet']) {
  const url = new URL(c.url);
  if (url.protocol !== 'https:' || !c.pages?.trim() || c.sha256 && !/^[a-f0-9]{64}$/i.test(c.sha256)) throw new Error('Fallback footprint needs a cited HTTPS source and verified pinout pages');
}
async function sourceText(url: string, fetcher: typeof globalThis.fetch): Promise<string> {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error(`Official KiCad footprint unavailable: HTTP ${response.status}`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) { await reader.cancel(); throw new Error('KiCad footprint exceeded size limit'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  // Preserve a UTF-8 BOM as source text so the pinned raw-byte hash cannot hide its addition/removal.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
}
interface KicadSourceCache {
  schema: 'moki.kicad-footprint-source/1'; sourceUrl: string; sourceSha256: string; rawSource: string;
}
/** Immutable canonical JSON at <cacheDir>/footprint-sources/<raw SHA256>/<URL SHA256>.json.
 * These four fields retain exact source text and its selected official URL; no expiry/master lookup.
 * Legacy recovery requires a content-addressed, intact fallback audit with that exact URL and raw hash.
 * Old hash-only source-cache files are preserved but not trusted for URL provenance/mirror migration.
 */
async function pinnedKicadSource(sourceUrl: string, sourceSha256: string, options: EnsurePartOptions) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error('KiCad source needs a lowercase pinned SHA-256');
  const root = resolve(options.cacheDir ?? process.env.MOKI_BLOCK_PARTS_DIR ?? 'var/block-parts');
  const directory = resolve(root, 'footprint-sources', sourceSha256), cachePath = resolve(directory, `${sha(sourceUrl)}.json`);
  const readBounded = async (path: string, maximum: number) => {
    if ((await stat(path)).size > maximum) throw new Error('Pinned KiCad source/audit cache exceeds size limit');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(path));
  };
  const validSource = (value: any): value is KicadSourceCache => value && !Array.isArray(value) &&
    value.schema === 'moki.kicad-footprint-source/1' && value.sourceUrl === sourceUrl && value.sourceSha256 === sourceSha256 &&
    typeof value.rawSource === 'string' && Buffer.byteLength(value.rawSource, 'utf8') <= 1024 * 1024 && sha(value.rawSource) === sourceSha256 &&
    Object.keys(value).sort().join(',') === 'rawSource,schema,sourceSha256,sourceUrl';
  const cached = async () => {
    const bytes = await readBounded(cachePath, 8 * 1024 * 1024);
    let value: unknown; try { value = JSON.parse(bytes); } catch { throw new Error('Pinned KiCad source cache is malformed'); }
    if (!validSource(value) || canonical(value) !== bytes) throw new Error('Pinned KiCad source cache URL/hash/integrity mismatch');
    return value.rawSource;
  };
  try { return { text: await cached(), cachePath, mode: 'source-cache' as const }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const retain = async (text: string) => {
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024 || sha(text) !== sourceSha256) throw new Error('Pinned KiCad footprint bytes changed');
    const value: KicadSourceCache = { schema: 'moki.kicad-footprint-source/1', sourceUrl, sourceSha256, rawSource: text };
    await mkdir(directory, { recursive: true });
    try { await writeFile(cachePath, canonical(value), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await cached() !== text) throw error; }
    return text;
  };
  let audits: string[];
  try { audits = (await readdir(resolve(root, 'footprints'))).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; audits = []; }
  for (const name of audits) {
    const bytes = await readBounded(resolve(root, 'footprints', name), 16 * 1024 * 1024);
    if (sha(bytes) !== name.slice(0, -5)) throw new Error('Immutable fallback audit cache integrity mismatch');
    let audit: any; try { audit = JSON.parse(bytes); } catch { throw new Error('Immutable fallback audit cache is malformed'); }
    if (audit.sourceSha256 !== sourceSha256 || audit.sourceUrl !== sourceUrl) continue;
    if (audit.schema !== 'moki.fallback-footprint/1' || audit.source !== 'kicad' || audit.citation?.url !== sourceUrl || audit.citation?.sha256 !== sourceSha256 || typeof audit.rawSource !== 'string' || sha(audit.rawSource) !== sourceSha256) throw new Error('Immutable KiCad audit source URL/hash mismatch');
    return { text: await retain(audit.rawSource), cachePath, mode: 'audit-cache' as const };
  }
  return { text: await retain(await sourceText(sourceUrl, options.fetch ?? globalThis.fetch)), cachePath, mode: 'fetch' as const };
}
/** Strip only complete 3D model expressions: no model is imported, fetched or claimed. */
function withoutModels(text: string): string {
  let out = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (!quoted && c === '(' && /^\(\s*model(?=\s|\))/.test(text.slice(i, i + 32))) {
      let depth = 1, q = false, escape = false; let j = i + 1;
      for (; j < text.length && depth; j++) {
        const x = text[j]!;
        if (escape) { escape = false; continue; } if (x === '\\' && q) { escape = true; continue; }
        if (x === '"') { q = !q; continue; } if (!q) { if (x === '(') depth++; else if (x === ')') depth--; }
      }
      if (depth) throw new Error('Unbalanced KiCad model expression');
      i = j - 1; continue;
    }
    out += c;
    if (escaped) { escaped = false; continue; } if (c === '\\' && quoted) { escaped = true; continue; } if (c === '"') quoted = !quoted;
  }
  return out;
}
/** Join only exact, connected source courtyard segments; never synthesize missing edges. */
function stitchCourtyards(geometry: any[]) {
  const groups = new Map<string, any[]>(), replacements = new Map<any, any>(), removed = new Set<any>(), normalizations: any[] = [];
  for (const item of geometry) if (item.type === 'pcb_courtyard_outline') {
    if (!Array.isArray(item.outline) || item.outline.length < 2 || item.outline.some((p: any) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1000 || Math.abs(p.y) > 1000)) throw new Error('Malformed fallback courtyard geometry');
    if (item.outline.length !== 2) continue;
    const key = JSON.stringify([item.pcb_component_id ?? '', item.layer]);
    const group = groups.get(key) ?? []; group.push(item); groups.set(key, group);
  }
  const pointKey = (p: any) => JSON.stringify([p.x, p.y]);
  const cross = (a: any, b: any, c: any) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a: any, b: any, p: any) => Math.abs(cross(a, b, p)) <= 1e-12 && p.x >= Math.min(a.x, b.x) - 1e-12 && p.x <= Math.max(a.x, b.x) + 1e-12 && p.y >= Math.min(a.y, b.y) - 1e-12 && p.y <= Math.max(a.y, b.y) + 1e-12;
  const validateRing = (outline: any[]) => {
    if (outline.length < 4 || pointKey(outline[0]) !== pointKey(outline.at(-1))) throw new Error('Fallback courtyard must be a closed nonzero-area ring');
    const area = Math.abs(outline.slice(0, -1).reduce((sum: number, p: any, i: number) => sum + p.x * outline[i + 1].y - outline[i + 1].x * p.y, 0) / 2);
    if (!Number.isFinite(area) || area <= 1e-12) throw new Error('Fallback courtyard must enclose nonzero area');
    for (let i = 0; i < outline.length - 1; i++) for (let j = i + 2; j < outline.length - 1; j++) {
      if (i === 0 && j === outline.length - 2) continue;
      const [a, b, c, d] = [outline[i], outline[i + 1], outline[j], outline[j + 1]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0 || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) throw new Error('Fallback courtyard source segments cross or overlap');
    }
  };
  for (const fragments of groups.values()) {
    const vertices = new Map<string, { point: any; edges: number[] }>();
    fragments.forEach((f, i) => {
      const [a, b] = f.outline;
      if (pointKey(a) === pointKey(b)) throw new Error('Zero-length fallback courtyard segment');
      for (const p of [a, b]) { const key = pointKey(p), v = vertices.get(key) ?? { point: p, edges: [] }; v.edges.push(i); vertices.set(key, v); }
    });
    if ([...vertices.values()].some(v => v.edges.length !== 2)) throw new Error('Fallback courtyard segments have a gap or branch; source review required');
    const unused = new Set(fragments.map((_f, i) => i));
    while (unused.size) {
      const first = unused.values().next().value!, origin = fragments[first], outline = [origin.outline[0]], loopFragments: any[] = [];
      let edge = first, current = pointKey(outline[0]);
      for (;;) {
        if (!unused.delete(edge)) throw new Error('Fallback courtyard cannot close without reusing a segment');
        const f = fragments[edge]; loopFragments.push(f);
        const next = f.outline.find((p: any) => pointKey(p) !== current);
        if (!next) throw new Error('Fallback courtyard traversal failed');
        outline.push(next); current = pointKey(next);
        if (current === pointKey(outline[0])) break;
        const adjacent = vertices.get(current)!.edges.filter(i => unused.has(i));
        if (adjacent.length !== 1) throw new Error('Fallback courtyard contains an incomplete/ambiguous loop');
        edge = adjacent[0]!;
      }
      validateRing(outline);
      const result = { ...origin, outline };
      replacements.set(origin, result); loopFragments.filter(f => f !== origin).forEach(f => removed.add(f));
      normalizations.push({ kind: 'stitch-exact-courtyard-segments', sourceFragments: loopFragments, result, note: 'Only source segment ordering/direction changed to form its existing closed ring; no edge, coordinate, pad or clearance was invented/dropped.' });
    }
  }
  return { geometry: geometry.filter(g => !removed.has(g)).map(g => replacements.get(g) ?? g), normalizations };
}
function numericGeometry(input: any[], wanted: Set<string>) {
  const geometry = input.filter(p => !['cad_component', 'source_component', 'source_port', 'pcb_component', 'pcb_port', 'pcb_board', 'source_group', 'pcb_group'].includes(p.type));
  const pads = geometry.filter(p => ['pcb_smtpad', 'pcb_plated_hole'].includes(p.type));
  if (!pads.length || pads.length > 512 || geometry.length > 5000) throw new Error('Fallback footprint has missing/excessive native pad geometry');
  const actual = new Set<string>();
  for (const pad of pads) {
    const numbers = (pad.port_hints ?? []).filter((s: unknown) => typeof s === 'string' && /^(?:pin)?[1-9]\d*$/.test(s)).map((s: string) => s.replace(/^pin/, ''));
    const ids = [...new Set<string>(numbers)]; if (ids.length !== 1) throw new Error('Fallback native pad must have one unambiguous numeric physical number');
    const id = ids[0]!; actual.add(id);
    // Stable native aliases match chip pin labels and the block-test pad attestor.
    pad.port_hints = [...new Set([`pin${id}`, id])];
    for (const key of ['x', 'y', 'width', 'height', 'radius', 'outer_diameter', 'hole_diameter', 'outer_width', 'outer_height', 'hole_width', 'hole_height', 'rect_pad_width', 'rect_pad_height']) {
      if (pad[key] !== undefined && (typeof pad[key] !== 'number' || !Number.isFinite(pad[key]) || Math.abs(pad[key]) > 1000 || !['x', 'y'].includes(key) && pad[key] <= 0)) throw new Error('Fallback native pad dimensions are invalid');
    }
  }
  if ([...actual].sort().join('\0') !== [...wanted].sort().join('\0')) throw new Error('Declared verified numeric pin map differs from actual fallback footprint pads');
  return stitchCourtyards(geometry);
}
/** Explicit cited fallback, never executable author TSX or an arbitrary remote footprint URL. */
export async function ensurePart(part: BlockPart, catalog: CatalogPart, options: EnsurePartOptions = {}) {
  if (part.lcsc !== catalog.lcsc || part.mpn !== catalog.mpn || part.catalogReceipt !== catalog.catalogReceipt) throw new Error('Block part differs from its pinned supplier identity');
  const receipt = await loadCatalogReceipt(catalog.catalogReceipt, options), verified = catalogPartFromReceipt(receipt, catalog.lcsc);
  if (verified.mpn !== catalog.mpn || verified.importer !== catalog.importer || verified.rawSha256 !== catalog.rawSha256 || verified.footprintSha256 !== catalog.footprintSha256 || canonical(verified.pins) !== canonical(catalog.pins)) throw new Error('Catalog metadata differs from its immutable supplier receipt');
  if (catalog.importer === 'jlcpcb-metadata-only' && (!catalog.importerUnavailableReceipt || !importerUnavailable(await loadCatalogReceipt(catalog.importerUnavailableReceipt, options), catalog.lcsc, catalog.mpn))) throw new Error('Metadata-only entry lacks verified importer-unavailability evidence');
  const selected = part.footprint;
  if (!selected || selected.source === 'jlcpcb') {
    if (selected && selected.id.replace(/^jlcpcb:/, '') !== part.lcsc) throw new Error('JLCPCB footprint must match the actual supplier identity');
    if (!catalog.pins.length || !catalog.footprintSha256) throw new Error('Metadata-only supplier entry requires an explicit cited standard or KiCad footprint');
    return ensureImportedPart(catalog,options);
  }
  if (part.pinout !== 'verified') throw new Error('Fallback requires a physically verified datasheet pin map');
  cited(part.datasheet); cited(selected.citation);
  if (part.omitPads?.length || part.correction) throw new Error('Fallback pad corrections are not supported; choose a package with the exact verified native pad set');
  const labels = new Map<string, string>();
  for (const [logical, pin] of Object.entries(part.pins)) {
    if (!/^[1-9]\d{0,2}$/.test(pin.pad) || labels.has(pin.pad) || !logical || /[\x00-\x1f]/.test(logical)) throw new Error('Fallback requires unique positive numeric physical pad identifiers');
    labels.set(pin.pad, logical);
  }
  if (!labels.size || labels.size > 512) throw new Error('Fallback pin map is empty or too large');
  if (catalog.pins.length && [...labels.keys()].sort().join('\0') !== catalog.pins.map(p => p.pad).sort().join('\0')) throw new Error('Fallback declared pads differ from actual imported supplier pad identities');
  let geometry: any[], normalizations: any[] = [], sourceUrl: string | undefined, sourceSha256: string | undefined, rawSource: string | undefined, sourceCachePath: string | undefined, sourceCacheMode: string | undefined;
  if (selected.source === 'footprinter') {
    if (selected.id.length > 256 || !/^[A-Za-z0-9_.=-]+$/.test(selected.id)) throw new Error('Invalid standard footprint identifier');
    const parsed = fp.string(selected.id), params = parsed.params();
    const inspect = (v: unknown, key = ''): void => {
      if (typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) > 1000 || /pins|rows|cols|left|right|top|bottom/i.test(key) && v > 512)) throw new Error('Standard footprint parameters exceed bounded geometry limits');
      if (Array.isArray(v)) { if (v.length > 512) throw new Error('Too many footprint parameters'); for (const child of v) inspect(child, key); }
      else if (v && typeof v === 'object') for (const [name, child] of Object.entries(v)) inspect(child, name);
    };
    inspect(params); ({ geometry, normalizations } = numericGeometry(parsed.circuitJson(), new Set(labels.keys())));
  } else if (selected.source === 'kicad') {
    const id = selected.id.replace(/^kicad:/, '').replace(':', '/'), match = id.match(/^([A-Za-z0-9_-]+)\/([A-Za-z0-9_.,()+-]+)$/);
    if (!match || id.includes('..') || id.length > 240) throw new Error('KiCad fallback needs a safe Library/Name identifier');
    const path = `${match[1]}.pretty/${encodeURIComponent(match[2]!)}.kicad_mod`;
    const official = [`https://raw.githubusercontent.com/KiCad/kicad-footprints/master/${path}`, `https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/${path}`];
    if (!official.includes(selected.citation.url) || !selected.citation.sha256) throw new Error('KiCad source must be an exact official raw footprint URL with pinned SHA-256');
    sourceUrl = selected.citation.url;
    const savedSource = await pinnedKicadSource(sourceUrl, selected.citation.sha256, options), text = savedSource.text;
    rawSource = text; sourceSha256 = sha(text); sourceCachePath = savedSource.cachePath; sourceCacheMode = savedSource.mode;
    const converter = new KicadFootprintToCircuitJsonConverter(); converter.addFile('part.kicad_mod', withoutModels(text)); converter.runUntilFinished();
    if (converter.getWarnings().length) throw new Error(`KiCad conversion warnings require review: ${converter.getWarnings().join('; ')}`);
    ({ geometry, normalizations } = numericGeometry(converter.getOutput(), new Set(labels.keys())));
  } else throw new Error('Unsupported fallback footprint source');
  const pins = new Map([...labels.keys()].map(pad => [pad, `pin${pad}`]));
  const pinLabels = Object.fromEntries([...labels].map(([pad, label]) => [`pin${pad}`, label]));
  const resolvedFootprintSha256 = sha(canonical(geometry));
  const tool = selected.source === 'footprinter' ? '@tscircuit/footprinter' : 'kicad-to-circuit-json';
  const installed = JSON.parse(await readFile(new URL(`../node_modules/${tool}/package.json`, import.meta.url), 'utf8'));
  if (installed.name !== tool || typeof installed.version !== 'string') throw new Error('Fallback generator installation cannot be identified');
  const footprintAudit = { schema: 'moki.fallback-footprint/1', lcsc: catalog.lcsc, catalogReceipt: catalog.catalogReceipt,
    source: selected.source, id: selected.id, citation: selected.citation, resolvedFootprintSha256, geometry, normalizations,
    sourceUrl, sourceSha256, rawSource, tool: `${tool}@${installed.version}` };
  const auditBytes = canonical(footprintAudit), auditDir = resolve(options.cacheDir ?? process.env.MOKI_BLOCK_PARTS_DIR ?? 'var/block-parts', 'footprints');
  await mkdir(auditDir, { recursive: true }); const footprintAuditPath = resolve(auditDir, `${sha(auditBytes)}.json`);
  try { await writeFile(footprintAuditPath, auditBytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(footprintAuditPath, 'utf8') !== auditBytes) throw error; }
  const component = (props: any) => e('chip', { ...props, manufacturerPartNumber: catalog.mpn, supplierPartNumbers: { jlcpcb: [catalog.lcsc] }, pinLabels, footprint: geometry });
  return { raw: null, component, pins, footprintSource: selected.source, footprintId: selected.id, resolvedFootprintSha256, sourceUrl, sourceSha256, sourceCachePath, sourceCacheMode, footprintAuditPath, modelsProvided: false };
}
