/** Deterministic, data-only unreviewed circuit drafts. No native layout/build or promotion. */
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerPart } from '../../src/blocks/library.js';
import { loadCatalogReceipt, searchParts, type CatalogReceipt } from '../../src/blocks/catalog.js';
import { checkBlockDraft } from '../../src/blocks/erc.js';
import type { BlockDraft, BlockPart, CatalogPart, Citation, GateResult } from '../../src/blocks/contract.js';

export interface PeripheralDraftBundle {
  schema: 'moki.peripheral-drafts/1'; drafts: BlockDraft[]; catalog: CatalogPart[];
  receipts: CatalogReceipt[]; gates: Array<{ id: string; results: GateResult[] }>; notes: string[];
}
const base = 'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/audio-led-research';
const mic: Citation = { url: 'https://d17t6iyxenbwp1.cloudfront.net/s3fs-public/2026-03/DS-000069-ICS-43434-v1.2.pdf?VersionId=W5u1f2s5LpMkDjoZSc3k7UxneMl9.WkV', sha256: '6f87312bec5078aef44866f4e765137aad0a085b144f3a4f27d697f28f68b0c8', pages: '4–6, 10, 12–15', note: 'TDK DS-000069 v1.2: pins, 100nF X7R bypass, LR low for left slot, SD100k to GND. 48kHz/64BCLK per frame. Current0.49/0.55mA table is specified at1.8V,no load; selected3.3V budget remains an estimate. Official product marks EOL.' };
const amp: Citation = { url: 'https://www.analog.com/media/en/technical-documentation/data-sheets/MAX98357A-MAX98357B.pdf', pages: '1, 4, 6, 15, 17, 28–29, 33', note: 'MAX98357A TQFN I2S, 100nF+10uF bypass; GAIN=GND gives12dB; SD_MODE=VDD enables left channel. Retained manufacturer Rev11 mirror compared with Rev16 primary. 8ohm speaker >10uH; output neither grounded.' };
const led: Citation = { url: 'https://world-semi.com/web/userfiles/productfile/WS2812B_V5WDatasheet_V6.1_EN.pdf', sha256: '652e7bc44abd2d4ba24991a403f48bbc64593ea3af7fc92e153b215c50a511af', pages: '1–3', note: 'Worldsemi V5/W: pins1VDD2DOUT3VSS4DIN, VIH=.63VDD, reset>280us, 12mA/channel characterization. 3.7–5.3V is labeled absolute ratings; operating-range ambiguity requires review.' };
const buffer: Citation = { url: 'https://www.ti.com/lit/ds/symlink/sn74ahct1g125.pdf', pages: '3–5, 10', note: 'TI RevP: /OE1,A2,GND3,Y4,VCC5. Supply4.5–5.5V, VIH2V, VOH>=3.8V at specified4.5V/8mA test; 100nF bypass. DeltaICC1.5mA max at3.4V input/5.5V rail plus dynamic Cpd14pF is why the author reserves3mA buffer draw rather than1mA.' };
const passive = (pad: string): BlockPart['pins'][string] => ({ pad, role: 'passive' });
const pin = (pad: string, role: BlockPart['pins'][string]['role'], required = true, max?: number): BlockPart['pins'][string] => ({ pad, role, ...(required ? { required: true } : {}), ...(max === undefined ? {} : { volts: { min: 0, max } }) });

