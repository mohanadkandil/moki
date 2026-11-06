import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isIP } from 'node:net';
import type { CatalogPart } from './contract.js';

const SEARCH = 'https://jlcsearch.tscircuit.com/api/search';
const JLC_SEARCH = 'https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList';
const IMPORTER = 'https://jlcsearch.tscircuit.com/api/easyeda_components/';
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const stock = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const code = (value: unknown): string => {
  if (typeof value !== 'string' || !/^C[1-9]\d{0,11}$/.test(value)) throw new Error('LCSC code must be an exact C-prefixed positive catalog number');
  return value;
};

export interface CatalogOptions {
  cacheDir?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxResults?: number;
  cacheMaxAgeMs?: number;
  /** Permit supplier metadata with no geometry only after confirmed importer absence. */
  allowMetadataOnly?: boolean;
}
export interface CatalogSearchResult {
  lcsc: string; mpn: string; manufacturer?: string; package?: string; description?: string; stock?: number;
  datasheetUrl?: string;
  catalogReceipt: string;
}
/** Supplier metadata only. Neither getPart nor searchParts fetches this URL. */
function publicHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(host.replace(/^\[|\]$/g, '')) ||
      !host.includes('.') || !/^[a-z0-9.-]+$/.test(host) || host.endsWith('.') ||
      /(^|\.)(localhost|local|internal|test|invalid|example|home|lan|onion)$/.test(host)) return undefined;
    return url.href;
  } catch { return undefined; }
}
const manualUrl = (row: Record<string, any>) => publicHttpsUrl(row.dataManualOfficialLink) ?? publicHttpsUrl(row.dataManualUrl);
export interface CatalogReceipt {
  schema: 'moki.catalog-receipt/1';
  id: string;
  capturedAt: string;
  request: { method: 'GET' | 'POST'; url: string; body?: string };
  response: { status: number; contentType: string | null; bodySha256: string; truncated: boolean };
  /** Exact decoded UTF-8 response, retained even for HTTP/JSON failures. */
  rawBody: string;
}
function settings(options: CatalogOptions) {
  const timeoutMs = options.timeoutMs ?? 10_000, maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
  const maxResults = options.maxResults ?? 8, cacheMaxAgeMs = options.cacheMaxAgeMs ?? 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Catalog timeout must be between 1 and 60000 ms');
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 16 * 1024 * 1024) throw new Error('Invalid catalog response size limit');
  if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 50) throw new Error('Catalog result limit must be between 1 and 50');
  if (!Number.isFinite(cacheMaxAgeMs) || cacheMaxAgeMs < 0 || cacheMaxAgeMs > 7 * 24 * 60 * 60 * 1000) throw new Error('Catalog cache age must be between zero and seven days');
  if (options.allowMetadataOnly !== undefined && typeof options.allowMetadataOnly !== 'boolean') throw new Error('allowMetadataOnly must be boolean');
  return { cacheDir: resolve(options.cacheDir ?? process.env.MOKI_BLOCK_PARTS_DIR ?? 'var/block-parts'), fetch: options.fetch ?? globalThis.fetch,
    timeoutMs, maxResponseBytes, maxResults, cacheMaxAgeMs, allowMetadataOnly: options.allowMetadataOnly ?? true };
}
type Settings = ReturnType<typeof settings>;

