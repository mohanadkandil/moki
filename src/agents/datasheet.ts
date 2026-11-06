// Datasheets as evidence. A model reads pages from here, and code checks each quote it cites against the page,
// so a citation can't be invented. Text from a PDF is untrusted data: it can't change any agent's instructions.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { join, resolve } from 'node:path';

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_PAGES_PER_READ = 4;
const MAX_CHARS_PER_READ = 16_000;
const MAX_TEXT_CHARS = 4_000_000;
const MAX_IN_MEMORY = 24;
/** LCSC answers 403 to a request that names no client. This says plainly what's asking, with no contact details. */
const CLIENT = 'Moki-datasheet-reader/1.0';

export interface Datasheet { url: string; sha256: string; pages: string[] }
export interface DatasheetRead { pageCount: number; warning?: string; note?: string; found?: { page: number; near: string }[]; pages?: { page: number; text: string }[] }
export interface DatasheetStore {
  load(url: string, signal?: AbortSignal): Promise<Datasheet>;
}

/** Anything not plainly on the public internet counts as private, including address forms nobody expected. */
export function privateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 6) {
    const low = address.toLowerCase();
    // Only global unicast, minus the ranges that wrap an IPv4 address or tunnel somewhere else.
    if (!/^[23][0-9a-f]{0,3}:/.test(low)) return true;
    return /^2002:/.test(low) || /^2001:(?:0*:|0{1,4}:|db8:)/.test(low);
  }
  if (kind !== 4) return true;
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * A plain fetch would look the name up again after the check, so a hostile DNS server could answer differently the
 * second time. This checks the address the connection really uses.
 */
const pinnedFetch: typeof fetch = (input, init) => new Promise((done, fail) => {
  const url = new URL(String(input));
  const req = httpsRequest(url, {
    method: 'GET',
    headers: { 'User-Agent': CLIENT, Accept: 'application/pdf, text/html;q=0.8' },
    lookup: (host, options, callback) => {
      lookup(host, { all: true }).then(found => {
        const safe = found.filter(a => !privateAddress(a.address));
        if (!safe.length || safe.length !== found.length) { callback(new Error('Datasheets are read from public hosts only.'), '', 4); return; }
        if ((options as { all?: boolean }).all) (callback as unknown as (e: null, a: typeof safe) => void)(null, safe);
        else callback(null, safe[0]!.address, safe[0]!.family);
      }, error => callback(error as NodeJS.ErrnoException, '', 4));
    },
    ...(init?.signal ? { signal: init.signal } : {}),
  }, res => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(res.headers)) if (typeof value === 'string') headers.set(name, value);
    const status = res.statusCode ?? 502;
    done(new Response(status >= 300 && status < 400 ? (res.resume(), null) : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers }));
  });
  req.on('error', fail);
  req.end();
});

/**
 * A catalog datasheet link on lcsc.com is a page, even though it ends in .pdf. The page names the real file, for
 * the same part number. Only that exact shape is followed, so a page can't send this anywhere else.
 */
export function lcscPdfUrl(page: string, from: URL): string | null {
  if (from.hostname !== 'lcsc.com' && !from.hostname.endsWith('.lcsc.com')) return null;
  const part = /_(C\d+)\.pdf$/i.exec(from.pathname)?.[1];
  const link = /https:\/\/datasheet\.lcsc\.com\/datasheet\/pdf\/[a-f0-9]{16,64}\.pdf\?productCode=(C\d+)/.exec(page);
  return link && part && link[1]!.toUpperCase() === part.toUpperCase() ? link[0] : null;
}

/** A datasheet URL comes from a catalog response, but this runs on the server, so it may only reach the public web. */
export async function checkDatasheetUrl(text: string, resolver: (host: string) => Promise<string[]> = async host => (await lookup(host, { all: true })).map(a => a.address)): Promise<URL> {
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('That is not a datasheet URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Datasheets are read over plain HTTPS only.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Datasheets are read from public hosts only.');
  const addresses = await resolver(host);
  if (!addresses.length || addresses.some(privateAddress)) throw new Error('Datasheets are read from public hosts only.');
  return url;
}

async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const pages: string[] = [];
    let total = 0;
    for (let number = 1; number <= Math.min(document.numPages, 400) && total < MAX_TEXT_CHARS; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join('').replace(/[ \t]+/g, ' ').trim());
      total += pages.at(-1)!.length;
      page.cleanup();
    }
    return pages;
  } finally { await document.destroy(); }
}

