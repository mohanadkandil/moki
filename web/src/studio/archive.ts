// A ZIP with no compression, written in the browser, so "Download" can hand over every file of a build
// without a server endpoint. The artifacts are small and several are already compressed.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function storedZip(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const records = files.map(f => ({ ...f, path: encoder.encode(f.name), crc: crc32(f.data) }));
  const size = records.reduce((n, r) => n + 30 + r.path.length + r.data.length + 46 + r.path.length, 22);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  const common = (r: (typeof records)[number], base: number) => {
    view.setUint16(base, 20, true); // version needed
    view.setUint16(base + 2, 0x0800, true); // UTF-8 names
    view.setUint16(base + 4, 0, true); // stored
    view.setUint16(base + 6, 0, true); // time
    view.setUint16(base + 8, 0x21, true); // 1980-01-01, so the same files give the same bytes
    view.setUint32(base + 10, r.crc, true);
    view.setUint32(base + 14, r.data.length, true);
    view.setUint32(base + 18, r.data.length, true);
    view.setUint16(base + 22, r.path.length, true);
  };
  for (const r of records) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    common(r, at + 4);
    out.set(r.path, at + 30);
    out.set(r.data, at + 30 + r.path.length);
    at += 30 + r.path.length + r.data.length;
  }
  const directory = at;
  records.forEach((r, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    common(r, at + 6);
    view.setUint32(at + 42, offsets[i]!, true);
    out.set(r.path, at + 46);
    at += 46 + r.path.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, records.length, true);
  view.setUint16(at + 10, records.length, true);
  view.setUint32(at + 12, at - directory, true);
  view.setUint32(at + 16, directory, true);
  return out;
}
