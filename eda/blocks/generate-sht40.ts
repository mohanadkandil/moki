import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerPart } from '../../src/blocks/library.js';
import { checkBlockDraft } from '../../src/blocks/erc.js';
import type { BlockDraft, CatalogPart, Citation } from '../../src/blocks/contract.js';

const datasheet: Citation = {
  url: 'https://sensirion.com/media/documents/33FD6951/6A7C10A0/HT_DS_Datasheet_SHT4x_V7.3.pdf',
  sha256: '8db4a43f17149b76811cfb504caaeca4ef844ddc710cb9b45905c51c7ddfe3c2',
  pages: '9–17',
  note: 'SHT40-AD1B: address 0x44; VDD <=3.6 V; measurement <=500 uA; no clock stretching; heater excluded from this block.',
};
const reference: Citation = {
  url: 'https://sensirion.com/media/documents/93E06008/640B25FB/SENSEVAL_SHT4XV1_technical_description.pdf',
  sha256: '9b4ca39c5ffe2e36aaa1a04f011ddbd9de3de86896f6e430c3bd8691376cc7d3',
  pages: '2, 8',
  note: 'Manufacturer reference uses 100 nF X7R and two 10 kOhm pull-ups to sensor VDD. Pull-ups are supplied by the existing carrier I2C header, not duplicated here.',
};
export interface Sht40Options { busCapacitancePf?: number; frequencyHz?: number }
// 100 kHz Standard-mode rise-time ceiling is 1000 ns: NXP UM10204 Rev7, p44.
// Author policy assumes the carrier has exactly one pair of 10kOhm +/-1% pull-ups.
export const SHT40_BUS_CAP_LIMIT_PF = 1e-6 / (.8473 * 10100) * 1e12;

