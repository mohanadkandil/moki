// Datasheets as evidence. No network: a fake fetch and a fake PDF extractor.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkDatasheetUrl, datasheetStore, lcscPdfUrl, privateAddress, quoteOnPage, readPages, type Datasheet } from '../src/agents/datasheet.js';

const sheet: Datasheet = { url: 'x', sha256: 'y', pages: ['Cover', 'Typical applica-\ntion: Place a 4.7 µF capacitor\nclose to VIN — always.', ''] };
const publicHost = async () => ['93.184.216.34'];

describe('quote checks', () => {
  it('finds a quote across line breaks, hyphenation and symbol forms', () => {
    assert.ok(quoteOnPage(sheet, 2, 'Typical application: place a 4.7 μF capacitor close to VIN'));
  });
  it('refuses another page, a page that does not exist, a short quote and a changed value', () => {
    assert.ok(!quoteOnPage(sheet, 1, 'Place a 4.7 µF capacitor'));
    assert.ok(!quoteOnPage(sheet, 9, 'Place a 4.7 µF capacitor'));
    assert.ok(!quoteOnPage(sheet, 2, '4.7 µF'));
    assert.ok(!quoteOnPage(sheet, 2, 'Place a 47 µF capacitor'));
  });
});

describe('reading pages', () => {
  it('caps pages and finds words', () => {
    assert.equal(readPages({ ...sheet, pages: Array(9).fill('text of a page') }, { pages: [1, 2, 3, 4, 5, 6] }).pages?.length, 4);
    assert.equal(readPages(sheet, { find: 'capacitor' }).found?.[0]?.page, 2);
    assert.ok(readPages(sheet, {}).note);
    assert.ok(readPages(sheet, { pages: [99] }).note);
  });
  it('warns when a datasheet has no text layer', () => {
    assert.ok(readPages({ ...sheet, pages: ['', '', '', '', ''] }, {}).warning);
  });
});

describe('datasheet URLs', () => {
  for (const url of ['http://example.com/a.pdf', 'file:///etc/passwd', 'https://user:pw@example.com/a.pdf', 'https://example.com:8443/a.pdf', 'https://127.0.0.1/a.pdf', 'https://[::1]/a.pdf', 'https://localhost/a.pdf', 'https://x.internal/a.pdf', 'not a url']) {
    it(`refuses ${url}`, () => assert.rejects(checkDatasheetUrl(url, publicHost)));
  }
  for (const address of ['127.0.0.1', '10.0.0.8', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    it(`refuses a host that resolves to ${address}`, () => assert.rejects(checkDatasheetUrl('https://example.com/a.pdf', async () => ['93.184.216.34', address])));
  }
  it('allows a public host', async () => assert.equal((await checkDatasheetUrl('https://example.com/a.pdf', publicHost)).hostname, 'example.com'));
});

describe('which addresses count as public', () => {
  for (const address of ['::ffff:7f00:1', '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:0:1::', '2001:db8::1', 'fe80::1', '::', '198.18.0.1', '192.0.0.1', 'not an address']) it(`refuses ${address}`, () => assert.equal(privateAddress(address), true));
  for (const address of ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946', '2a00:1450:4001:81b::200e']) it(`allows ${address}`, () => assert.equal(privateAddress(address), false));
});

describe('the store', () => {
  const PDF = new TextEncoder().encode('%PDF-1.7 fake');
  const withDir = async (run: (dir: string) => Promise<void>) => { const dir = await mkdtemp(join(tmpdir(), 'moki-sheets-')); try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); } };
  const pdf = () => new Response(PDF, { status: 200 });
  it('caches, so a second read makes no request', () => withDir(async dir => {
    let requests = 0;
    const options = { dir, resolver: publicHost, extract: async () => ['One'], fetch: (async () => { requests++; return pdf(); }) as typeof fetch };
    assert.deepEqual((await datasheetStore(options).load('https://example.com/a.pdf')).pages, ['One']);
    assert.deepEqual((await datasheetStore(options).load('https://example.com/a.pdf')).pages, ['One']);
    assert.equal(requests, 1);
  }));
  it('doesn\'t let one reader\'s abort cancel another\'s download', () => withDir(async dir => {
    let release!: (r: Response) => void;
    const options = { dir, resolver: publicHost, extract: async () => ['One'], fetch: (() => new Promise<Response>(r => { release = r; })) as unknown as typeof fetch };
    const store = datasheetStore(options);
    const leaving = new AbortController();
    const first = store.load('https://example.com/shared.pdf', leaving.signal);
    const second = store.load('https://example.com/shared.pdf');
    await new Promise(r => setTimeout(r, 5));
    leaving.abort();
    await assert.rejects(first);
    release(pdf());
    assert.deepEqual((await second).pages, ['One']);
  }));
  it('checks every redirect, so a public link can\'t reach this server', () => withDir(async dir => {
    const fetcher = (async () => new Response(null, { status: 302, headers: { location: 'https://internal.example/a.pdf' } })) as typeof fetch;
    const resolver = async (host: string) => (host === 'internal.example' ? ['10.0.0.1'] : ['93.184.216.34']);
    await assert.rejects(datasheetStore({ dir, resolver, fetch: fetcher }).load('https://example.com/a.pdf'), /public hosts/);
  }));
  it('follows an LCSC page to the real file for that part, and nothing else', () => withDir(async dir => {
    const asked: string[] = [];
    const real = 'https://datasheet.lcsc.com/datasheet/pdf/3dad1d8f987a4e00bfc677055df1f959.pdf?productCode=C2040';
    const fetcher = (async (url: URL) => { asked.push(String(url)); return String(url) === real ? new Response('%PDF-1.7 x') : new Response(`<html><a href="${real}">`); }) as unknown as typeof fetch;
    const from = 'https://www.lcsc.com/datasheet/lcsc_datasheet_2201101600_Raspberry-Pi-RP2040_C2040.pdf';
    assert.deepEqual((await datasheetStore({ dir, resolver: publicHost, extract: async () => ['One'], fetch: fetcher }).load(from)).pages, ['One']);
    assert.deepEqual(asked, [from, real]);
    assert.equal(lcscPdfUrl(`<script>window.top.location.href='${real}'</script>`, new URL('https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/x_C2040.pdf')), real, 'the other page shape');
    assert.equal(lcscPdfUrl(`<a href="${real}">`, new URL('https://www.lcsc.com/datasheet/x_C9999.pdf')), null, 'another part');
    assert.equal(lcscPdfUrl(`<a href="${real}">`, new URL('https://example.com/x_C2040.pdf')), null, 'another host');
    assert.equal(lcscPdfUrl('<a href="https://evil.example/datasheet/pdf/abcdefabcdefabcdef.pdf?productCode=C2040">', new URL(from)), null, 'a link elsewhere');
  }));
  it('refuses a page that is not a PDF, a failed answer and endless redirects', () => withDir(async dir => {
    const store = (answer: () => Response) => datasheetStore({ dir, resolver: publicHost, fetch: (async () => answer()) as typeof fetch });
    await assert.rejects(store(() => new Response('<html>')).load('https://example.com/b.pdf'), /not a PDF/);
    await assert.rejects(store(() => new Response('', { status: 404 })).load('https://example.com/c.pdf'), /HTTP 404/);
    await assert.rejects(store(() => new Response(null, { status: 302, headers: { location: 'https://example.com/d.pdf' } })).load('https://example.com/d.pdf'), /redirects/);
  }));
});