export function datasheetStore(options: { dir?: string; fetch?: typeof fetch; extract?: (bytes: Uint8Array) => Promise<string[]>; resolver?: (host: string) => Promise<string[]>; timeoutMs?: number } = {}): DatasheetStore {
  const dir = resolve(options.dir ?? 'var/datasheets');
  const get = options.fetch ?? pinnedFetch;
  const extract = options.extract ?? pdfPages;
  const memory = new Map<string, Promise<Datasheet>>();
  async function download(url: string): Promise<Datasheet> {
    const key = createHash('sha256').update(url).digest('hex');
    const file = join(dir, `${key}.json`);
    const saved = await readFile(file, 'utf8').then(text => JSON.parse(text) as Datasheet).catch(() => null);
    if (saved) return saved;
    let target = await checkDatasheetUrl(url, options.resolver);
    for (let hop = 0; ; hop++) {
      const response = await get(target, { redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? 30_000) });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        await response.body?.cancel();
        if (hop >= MAX_REDIRECTS) throw new Error('The datasheet link redirects too many times.');
        target = await checkDatasheetUrl(new URL(response.headers.get('location')!, target).href, options.resolver);
        continue;
      }
      if (!response.ok || !response.body) throw new Error(`The datasheet host answered HTTP ${response.status}.`);
      if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES) { await response.body.cancel(); throw new Error('That datasheet is too large to read.'); }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > MAX_PDF_BYTES) throw new Error('That datasheet is too large to read.');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
        const real = hop < MAX_REDIRECTS ? lcscPdfUrl(bytes.subarray(0, 200_000).toString('utf8'), target) : null;
        if (!real) throw new Error('That link is not a PDF.');
        target = await checkDatasheetUrl(real, options.resolver);
        continue;
      }
      const sheet: Datasheet = { url, sha256: createHash('sha256').update(bytes).digest('hex'), pages: await extract(bytes) };
      await mkdir(dir, { recursive: true });
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, JSON.stringify(sheet), { mode: 0o600 });
      await rename(temporary, file);
      return sheet;
    }
  }
  return {
    // Several readers can wait on one download, so no single reader's abort may cancel it.
    load(url, signal) {
      let pending = memory.get(url);
      if (!pending) {
        pending = download(url);
        memory.set(url, pending);
        pending.catch(() => memory.delete(url));
        for (const old of memory.keys()) { if (memory.size <= MAX_IN_MEMORY) break; memory.delete(old); }
      }
      if (!signal) return pending;
      return Promise.race([pending, new Promise<never>((_, no) => { if (signal.aborted) no(signal.reason); else signal.addEventListener('abort', () => no(signal.reason), { once: true }); })]);
    },
  };
}

const squeeze = (text: string) => text.toLowerCase().replace(/-\s*\n\s*/g, '').replace(/[\s ]+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[µ]/g, 'μ').replace(/[–—]/g, '-').trim();

/** True only when these words are really on that page. A short quote could match anything, so it doesn't count. */
export function quoteOnPage(sheet: Datasheet, page: number, quote: string): boolean {
  const wanted = squeeze(quote);
  if (wanted.length < 12) return false;
  const text = sheet.pages[page - 1];
  return text !== undefined && squeeze(text).includes(wanted);
}

/** Pages for a model to read, and where a search term appears, capped so one read can't flood a turn. */
export function readPages(sheet: Datasheet, input: { pages?: unknown; find?: unknown }): DatasheetRead {
  const total = sheet.pages.length;
  const blank = sheet.pages.filter(p => p.trim().length < 20).length;
  const header = { pageCount: total, ...(total && blank / total > 0.8 ? { warning: 'Most pages have no text layer, so this looks scanned. Quotes from it can’t be verified.' } : {}) };
  if (typeof input.find === 'string' && input.find.trim()) {
    const wanted = squeeze(input.find);
    return { ...header, found: sheet.pages.flatMap((text, i) => { const at = squeeze(text).indexOf(wanted); return at < 0 ? [] : [{ page: i + 1, near: squeeze(text).slice(Math.max(0, at - 80), at + 160) }]; }).slice(0, 12) };
  }
  const asked = Array.isArray(input.pages) ? input.pages.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= total).slice(0, MAX_PAGES_PER_READ) : [];
  if (!asked.length) return { ...header, note: 'Send pages (at most 4 at a time) or find (a word or phrase).' };
  let left = MAX_CHARS_PER_READ;
  return { ...header, pages: asked.map(page => { const text = sheet.pages[page - 1]!.slice(0, left); left -= text.length; return { page, text }; }) };
}