export function buildPeripheralDrafts(catalog: Map<string, CatalogPart>): BlockDraft[] {
  const part = (ref: string, lcsc: string, citation: Citation, pins: BlockPart['pins'], x: number, y: number, value?: string, why?: string): BlockPart => {
    const c = catalog.get(lcsc); if (!c) throw new Error(`Missing actual catalog part ${lcsc}`);
    return { ref, lcsc, mpn: c.mpn, catalogReceipt: c.catalogReceipt, datasheet: citation, pinout: 'verified', pins, at: { x, y }, ...(value ? { value, valueWhy: { ...citation, ...(why ? { note: why } : {}) } } : {}) };
  };
  const cap = (ref: string, citation: Citation, x: number, y: number, ten = false) => part(ref, ten ? 'C162430' : 'C14663', citation, { A: passive('1'), B: passive('2') }, x, y, ten ? '10uF' : '100nF', ten ? 'Manufacturer reference10uF; actual catalog Murata10uF16VX7R0805 nominal. Verify effective capacitance after DC bias; nominal-only ERC is not physical validation.' : citation.note);
  const resistor = (ref: string, citation: Citation, x: number, y: number, hundred = false) => part(ref, hundred ? 'C25803' : 'C25804', citation, { A: passive('1'), B: passive('2') }, x, y, hundred ? '100kOhm' : '10kOhm');
  const blank = (id: string, title: string, cls: string, summary: string): BlockDraft => ({ schema: 'moki.block/1', id, version: 1, title, class: cls, summary, provenance: { author: 'agent', authorId: 'chip_eda-peripherals' }, parts: [], nets: [], params: [], ports: [], power: { sources: [], sinks: [] }, constraints: [] });
  const ground = (pin: string, citation: Citation): BlockDraft['constraints'][number] => ({ kind: 'ground', pin, citation });
  const dec = (ic: string, powerPin: string, groundPin: string, caps: string[], minUf: number, citation: Citation): BlockDraft['constraints'][number] => ({ kind: 'decoupling', ic, powerPin, groundPin, caps, minUf, maxDistanceMm: 3, citation });

  const m = blank('i2s-mic-ics43434', 'ICS-43434 I2S microphone (EOL)', 'i2s_mic', '3.3V left-slot I2S microphone; EOL lifecycle warning. Bottom acoustic PCB hole/clearance and enclosure opening still need geometry review. 48kHz/64BCLK, no MCLK. Reserved0.53/0.60mA estimates the1.8V manufacturer0.49/0.55mA table plus SD100k loading; worst-case3.3V current is not independently verified.');
  m.parts = [part('U1', 'C5656610', mic, { WS: pin('1', 'input', true, 3.6), LR: pin('2', 'input', true, 3.6), GND: pin('3', 'ground'), SCK: pin('4', 'input', true, 3.6), VDD: { ...pin('5', 'power-in'), volts: { min: 1.65, max: 3.63 } }, SD: pin('6', 'output', true, 3.6) }, 0, 0), cap('C1', mic, 2, 0), resistor('R1', mic, 0, 2, true)];
  m.nets = [{ name: 'V3V3', pins: ['U1.VDD', 'C1.A'] }, { name: 'GND', pins: ['U1.GND', 'U1.LR', 'C1.B', 'R1.B'] }, { name: 'BCLK', pins: ['U1.SCK'] }, { name: 'WS', pins: ['U1.WS'] }, { name: 'SD', pins: ['U1.SD', 'R1.A'] }];
  m.ports = [{ id: 'V3V3', label: '3.3V', kind: 'power-in', terminal: 'net:V3V3', volts: { min: 3, max: 3.6 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:GND' }, { id: 'I2S_MIC', label: 'I2S microphone', kind: 'bus', bus: { protocol: 'i2s', role: 'peripheral', signals: { BCLK: 'net:BCLK', WS: 'net:WS', SD: 'net:SD' } } }];
  m.constraints = [dec('U1', 'VDD', 'GND', ['C1'], .1, mic), ground('U1.GND', mic), { kind: 'strap', pin: 'U1.LR', safe: 'low', to: 'net:GND', citation: mic }];
  m.power.sinks = [{ port: 'V3V3', typicalMa: .53, peakMa: .6 }];
  m.firmware = { libs: [], includes: ['Arduino.h', 'driver/i2s.h'], usage: 'ESP32 Arduino core I2S driver,48kHz stereo with64BCLK/frame (3.072MHz),24-bit left-slot SD in32-bit slots; LR is fixedGND. MCU provides BCLK/WS and reads SD; no MCLK. Other MCU families need their own core driver. SD100k-to-GND discharges tri-state bus; bottom acoustic opening and EOL sourcing remain unreviewed.' };

  const a = blank('i2s-amp-max98357a', 'MAX98357A + differential speaker header', 'i2s_amp', 'Always-enabled LEFT I2S channel,12dB gain,5V rail,8ohm speaker only (>10uH). Audio operating budget380mA/500mA is an author assumption for1.4W continuous/1.8W distortion-limited peaks at80% assumed efficiency and4.75V minimum input, not an IC current rating or measurement. Speaker/thermal/EMI must be reviewed.');
  const ampPins: BlockPart['pins'] = { DIN: pin('1', 'input', true, 3.6), GAIN: pin('2', 'input', true, 5.5), GND3: pin('3', 'ground'), SD_MODE: pin('4', 'input', true, 5.5), NC5: pin('5', 'nc', false), NC6: pin('6', 'nc', false), VDD7: { ...pin('7', 'power-in'), volts: { min: 2.5, max: 5.5 } }, VDD8: { ...pin('8', 'power-in'), volts: { min: 2.5, max: 5.5 } }, OUTP: pin('9', 'output'), OUTN: pin('10', 'output'), GND11: pin('11', 'ground'), NC12: pin('12', 'nc', false), NC13: pin('13', 'nc', false), WS: pin('14', 'input', true, 3.6), GND15: pin('15', 'ground'), BCLK: pin('16', 'input', true, 3.6), EP: pin('17', 'ground') };
  const speakerCatalog = catalog.get('C131337')!;
  const speaker: Citation = { url: speakerCatalog.datasheetUrl!, pages: '1', note: 'Actual JST PH2mm2pin B2B-PH-K-S header, catalog2A contact rating; contract1OUTP2OUTN, neither ground. External8ohm speaker and cable must match; no speaker driver/transducer selected.' };
  if (!speaker.url) throw new Error('Speaker connector needs its actual supplier-provided datasheet URL');
  a.parts = [part('U1', 'C910544', amp, ampPins, 0, 0), cap('C1', amp, 2, 0), cap('C2', amp, 0, -2, true), part('J1', 'C131337', speaker, { P: passive('1'), N: passive('2') }, 5, 0)];
  a.nets = [{ name: 'V5', pins: ['U1.VDD7', 'U1.VDD8', 'U1.SD_MODE', 'C1.A', 'C2.A'] }, { name: 'GND', pins: ['U1.GND3', 'U1.GND11', 'U1.GND15', 'U1.EP', 'U1.GAIN', 'C1.B', 'C2.B'] }, { name: 'BCLK', pins: ['U1.BCLK'] }, { name: 'WS', pins: ['U1.WS'] }, { name: 'DIN', pins: ['U1.DIN'] }, { name: 'SPK_P', pins: ['U1.OUTP', 'J1.P'] }, { name: 'SPK_N', pins: ['U1.OUTN', 'J1.N'] }];
  a.ports = [{ id: 'V5', label: '5V speaker supply', kind: 'power-in', terminal: 'net:V5', volts: { min: 4.75, max: 5.25 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:GND' }, { id: 'I2S_AMP', label: 'I2S speaker input', kind: 'bus', bus: { protocol: 'i2s', role: 'peripheral', signals: { BCLK: 'net:BCLK', WS: 'net:WS', SD: 'net:DIN' } } }];
  a.constraints = [dec('U1', 'VDD7', 'GND3', ['C1', 'C2'], 10.1, amp), dec('U1', 'VDD8', 'GND3', ['C1', 'C2'], 10.1, amp), ...['GND3', 'GND11', 'GND15', 'EP'].map(p => ground(`U1.${p}`, amp)), { kind: 'strap', pin: 'U1.GAIN', safe: 'low', to: 'net:GND', citation: amp }, { kind: 'strap', pin: 'U1.SD_MODE', safe: 'high', to: 'net:V5', citation: amp }];
  a.power.sinks = [{ port: 'V5', typicalMa: 380, peakMa: 500 }];
  a.firmware = { libs: [], includes: ['Arduino.h', 'driver/i2s.h'], usage: 'ESP32 Arduino core I2S driver,48kHz64BCLK/frame. MCU drives BCLK/WS/SD; MAX98357A consumes standardI2S (not B variant left-justified). SD_MODE is physically VDD:LEFT and always enabled; no shutdown GPIO. GAIN is GND:12dB. Output silence with zero samples; no software shutdown claim. External8ohm speaker connects only J1P/J1N, neverGND; keep rail/load within conditional audio budget and independently verify thermal/EMI/rail sequencing.' };

  const w = blank('ws2812b-v5-levelshift', 'WS2812B-V5/W + AHCT level translator', 'addressable_led', 'Single5V WS2812B-V5/W with explicit3.3V-to5V AHCT buffer. Budget39mA/63mA is a conservative author reservation (60mA LED+3mA buffer), not guaranteed LED max or measured consumption. V5 absolute/operating-range ambiguity and firmware timing still need review.');
  w.parts = [part('D1', 'C2874885', led, { VDD: { ...pin('1', 'power-in'), volts: { min: 4.5, max: 5.3 } }, DOUT: pin('2', 'output', false, 5.3), GND: pin('3', 'ground'), DIN: pin('4', 'input', true, 5.3) }, 0, 0), part('U1', 'C7484', buffer, { OE_N: pin('1', 'input', true, 5.5), A: pin('2', 'input', true, 3.6), GND: pin('3', 'ground'), Y: pin('4', 'output', true, 5.25), VCC: { ...pin('5', 'power-in'), volts: { min: 4.5, max: 5.5 } } }, -4, 0), cap('C1', { ...led, note: 'Author policy100nF local bypass despite V5/W advertising no external capacitor required; not a manufacturer-mandated reference value.' }, 2, 0), cap('C2', buffer, -4, -2)];
  w.nets = [{ name: 'V5', pins: ['D1.VDD', 'U1.VCC', 'C1.A', 'C2.A'] }, { name: 'GND', pins: ['D1.GND', 'U1.GND', 'U1.OE_N', 'C1.B', 'C2.B'] }, { name: 'DATA_3V3', pins: ['U1.A'] }, { name: 'DATA_5V', pins: ['U1.Y', 'D1.DIN'] }];
  w.ports = [{ id: 'V5', label: '5V', kind: 'power-in', terminal: 'net:V5', volts: { min: 4.75, max: 5.25 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:GND' }, { id: 'LED_DATA', label: '3.3V input', kind: 'gpio', terminal: 'net:DATA_3V3', volts: { min: 0, max: 3.6 } }];
  w.constraints = [dec('D1', 'VDD', 'GND', ['C1'], .1, led), dec('U1', 'VCC', 'GND', ['C2'], .1, buffer), { kind: 'strap', pin: 'U1.OE_N', safe: 'low', to: 'net:GND', citation: buffer }, ground('D1.GND', led), ground('U1.GND', buffer)];
  w.power.sinks = [{ port: 'V5', typicalMa: 39, peakMa: 63 }];
  w.firmware = { libs: [], includes: ['Arduino.h'], usage: 'Requires an independently qualified800kbps WS2812 timing implementation with resetLOW>280us. No firmware library/version is approved here and digitalWrite loops are not guaranteed. Do not claim firmware/physical done until target-specific timing is compiled and reviewed. MCU data enters only AHCT A; /OE is GND, Y drives physical LED DINpad4. Raw header SPICEpin3 is stale and must never override physicalpad4. Ensure MCU-off/buffer-on input is not floating and verify rail sequencing.' };

  const d = blank('ssd1306-i2c-header', '3.3V SSD1306 module cable header', 'display', 'Connector contract only: JST SH1mm1GND2+3.3V3SCL4SDA, external3.3V SSD1306 I2C0x3C module. No bare OLED IC or selected module is claimed. External device must stay within50mA reserve; actual module consumption/polarity/address must be verified.');
  const connector = catalog.get('C160404')!;
  const display: Citation = { url: connector.datasheetUrl!, pages: '1–2', note: 'Actual JST SH1mm4pin connector; physicalcontacts1–4 and mechanicaltabs5/6. Our authored cable contract1GND2+3.3V3SCL4SDA is not a universal SSD1306 module pinout. 10k I2C pulls and50mA reserve are author contract assumptions; verify module and total bus capacitance/parallel pulls.' };
  if (!display.url) throw new Error('Display connector needs its actual supplier-provided datasheet URL');
  d.parts = [part('J1', 'C160404', display, { GND: passive('1'), VCC: passive('2'), SCL: passive('3'), SDA: passive('4'), MOUNT5: pin('5', 'nc', false), MOUNT6: pin('6', 'nc', false) }, 0, 0), resistor('R1', display, 2, 0), resistor('R2', display, 2, 2)];
  d.nets = [{ name: 'V3V3', pins: ['J1.VCC', 'R1.A', 'R2.A'] }, { name: 'GND', pins: ['J1.GND'] }, { name: 'SCL', pins: ['J1.SCL', 'R1.B'] }, { name: 'SDA', pins: ['J1.SDA', 'R2.B'] }];
  d.ports = [{ id: 'V3V3', label: '3.3V module supply', kind: 'power-in', terminal: 'net:V3V3', volts: { min: 3, max: 3.6 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:GND' }, { id: 'I2C_DISPLAY', label: 'I2C display', kind: 'bus', bus: { protocol: 'i2c', role: 'peripheral', signals: { SCL: 'net:SCL', SDA: 'net:SDA' }, i2cAddresses: [0x3C] } }];
  d.constraints = [{ kind: 'pullup', pin: 'net:SCL', to: 'net:V3V3', resistor: 'R1', ohms: 10000, citation: display }, { kind: 'pullup', pin: 'net:SDA', to: 'net:V3V3', resistor: 'R2', ohms: 10000, citation: display }];
  d.power.sinks = [{ port: 'V3V3', typicalMa: 50, peakMa: 50 }];
  d.firmware = { libs: ['adafruit/Adafruit SSD1306@2.5.13', 'adafruit/Adafruit GFX Library@1.11.11', 'adafruit/Adafruit BusIO@1.17.0'], includes: ['Arduino.h', 'Wire.h', 'Adafruit_GFX.h', 'Adafruit_SSD1306.h'], usage: 'Conditional external128x64 SSD1306 I2C module at0x3C: Wire.begin(SDA,SCL), Adafruit_SSD1306(128,64,&Wire,-1), begin(SSD1306_SWITCHCAPVCC,0x3C); handle false result. This is a cable/module contract, not a bare controller circuit. Select/verify3.3V-compatible module,cablepolarity,pullups,address,50mA maximumdraw and matingSH1mmconnector. FiftymA typical/peak is a conservative reserved budget, not an observed or manufacturer module consumption.' };
  for(const block of [a,w]){block.version=2;for(const c of block.constraints)if(c.kind==='decoupling'){c.maxDistanceMm=4;c.citation={...c.citation,note:(c.citation.note??'')+' Author origin-distance policy4mm: actual imported courtyards require at least3.125mm for the amplifier bulk capacitor and3.6mm for LED bypass. Manufacturer asks close bypassing;4mm is not a quoted manufacturer maximum. Final native distance and short pad-to-pad routing remain checked.'};}}
  return [m, a, w, d];
}

export async function generatePeripherals(): Promise<PeripheralDraftBundle> {
  // IDs for these new passives/connectors must originate from actual search responses.
  const queries = ['0603 100k', '0805 10uF 16V X7R', 'B2B-PH-K-S(LF)(SN)'];
  const discoveries = await Promise.all(queries.map(query => searchParts(query, { timeoutMs: 5000 })));
  for (const [index, id] of ['C25803', 'C162430', 'C131337'].entries()) if (!discoveries[index]!.some(p => p.lcsc === id)) throw new Error(`Actual search no longer confirms selected ${id}`);
  const ids = ['C5656610', 'C910544', 'C2874885', 'C7484', 'C160404', 'C14663', 'C25803', 'C162430', 'C131337', 'C25804'];
  const catalog: CatalogPart[] = []; for (const id of ids) catalog.push(await registerPart(id));
  const map = new Map(catalog.map(p => [p.lcsc, p])), drafts = buildPeripheralDrafts(map);
  const gates = drafts.map(draft => ({ id: draft.id, results: checkBlockDraft(draft, map) }));
  const receiptIds = new Set([...catalog.flatMap(p => [p.catalogReceipt, ...(p.datasheetReceipt ? [p.datasheetReceipt] : [])]), ...discoveries.flatMap(rows => rows.map(p => p.catalogReceipt))]);
  const receipts = await Promise.all([...receiptIds].map(id => loadCatalogReceipt(id)));
  // Retain primary-source hashes; do not silently claim a failed HTML download is a PDF.
  for (const [file, expected] of [['mic-primary.pdf', mic.sha256], ['led-primary.pdf', led.sha256]] as const) {
    const receipt = JSON.parse(await readFile(resolve(base, `${file}.receipt.json`), 'utf8'));
    if (receipt.sha256 !== expected || !receipt.pdfMagic) throw new Error(`Missing primary manufacturer PDF evidence ${file}`);
  }
  return { schema: 'moki.peripheral-drafts/1', drafts, catalog, receipts, gates, notes: [
    'Agent-authored DATA ONLY; all four drafts remain unreviewed. Passing standalone ERC is not independent schematic review, SPICE, layout/DRC, compile or assembled hardware proof.',
    'Lifecycle: ICS-43434 EOL. Mechanical acoustic opening, actual speaker/load/thermal design, display module/cable selection, LED current/timing and power sequencing remain explicit independent-review work.',
    'Budget values are manufacturer figures only where noted; amp/LED/display reserved budgets are declared design assumptions, never measured currents or fabricated part ratings.',
    'Display is an external module connector contract with conservative50mA reserved current; no exact SSD1306 module or bare IC catalog entry is claimed.',
    'Retain all imported pads including amp NC/EP and connector mechanicaltabs. No footprint conversion, native builds, current spike data edits or promotions performed.',
    'Root merge must preserve catalog entries by (lcsc,catalogReceipt), keeping existing seed receipt identities, rather than replacing old receipts solely by LCSC code.',
  ] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const bundle = await generatePeripherals();
  await writeFile(resolve('src/blocks/data/peripheral-drafts.json'), JSON.stringify(bundle, null, 2));
  console.log(JSON.stringify({ drafts: bundle.drafts.length, catalog: bundle.catalog.length, gates: bundle.gates }, null, 2));
  if (bundle.gates.some(g => g.results.some(r => !r.ok))) process.exitCode = 1;
}