/** A finite, heater-disabled variant; these options declare assumptions, not measurements. */
export function createSht40Draft(sensor: CatalogPart, bypass: CatalogPart, options: Sht40Options = {}): BlockDraft {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['busCapacitancePf', 'frequencyHz'].includes(k))) throw new Error('Unsupported SHT40 option');
  if (options.frequencyHz !== undefined && options.frequencyHz !== 100000) throw new Error('Only the reviewed 100000 Hz bus setting is supported');
  if (options.busCapacitancePf !== undefined && (!Number.isFinite(options.busCapacitancePf) || options.busCapacitancePf <= 0 || options.busCapacitancePf >= SHT40_BUS_CAP_LIMIT_PF)) throw new Error('Declared bus capacitance must be positive and below the 100 kHz/10.1kOhm rise-time limit');
  const expect = (part: CatalogPart, lcsc: string, mpn: string, pads: Record<string, string>) => {
    if (part.lcsc !== lcsc || part.mpn !== mpn || !/^sha256:[a-f0-9]{64}$/.test(part.catalogReceipt) || !/^[a-f0-9]{64}$/.test(part.rawSha256) || !/^[a-f0-9]{64}$/.test(part.footprintSha256)) throw new Error(`Verified ${lcsc} ${mpn} catalog receipt required`);
    if (part.pins.length !== Object.keys(pads).length || Object.entries(pads).some(([pad, label]) => part.pins.filter(p => p.pad === pad && p.labels.includes(label)).length !== 1)) throw new Error(`${lcsc} importer pad map differs from the reviewed mapping`);
  };
  expect(sensor, 'C2909890', 'SHT40-AD1B-R2', { '1': 'SDA', '2': 'SCL', '3': 'VDD', '4': 'VSS', '5': 'EP' });
  expect(bypass, 'C14663', 'CC0603KRX7R9BB104', { '1': '1', '2': '2' });
  const correction: Citation = { ...datasheet, pages: '16–17', note: 'Remove imported PAD5 central copper and paste; do not ground it. Manufacturer forbids exposed central copper/solder; die pad is not connected to any pin. Retain functional pads 1–4; final pad geometry/orientation and all exported copper/paste require native review.' };
  return {
    schema: 'moki.block/1', id: 'sht40-ad1b-3v3', version: 3,
    title: 'SHT40 temperature and humidity, heater disabled', class: 'sensor',
    summary: '3.3 V SHT40 at fixed I2C address 0x44, 100 nF bypass; uses existing carrier 10kOhm bus pull-ups at 100 kHz. Imported central copper pad explicitly omitted; physical realization pending.',
    provenance: { author: 'agent', authorId: 'chip_eda' },
    parts: [
      { ref: 'U1', lcsc: sensor.lcsc, mpn: sensor.mpn, catalogReceipt: sensor.catalogReceipt, datasheet, pinout: 'verified', at: { x: 0, y: 0, rotation: 0 },
        pins: { SDA: { pad: '1', role: 'open-drain', required: true, volts: { min: 0, max: 3.6 } }, SCL: { pad: '2', role: 'input', required: true, volts: { min: 0, max: 3.6 } }, VDD: { pad: '3', role: 'power-in', required: true, volts: { min: 3, max: 3.6 } }, VSS: { pad: '4', role: 'ground', required: true } },
        omitPads: ['5'], correction },
      { ref: 'C1', lcsc: bypass.lcsc, mpn: bypass.mpn, catalogReceipt: bypass.catalogReceipt,
        datasheet: { url: bypass.datasheetUrl ?? 'https://www.lcsc.com/datasheet/lcsc_datasheet_2211101700_YAGEO-CC0603KRX7R9BB104_C14663.pdf', note: 'Actual YAGEO 100nF +/-10% 50V X7R C0603 catalog component; retained importer receipt identifies pads 1/2.' },
        pinout: 'verified', pins: { '1': { pad: '1', role: 'passive' }, '2': { pad: '2', role: 'passive' } }, at: { x: 2, y: 0, rotation: 90 }, value: '100nF', valueWhy: reference },
    ],
    nets: [{ name: 'V3V3', pins: ['U1.VDD', 'C1.1'] }, { name: 'GND', pins: ['U1.VSS', 'C1.2'] }, { name: 'SDA', pins: ['U1.SDA'] }, { name: 'SCL', pins: ['U1.SCL'] }],
    params: [
      { id: 'heater', type: 'enum', options: ['disabled'], default: 'disabled', why: 'Heater commands are forbidden in this 2mA variant. A heater variant needs a different power budget, duty-cycle/ambient constraints and independent review (datasheet pp9,13–14).' },
      { id: 'i2cFrequencyHz', type: 'number', min: 100000, max: 100000, default: 100000, unit: 'Hz', why: 'Author default 100kHz; existing carrier has one 10kOhm +/-1% pull-up pair. Cb < tr/(0.8473 Rp), Sensirion p9; Standard-mode tr<=1000ns, NXP UM10204 Rev7 p44, https://www.nxp.com/docs/en/user-guide/UM10204.pdf . No faster-mode timing claim.' },
      ...(options.busCapacitancePf === undefined ? [] : [{ id: 'busCapacitancePf', type: 'number' as const, min: options.busCapacitancePf, max: options.busCapacitancePf, default: options.busCapacitancePf, unit: 'pF', why: 'User-declared total bus capacitance, not measured. Assumes exactly one 10kOhm +/-1% pull-up pair; strict rise-time bound uses 10.1kOhm. Re-evaluate the whole bus if parts, wiring or pull-ups change.' }]),
    ],
    ports: [
      { id: 'V3V3', label: 'Sensor supply', kind: 'power-in', terminal: 'net:V3V3', volts: { min: 3, max: 3.6 } },
      { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:GND' },
      { id: 'I2C', label: 'SHT40 I2C', kind: 'bus', bus: { protocol: 'i2c', role: 'peripheral', signals: { SDA: 'net:SDA', SCL: 'net:SCL' }, i2cAddresses: [0x44] } },
    ],
    power: { sources: [], sinks: [{ port: 'V3V3', typicalMa: .5, peakMa: 2 }] },
    constraints: [
      { kind: 'decoupling', ic: 'U1', powerPin: 'VDD', groundPin: 'VSS', caps: ['C1'], minUf: .1, maxDistanceMm: 2, citation: { ...reference, note: `${reference.note} The <=2mm centre-distance limit is an author placement policy, not a manufacturer dimension.` } },
      { kind: 'ground', pin: 'U1.VSS', citation: { ...datasheet, pages: '17' } },
      { kind: 'keepout', x: 0, y: 0, width: 1.6, height: 1.6, layers: ['all'], excludeParts: ['U1'], purpose: 'No copper beneath sensor except functional contact pads 1–4; no central copper/paste PAD5. Exclude only sensor U1, not bypass C1. Native pad-aware exception, footprint dimensions/orientation and pours/paste remain unverified. Keep sensing opening exposed and away from heat sources.', citation: correction },
    ],
    firmware: { libs: [], includes: ['Wire.h'], usage: 'Fixed address 0x44. Use Wire at 100000 Hz with shared 3.3V supply/pull-ups; do not duplicate carrier 10kOhm pull-ups. Never issue heater commands. Wait >=1ms after power-up and >=8.3ms for high-repeatability measurement (10ms policy); busy reads NACK, no clock stretching. Validate 6-byte measurement CRC-8 (polynomial 0x31, initial 0xFF). Measurement <=0.5mA plus both 10kOhm +/-1% pull-ups at 3.6V is <1.23mA; 2mA peak is author margin, not heater capacity. Actual total bus capacitance/waveforms remain unverified unless supplied and measured; 100kHz alone does not prove timing. No powered bus driving an unpowered sensor, no 5V interface. Preserve airflow, avoid warm MCU/regulator placement; no final thermal/accuracy/manufacturing claim.' },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sensor, bypass] = await Promise.all([registerPart('C2909890'), registerPart('C14663')]);
  const draft = createSht40Draft(sensor, bypass), gates = checkBlockDraft(draft, new Map([[sensor.lcsc, sensor], [bypass.lcsc, bypass]]));
  if (gates.some(g => !g.ok)) throw new Error(JSON.stringify(gates));
  const path = resolve('src/blocks/data/sht40-draft.json');
  await writeFile(path, JSON.stringify(draft, null, 2) + '\n');
  console.log(JSON.stringify({ path, parts: [sensor, bypass].map(p => ({ lcsc: p.lcsc, catalogReceipt: p.catalogReceipt })), gates }, null, 2));
}