function receiptBytes(receipt: Omit<CatalogReceipt, 'id'>): string { return JSON.stringify(receipt); }
async function saveReceipt(data: Omit<CatalogReceipt, 'id'>, config: Settings): Promise<CatalogReceipt> {
  const id = `sha256:${sha(receiptBytes(data))}`, receipt = { ...data, id };
  const bytes = JSON.stringify(receipt), directory = join(config.cacheDir, 'receipts');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${id.slice(7)}.json`);
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8') !== bytes) throw new Error('Immutable catalog receipt conflicts with existing evidence');
  }
  return receipt;
}
export async function loadCatalogReceipt(id: string, options: CatalogOptions = {}): Promise<CatalogReceipt> {
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('Invalid catalog receipt ID');
  const config = settings(options), path = join(config.cacheDir, 'receipts', `${id.slice(7)}.json`);
  let receipt: CatalogReceipt;
  try { receipt = JSON.parse(await readFile(path, 'utf8')) as CatalogReceipt; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Code-owned seed bundles ship their exact captures. A clean deployment
    // must not depend on the author's incidental mutable cache directory.
    // Never use this path to replace a present but corrupt cache record.
    let found: CatalogReceipt | undefined;
    for (const name of ['peripheral-drafts', 'motor-drafts', 'rp2040-drafts', 'usb-buck-drafts']) {
      const bundle = JSON.parse(await readFile(new URL(`./data/${name}.json`, import.meta.url), 'utf8'));
      found = bundle.receipts?.find((r: CatalogReceipt) => r.id === id);
      if (found) break;
    }
    if (!found) throw error;
    receipt = found;
  }
  const { id: storedId, ...data } = receipt;
  if (storedId !== id || receipt.schema !== 'moki.catalog-receipt/1' || `sha256:${sha(receiptBytes(data))}` !== id || sha(receipt.rawBody) !== receipt.response.bodySha256) throw new Error('Catalog receipt integrity check failed');
  return receipt;
}
async function request(url: string, config: Settings, body?: string): Promise<CatalogReceipt> {
  const method = body === undefined ? 'GET' : 'POST';
  const response = await config.fetch(url, { method, body, redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) } });
  const chunks: Uint8Array[] = []; let size = 0, truncated = false;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        if (size + value.length > config.maxResponseBytes) {
          const remaining = config.maxResponseBytes - size; if (remaining) chunks.push(value.subarray(0, remaining));
          truncated = true; await reader.cancel(); break;
        }
        chunks.push(value); size += value.length;
      }
    } finally { reader.releaseLock(); }
  }
  // Only JSON/text endpoints are fetched; reject undecodable bytes rather than rewriting evidence.
  const rawBody = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  return saveReceipt({ schema: 'moki.catalog-receipt/1', capturedAt: new Date().toISOString(), request: { method, url, ...(body === undefined ? {} : { body }) },
    response: { status: response.status, contentType: response.headers.get('content-type'), bodySha256: sha(rawBody), truncated }, rawBody }, config);
}
function json(receipt: CatalogReceipt): any {
  if (receipt.response.truncated) throw new Error('Catalog response exceeded the size limit');
  if (receipt.response.status < 200 || receipt.response.status >= 300) throw new Error(`Catalog HTTP ${receipt.response.status}`);
  try { return JSON.parse(receipt.rawBody); } catch { throw new Error('Catalog returned invalid JSON'); }
}
function indexPath(config: Settings, key: string) { return join(config.cacheDir, 'index', `${sha(key)}.json`); }
async function cached(key: string, config: Settings): Promise<CatalogReceipt | undefined> {
  if (!config.cacheMaxAgeMs) return undefined;
  try {
    const index = JSON.parse(await readFile(indexPath(config, key), 'utf8'));
    const receipt = await loadCatalogReceipt(index.catalogReceipt, { ...config });
    const age = Date.now() - Date.parse(receipt.capturedAt);
    if (Number.isFinite(age) && age >= 0 && age < config.cacheMaxAgeMs) return receipt;
  } catch { /* Missing/corrupt/stale indexes cannot provide trusted catalog data. */ }
  return undefined;
}
async function remember(key: string, receipt: CatalogReceipt, config: Settings) {
  const file = indexPath(config, key), temp = `${file}.${randomUUID()}.tmp`;
  await mkdir(join(config.cacheDir, 'index'), { recursive: true });
  try { await writeFile(temp, JSON.stringify({ catalogReceipt: receipt.id }), { mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}

function results(receipt: CatalogReceipt, query: string, config: Settings): CatalogSearchResult[] {
  const data = json(receipt), primary = receipt.request.url.startsWith(`${SEARCH}?`);
  const requestedQuery = primary ? new URL(receipt.request.url).searchParams.get('q') : JSON.parse(receipt.request.body ?? '{}').keyword;
  if (requestedQuery !== query || (!primary && receipt.request.url !== JLC_SEARCH)) throw new Error('Catalog search receipt query mismatch');
  const rows = primary ? data.components : data.code === 200 ? data.data?.componentPageInfo?.list : undefined;
  if (!Array.isArray(rows)) throw new Error('Catalog search response has no successful result list');
  const found = new Map<string, CatalogSearchResult>();
  for (const row of rows) {
    if (!record(row)) continue;
    const id = primary && Number.isSafeInteger(row.lcsc) && row.lcsc > 0 ? `C${row.lcsc}` : row.componentCode;
    const mpn = string(primary ? row.mfr : row.componentModelEn);
    try { code(id); } catch { continue; }
    if (!mpn) continue;
    found.set(id, { lcsc: id, mpn, manufacturer: string(primary ? row.manufacturer : row.componentBrandEn), package: string(primary ? row.package : row.componentSpecificationEn),
      description: string(primary ? row.description : row.describe), stock: stock(primary ? row.stock : row.stockCount),
      datasheetUrl: primary ? undefined : manualUrl(row), catalogReceipt: receipt.id });
    if (found.size >= config.maxResults) break;
  }
  if (rows.length && !found.size) throw new Error('Catalog search contained no valid catalog identities');
  return [...found.values()];
}
export async function searchParts(query: string, options: CatalogOptions = {}): Promise<CatalogSearchResult[]> {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120 || /[\x00-\x1f\x7f]/.test(query)) throw new Error('Part search must contain 2–120 printable characters');
  query = query.trim(); const config = settings(options), key = `search/1/${config.maxResults}/${query}`;
  const hit = await cached(key, config);
  if (hit) {
    try { const found = results(hit, query, config); if (found.length || hit.request.url === JLC_SEARCH) return found; }
    catch { /* Re-query invalid indexes. */ }
  }
  const errors: string[] = [];
  for (const [url, body] of [[`${SEARCH}?${new URLSearchParams({ q: query, limit: String(config.maxResults) })}`, undefined],
    [JLC_SEARCH, JSON.stringify({ keyword: query, currentPage: 1, pageSize: config.maxResults })]] as const) {
    try {
      const receipt = await request(url, config, body), found = results(receipt, query, config);
      // The indexed catalog is a subset. A valid empty response still gets a broader supplier lookup.
      if (!found.length && body === undefined) continue;
      await remember(key, receipt, config); return found;
    }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  throw new Error(`Part search unavailable: ${errors.join('; ')}`);
}

function objectData(value: unknown, label: string): Record<string, any> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new Error(`Invalid importer ${label}`); } }
  if (!record(value)) throw new Error(`Missing importer ${label}`); return value;
}
class GeometryUnavailable extends Error {
  constructor(readonly mpn: string) { super('Importer geometry is explicitly unavailable'); }
}
function supplierPart(receipt: CatalogReceipt, lcsc: string): CatalogPart {
  if (receipt.request.method !== 'POST' || receipt.request.url !== JLC_SEARCH || JSON.parse(receipt.request.body ?? '{}').keyword !== lcsc) throw new Error('Metadata supplier receipt request mismatch');
  const body = json(receipt), rows = body.code === 200 ? body.data?.componentPageInfo?.list : undefined;
  if (!Array.isArray(rows)) throw new Error('Supplier metadata has no successful catalog list');
  const exact = rows.filter(row => record(row) && row.componentCode === lcsc);
  if (exact.length !== 1 || !string(exact[0].componentModelEn)) throw new Error('Supplier metadata requires one exact LCSC identity and MPN');
  const row = exact[0], url = manualUrl(row);
  return { lcsc, mpn: string(row.componentModelEn)!, manufacturer: string(row.componentBrandEn), package: string(row.componentSpecificationEn), description: string(row.describe), stock: stock(row.stockCount),
    catalogReceipt: receipt.id, importer: 'jlcpcb-metadata-only', rawSha256: receipt.response.bodySha256, footprintSha256: '', pins: [], models: [],
    ...(url ? { datasheetUrl: url, datasheetReceipt: receipt.id } : {}) };
}
function imported(receipt: CatalogReceipt, lcsc: string): CatalogPart {
  if (receipt.request.method !== 'GET' || receipt.request.url !== `${IMPORTER}${lcsc}`) throw new Error('Importer receipt request mismatch');
  const envelope = json(receipt), details = envelope.easyeda_component_details;
  if (!record(details) || details.lcsc !== Number(lcsc.slice(1))) throw new Error('Importer LCSC identity mismatch');
  const component = objectData(details.easyeda_json, 'component');
  if (component.lcsc?.number !== lcsc || (component.szlcsc?.number !== undefined && component.szlcsc.number !== lcsc)) throw new Error('Importer LCSC identity mismatch');
  if (typeof details.easyeda_uuid !== 'string' || details.easyeda_uuid !== component.uuid) throw new Error('Importer component UUID mismatch');
  const symbol = objectData(component.dataStr, 'symbol');
  const mpn = string(symbol.head?.c_para?.['Manufacturer Part']) ?? string(component.title);
  // Catalog display titles can add spaces around suffixes. Keep the supplier MPN verbatim;
  // only comparison ignores whitespace, without weakening punctuation or supplier-ID checks.
  const titleForComparison = string(component.title)?.replace(/\s+/g, '');
  const mpnForComparison = mpn?.replace(/\s+/g, '');
  // One audited catalog alias: TI's PWP package display name omits its reel suffix.
  // Bind the exception to the exact supplier, symbol and footprint identities;
  // this is deliberately not a general R/TR suffix normalization rule.
  // Evidence: 2026-11-06-chip-live/evidence/chip_eda/motor/drv8833-import-receipt.json
  const tiPwpReel = lcsc === 'C50506' && component.title === 'DRV8833PWP' && mpn === 'DRV8833PWPR'
    && component.uuid === '45436c08a4eb421789f0595cfd35863a'
    && symbol.head?.c_para?.['Supplier Part'] === lcsc
    && symbol.head?.puuid === '558b71b9c87a4a7fb849ca445194ba81'
    && component.packageDetail?.uuid === '558b71b9c87a4a7fb849ca445194ba81';
  if (!mpn || (titleForComparison !== mpnForComparison && titleForComparison !== `${mpnForComparison}_${lcsc}` && !tiPwpReel)) throw new Error('Importer manufacturer part number mismatch');
  if (!Array.isArray(symbol.shape)) throw new Error('Importer has malformed symbol geometry');
  if (component.packageDetail === undefined || component.packageDetail === null) throw new GeometryUnavailable(mpn);
  if (symbol.head?.puuid && symbol.head.puuid !== component.packageDetail.uuid) throw new Error('Importer footprint UUID mismatch');
  if (component.packageDetail.dataStr === undefined || component.packageDetail.dataStr === null) throw new GeometryUnavailable(mpn);
  const geometry = objectData(component.packageDetail.dataStr, 'footprint');
  if (!Array.isArray(geometry.shape)) throw new Error('Importer has malformed footprint geometry');
  if (!geometry.shape.length) throw new GeometryUnavailable(mpn);
  const pads = new Set(geometry.shape.filter((s: unknown): s is string => typeof s === 'string' && s.startsWith('PAD~')).map((s: string) => s.split('~')[8]));
  const pins = new Map<string, Set<string>>();
  for (const shape of symbol.shape) {
    if (typeof shape !== 'string' || !shape.startsWith('P~')) continue;
    const sections = shape.split('^^'), physical = sections[4]?.split('~')[4]?.trim();
    // Match the pinned EasyEDA parser: displayed physical pin number takes precedence
    // over stale SPICE/header numbering (actual WS2812B-V5/W has DIN header 3, pad 4).
    const pad = physical && !['undefined', 'null'].includes(physical.toLowerCase()) ? physical : sections[0]?.split('~')[3];
    const label = sections[3]?.split('~')[4];
    if (!pad || !pads.has(pad)) throw new Error('Importer symbol pin has no matching physical pad');
    if (!pins.has(pad)) pins.set(pad, new Set()); if (label) pins.get(pad)!.add(label);
  }
  if (!pins.size) throw new Error('Importer has no identifiable symbol pins');
  const uuid = string(geometry.head?.uuid_3d), models: CatalogPart['models'] = [];
  if (uuid) {
    if (!/^[a-f0-9]{32}$/i.test(uuid)) throw new Error('Invalid importer model UUID');
    models.push({ format: 'obj', url: `https://modules.easyeda.com/3dmodel/${uuid}` }, { format: 'step', url: `https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/${uuid}` });
  }
  return { lcsc, mpn, manufacturer: string(symbol.head?.c_para?.Manufacturer), package: string(component.packageDetail?.title) ?? string(symbol.head?.c_para?.package),
    description: string(component.description), stock: stock(component.lcsc?.stock), catalogReceipt: receipt.id, importer: 'tscircuit-jlcsearch-easyeda-cache',
    rawSha256: receipt.response.bodySha256, footprintSha256: sha(canonical(geometry)), pins: [...pins].map(([pad, labels]) => ({ pad, labels: [...labels] })), models };
}
/** Internal receipt decoder: callers first load the immutable receipt with loadCatalogReceipt. */
export function catalogPartFromReceipt(receipt: CatalogReceipt, lcsc: string): CatalogPart {
  code(lcsc); return receipt.request.url === JLC_SEARCH ? supplierPart(receipt, lcsc) : imported(receipt, lcsc);
}
/** Availability evidence is separate from the supplier identity receipt. */
export function importerUnavailable(receipt: CatalogReceipt, lcsc: string, mpn: string): boolean {
  if (receipt.request.method !== 'GET' || receipt.request.url !== `${IMPORTER}${code(lcsc)}` || receipt.response.truncated) return false;
  if (receipt.response.status === 404) return true;
  try { imported(receipt, lcsc); } catch (error) { return error instanceof GeometryUnavailable && error.mpn.replace(/\s+/g, '') === mpn.replace(/\s+/g, ''); }
  return false;
}
export async function getPart(lcsc: string, options: CatalogOptions = {}): Promise<CatalogPart> {
  code(lcsc); const config = settings(options), key = `part/1/${lcsc}`;
  let part: CatalogPart | undefined;
  const hit = await cached(key, config); if (hit) { try { part = imported(hit, lcsc); } catch { /* Revalidate using the actual importer. */ } }
  if (!part) {
    const receipt = await request(`${IMPORTER}${lcsc}`, config);
    try {
      if (receipt.response.status === 404 && !receipt.response.truncated) throw new GeometryUnavailable('');
      part = imported(receipt, lcsc);
    } catch (error) {
      if (!config.allowMetadataOnly || !(error instanceof GeometryUnavailable)) throw error;
      const key = `manual/1/${lcsc}`;
      let supplier = await cached(key, config), metadata: CatalogPart | undefined;
      if (supplier) { try { metadata = supplierPart(supplier, lcsc); } catch { supplier = undefined; } }
      if (!metadata) {
        supplier = await request(JLC_SEARCH, config, JSON.stringify({ keyword: lcsc, currentPage: 1, pageSize: config.maxResults }));
        metadata = supplierPart(supplier, lcsc); await remember(key, supplier, config);
      }
      if (error.mpn && metadata.mpn.replace(/\s+/g, '') !== error.mpn.replace(/\s+/g, '')) throw new Error('Unavailable importer and supplier MPN mismatch');
      // Do not cache absence as an imported part; retry its fixed importer next time.
      return { ...metadata, importerUnavailableReceipt: receipt.id };
    }
    await remember(key, receipt, config);
  }
  // Raw importer geometry can contain unrelated footprint hyperlinks. Only an exact
  // supplier identity match authorizes datasheet metadata; keep its evidence separate.
  const manualKey = `manual/1/${lcsc}`;
  let manualReceipt: CatalogReceipt | undefined, rows: CatalogSearchResult[] | undefined;
  try {
    manualReceipt = await cached(manualKey, config);
    if (manualReceipt) rows = results(manualReceipt, lcsc, config);
  } catch { manualReceipt = undefined; }
  if (!rows) {
    try {
      manualReceipt = await request(JLC_SEARCH, config, JSON.stringify({ keyword: lcsc, currentPage: 1, pageSize: config.maxResults }));
      rows = results(manualReceipt, lcsc, config);
      await remember(manualKey, manualReceipt, config);
    } catch { return part; } // Optional metadata unavailable; never fabricate a URL.
  }
  const exact = rows.find(row => row.lcsc === lcsc);
  if (exact && exact.mpn.replace(/\s+/g, '') !== part.mpn.replace(/\s+/g, '')) throw new Error('Catalog datasheet manufacturer part number mismatch');
  return exact?.datasheetUrl ? { ...part, datasheetUrl: exact.datasheetUrl, datasheetReceipt: manualReceipt!.id } : part;
}
