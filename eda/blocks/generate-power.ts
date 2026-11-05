import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerPart } from '../../src/blocks/library.js';
import { checkBlockDraft } from '../../src/blocks/erc.js';
import type { BlockDraft, BlockPart, CatalogPart, Citation, GateResult } from '../../src/blocks/contract.js';

export const POWER_PARTS = {
  charger: ['C2861252', 'BQ24074RGTT'], battery: ['C160352', 'B2B-PH-SM4-TB(LF)(SN)'],
  converter: ['C28060', 'TPS63001DRCR'], ilim: ['C22765', '0603WAF1201T5E'], iset: ['C4211', '0603WAF3001T5E'],
  ts: ['C25804', '0603WAF1002T5E'], bypass: ['C14663', 'CC0603KRX7R9BB104'],
  inputCap: ['C15849', 'CL10A105KB8NNNC'], bulkCap: ['C15850', 'CL21A106KAYNNNE'], inductor: ['C20416998', 'LPS4012-222MRC'],
  ntcHeader: ['C160402', 'SM02B-SRSS-TB(LF)(SN)'], externalNtc: ['C5346323', '103AT-2'], lowChargeIset: ['C23162', '0603WAF4701T5E'],
} as const;
const bq: Citation = { url: 'https://www.ti.com/lit/ds/symlink/bq24074.pdf', sha256: '4fe4e4f9855501f83b400c6932e3098439e51c50539e40dc45b44a8d509e8db1', pages: '7–13, 21–23, 28–29, 34–35, 42', note: 'Exact BQ24074: pin15 ITERM. EN2 high/EN1 low selects resistor input limit. Separate OUT system and BAT charging nodes; sum their losses on the same physical IC.' };
const tps: Citation = { url: 'https://www.ti.com/lit/ds/symlink/tps63001.pdf', pages: '1, 3–6, 10–13, 16', note: 'TPS63001 fixed3.3V; FB tied directly to VOUT. LPS4012 is a recommended inductor series. 1.8A is switch current, not output. USB-state author output budget800mA peak/650mA continuous atSYS4.2–4.5V, ambient25C and assumed85% efficiency; native layout/transients and actual efficiency remain unverified.' };
const tpsRef: Citation = { url: 'https://www.ti.com/lit/an/slva358a/slva358a.pdf', pages: '6–7', note: 'Complete TPS63001 reference ties VIN/VINA supply directly; no mixed partial100Ohm filter topology. Fixed FB returns to VOUT. Author uses additional nominal capacitance; effective DC-biased capacitance still requires verification.' };
const coil: Citation = { url: 'https://www.coilcraft.com/getmedia/a31b0140-5adf-4f7e-b7bf-5e9d605a87b9/LPS4012.pdf', pages: '1–2', note: 'LPS4012-222MRC2.2uH +/-20%, DCRmax0.100Ohm; at25C Isat2.3A at10% inductance drop, Irms1.2A for20C rise/1.75A for40C rise. Temperature-rise currents are reference, not absolute maximum guarantees. USB-state bounded steady-state inductor current is below these reference values; switching/core loss and temperature remain unmeasured.' };
const jst: Citation = { url: 'https://www.jst-mfg.com/product/pdf/eng/ePH.pdf', pages: '1–4', note: 'Exact SMT PH connector: two electrical contacts and two mounting tabs. This design assigns1=GND and2=BAT+; confirm actual protected-cell harness polarity. This is not a universal PH battery polarity convention.' };
type Key = keyof typeof POWER_PARTS;
export interface PowerDraftBundle { drafts: BlockDraft[]; catalog: CatalogPart[]; gates: GateResult[] }

/** Manufacturer topology checks beyond the generic ERC's component-agnostic graph rules. */
export function checkPowerReference(drafts: BlockDraft[]): GateResult {
  const issues: GateResult['issues'] = [];
  const need = (ok: boolean, message: string, where: string) => { if (!ok) issues.push({ rule: 'power-reference', severity: 'error', where, message }); };
  const charger = drafts.find(b => b.id === 'bq24074-usb-300ma-ts-bypass'), converter = drafts.find(b => b.id === 'tps63001-usb-sys-3v3');
  for (const [b, name] of [[charger, 'BQ24074'], [converter, 'TPS63001']] as const) need(Boolean(b), `Missing ${name} reference draft`, name);
  if (!charger || !converter) return { gate: 'erc', ok: false, issues };
  const wired = (b: BlockDraft, a: string, d: string) => b.nets.some(n => n.pins.includes(a) && n.pins.includes(d));
  const across = (b: BlockDraft, ref: string, a: string, d: string) => wired(b, `${ref}.1`, a) && wired(b, `${ref}.2`, d) || wired(b, `${ref}.2`, a) && wired(b, `${ref}.1`, d);
  const value = (b: BlockDraft, ref: string, id: string, literal: string) => { const p = b.parts.find(p => p.ref === ref); return p?.lcsc === id && p.value === literal; };
  need(across(charger, 'R1', 'U1.ILIM', 'U1.VSS') && value(charger, 'R1', POWER_PARTS.ilim[0], '1.2kOhm'), 'ILIM must use actual1.2kOhm1% component toVSS for the stated1.5A source bounds', charger.id);
  need(across(charger, 'R2', 'U1.ISET', 'U1.VSS') && value(charger, 'R2', POWER_PARTS.iset[0], '3kOhm'), 'ISET must use actual3kOhm1% component toVSS for the stated330mA upper allocation', charger.id);
  need(across(charger, 'R3', 'U1.TS', 'U1.VSS') && value(charger, 'R3', POWER_PARTS.ts[0], '10kOhm'), 'This explicitly disabled-temperature variant requires actual fixed10kOhm TS bypass; it is not an NTC', charger.id);
  need(wired(charger, 'U1.CE', 'U1.VSS') && wired(charger, 'U1.EN1', 'U1.VSS') && wired(charger, 'U1.EN2', 'U1.IN'), 'CE/EN1 low andEN2 high are required for enabled resistor-current-limit mode', charger.id);
  need(!charger.nets.some(n => n.pins.includes('U1.TMR') || n.pins.includes('U1.ITERM')), 'TMR and exact-variantITERM must remain open toretain defaulttimers/termination', charger.id);
  need(wired(charger, 'U1.BAT2', 'U1.BAT3') && wired(charger, 'U1.OUT10', 'U1.OUT11') && !wired(charger, 'U1.BAT2', 'U1.OUT10'), 'Both duplicatedBAT/OUT pads must be wired, and battery/system nodes must stay separate', charger.id);
  need(wired(charger, 'J1.NEG', 'U1.VSS') && wired(charger, 'J1.POS', 'U1.BAT2'), 'Explicit harness assignment isPH1ground/PH2BATpositive; tabs are notbatterycontacts', charger.id);
  need(across(converter, 'L1', 'U1.L1', 'U1.L2') && value(converter, 'L1', POWER_PARTS.inductor[0], '2.2uH'), 'Actual2.2uH LPS4012 inductor must bridge switchingpadsL1/L2, without bypass/directshort', converter.id);
  need(!wired(converter, 'U1.L1', 'U1.L2'), 'Switchingnodes cannot be directly shorted around the inductor', converter.id);
  need(wired(converter, 'U1.FB', 'U1.VOUT') && !wired(converter, 'U1.FB', 'U1.VIN'), 'FixedTPS63001 FB must return directly toVOUT, neverVIN', converter.id);
  need(wired(converter, 'U1.VIN', 'U1.VINA') && wired(converter, 'U1.EN', 'U1.VIN') && wired(converter, 'U1.PS', 'U1.GND'), 'Use complete directVIN/VINA reference, EN high andPSlow; filteredVINA is another topology', converter.id);
  const sys = charger.power.sources.find(s => s.port === 'SYS'), bat = charger.power.sources.find(s => s.port === 'BAT'), out = converter.power.sources.find(s => s.port === 'V3V3');
  need(Boolean(sys && bat && sys.maxMa <= 890 && sys.continuousMa! <= 700 && bat.maxMa >= 975 / (3000 * .99) * 1000 && bat.maxMa <= 330 && bat.continuousMa === bat.maxMa), 'USBstate SYS/charge allocations must preserve both programmed-current tolerance and guaranteed-lowILIM headroom', charger.id);
  need(Boolean(sys?.thermal && bat?.thermal && sys.thermal.thetaJa === bat.thermal.thetaJa && sys.thermal.ambientC === bat.thermal.ambientC && sys.thermal.maxJunctionC === bat.thermal.maxJunctionC), 'BothSYS andBAT outputs share one physical charger thermal model', charger.id);
  need(Boolean(out && out.maxMa <= 800 && out.continuousMa! <= 650 && out.efficiency! <= .85 && out.inputPort === 'SYS'), 'TPSoutput allocation is bounded USBstate800mA/650mA,85% assumed efficiency; switch-current limit is notoutputcurrent', converter.id);
  return { gate: 'erc', ok: !issues.some(i => i.severity === 'error'), issues };
}

export function createPowerDrafts(catalog: Map<string, CatalogPart>): BlockDraft[] {
  const get = (key: Key) => {
    const [lcsc, mpn] = POWER_PARTS[key], p = catalog.get(lcsc);
    if (!p || p.lcsc !== lcsc || p.mpn !== mpn || !/^sha256:[a-f0-9]{64}$/.test(p.catalogReceipt) || !/^[a-f0-9]{64}$/.test(p.rawSha256) || !/^[a-f0-9]{64}$/.test(p.footprintSha256)) throw new Error(`Actual verified ${lcsc} ${mpn} catalog/importer receipt required`);
    return p;
  };
  const pads = (key: Key, expected: Record<string, string>) => { const p = get(key); if (p.pins.length !== Object.keys(expected).length || Object.entries(expected).some(([pad, label]) => p.pins.filter(a => a.pad === pad && a.labels.includes(label)).length !== 1)) throw new Error(`${p.lcsc} native pad map differs from the manufacturer-reviewed mapping`); };
  pads('charger', { '1': 'TS', '2': 'BAT', '3': 'BAT', '4': 'CE#', '5': 'EN2', '6': 'EN1', '7': 'PGOOD#', '8': 'VSS', '9': 'CHG#', '10': 'OUT', '11': 'OUT', '12': 'ILIM', '13': 'IN', '14': 'TMR', '15': 'ITERM', '16': 'ISET', '17': 'EP' });
  pads('converter', { '1': 'VOUT', '2': 'L2', '3': 'PGND', '4': 'L1', '5': 'VIN', '6': 'EN', '7': 'PS/SYNC', '8': 'VINA', '9': 'GND', '10': 'FB', '11': 'PAD' });
  pads('battery', { '1': '1', '2': '2', '3': '3', '4': '4' });
  pads('ntcHeader', { '1': '1', '2': '2', '3': '3', '4': '4' });
  for (const key of ['ilim', 'iset', 'ts', 'bypass', 'inputCap', 'bulkCap', 'inductor', 'externalNtc', 'lowChargeIset'] as Key[]) pads(key, { '1': '1', '2': '2' });
  const part = (ref: string, key: Key, pins: BlockPart['pins'], at: BlockPart['at'], datasheet: Citation, value?: string, why?: Citation): BlockPart => {
    const c = get(key); return { ref, lcsc: c.lcsc, mpn: c.mpn, catalogReceipt: c.catalogReceipt, pinout: 'verified', pins, at, datasheet, ...(value ? { value, valueWhy: why ?? datasheet } : {}) };
  };
  const two = (ref: string, key: Key, value: string, x: number, y: number, why: Citation) => {
    const c = get(key); return part(ref, key, { '1': { pad: '1', role: 'passive' }, '2': { pad: '2', role: 'passive' } }, { x, y }, { url: c.datasheetUrl ?? why.url, note: `Actual ${c.mpn} / ${c.lcsc} component identity/value; manufacturer reference determines circuit selection.` }, value, why);
  };
  const p = (pad: string, role: BlockPart['pins'][string]['role'], required = true, volts?: { min: number; max: number }) => ({ pad, role, ...(required ? { required } : {}), ...(volts ? { volts } : {}) });
  const dec = (ic: string, powerPin: string, groundPin: string, caps: string[], minUf: number, citation: Citation): BlockDraft['constraints'][number] => ({ kind: 'decoupling', ic, powerPin, groundPin, caps, minUf, maxDistanceMm: 6, citation: { ...citation, note: `${citation.note} Six mm centre distance is an author screening policy; short local power loops and effective capacitance require native/hardware verification.` } });
  const thermal = { thetaJa: 44.5, maxJunctionC: 110, ambientC: 25 };
  const charger: BlockDraft = {
    schema: 'moki.block/1', id: 'bq24074-usb-300ma-ts-bypass', version: 1, title: 'BQ24074 power path, 300mA charging, TS monitoring disabled', class: 'power',
    summary: 'USB-present state only: qualified4.75–5.25V/1.5A source; SYS4.2–4.5V and separate protected1-cell BAT. Fixed10k TS bypass disables pack-temperature monitoring. Not a battery-protection circuit or proof of battery fallback.',
    provenance: { author: 'agent', authorId: 'chip_eda' },
    parts: [
      part('U1', 'charger', { TS: p('1', 'input'), BAT2: p('2', 'power-out', true, { min: 3, max: 4.242 }), BAT3: p('3', 'power-out', true, { min: 3, max: 4.242 }), CE: p('4', 'input'), EN2: p('5', 'input', true, { min: 0, max: 7 }), EN1: p('6', 'input'), PGOOD: p('7', 'open-drain', false), VSS: p('8', 'ground'), CHG: p('9', 'open-drain', false), OUT10: p('10', 'power-out'), OUT11: p('11', 'power-out'), ILIM: p('12', 'input'), IN: p('13', 'power-in', true, { min: 4.75, max: 5.25 }), TMR: p('14', 'input', false), ITERM: p('15', 'input', false), ISET: p('16', 'input'), EP: p('17', 'ground') }, { x: 0, y: 0 }, bq),
      part('J1', 'battery', { NEG: p('1', 'ground'), POS: p('2', 'passive'), TAB3: p('3', 'nc', false), TAB4: p('4', 'nc', false) }, { x: 0, y: -10 }, jst),
      two('R1', 'ilim', '1.2kOhm', -6, 0, { ...bq, pages: '12, 34', note: 'ILIM1.2k +/-1%: guaranteed-low1500/(1200*1.01)=1237.62mA, typical1610/1200=1341.67mA, high1720/(1200*.99)=1447.81mA. The worked example uses a different typical constant; electrical-table bounds govern screening.' }),
      two('R2', 'iset', '3kOhm', 6, 0, { ...bq, pages: '12, 34', note: 'ISET3k +/-1%: nominal890/3000=296.67mA; maximum975/(3000*.99)=328.28mA. Budget330mA continuously while USB is present, even if DPPM later reduces charging.' }),
      two('R3', 'ts', '10kOhm', 6, -3, { ...bq, pages: '24–25, 35', note: 'Explicit fixed10k TS-to-VSS bypass; charging has no battery-temperature monitoring. It is not an NTC and not protected-cell certification.' }),
      two('C1', 'inputCap', '1uF', -3, 1, bq), two('C2', 'inputCap', '1uF', -3, 4, bq),
      two('C3', 'bulkCap', '10uF', 3, 1, bq), two('C4', 'bulkCap', '10uF', 3, 4, bq),
      two('C5', 'bulkCap', '10uF', -3, -2, bq), two('C6', 'bulkCap', '10uF', -3, -5, bq),
    ],
    nets: [
      { name: 'VBUS', pins: ['U1.IN', 'U1.EN2', 'C1.1', 'C2.1'] },
      { name: 'SYS', pins: ['U1.OUT10', 'U1.OUT11', 'C3.1', 'C4.1'] },
      { name: 'BAT', pins: ['U1.BAT2', 'U1.BAT3', 'J1.POS', 'C5.1', 'C6.1'] },
      { name: 'GND', pins: ['U1.VSS', 'U1.EP', 'U1.CE', 'U1.EN1', 'J1.NEG', 'R1.2', 'R2.2', 'R3.2', 'C1.2', 'C2.2', 'C3.2', 'C4.2', 'C5.2', 'C6.2'] },
      { name: 'ILIM', pins: ['U1.ILIM', 'R1.1'] }, { name: 'ISET', pins: ['U1.ISET', 'R2.1'] }, { name: 'TS_BYPASS', pins: ['U1.TS', 'R3.1'] },
    ],
    params: [{ id: 'operatingState', type: 'enum', options: ['usb-present'], default: 'usb-present', why: 'This graph models qualifiedUSB present and charging only. Source must guarantee4.75–5.25V at board under the total board1.5A budget. Battery absent/fallback/DPPM/supplement need separate validated states.' }, { id: 'temperatureMonitoring', type: 'enum', options: ['disabled-fixed-resistor'], default: 'disabled-fixed-resistor', why: 'Two-wire PH harness has no NTC. Fixed10k bypass is explicit and not pack-temperature protection; external protected1-cell pack must permit330mA charge. Independent safety review required.' }],
    ports: [
      { id: 'VBUS', label: 'Qualified USB5V input', kind: 'power-in', terminal: 'net:VBUS', volts: { min: 4.75, max: 5.25 } },
      { id: 'SYS', label: 'USB-present system power', kind: 'power-out', terminal: 'net:SYS', volts: { min: 4.2, max: 4.5 } },
      { id: 'BAT', label: 'Protected1-cell charge terminal', kind: 'power-out', terminal: 'net:BAT', volts: { min: 3, max: 4.242 } },
      { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:GND' },
    ],
    power: { sources: [
      { port: 'SYS', volts: 4.4, maxMa: 890, continuousMa: 700, inputPort: 'VBUS', mode: 'regulated', conversion: 'linear', dropoutV: .475, thermal },
      { port: 'BAT', volts: 4.2, maxMa: 330, continuousMa: 330, inputPort: 'VBUS', mode: 'charger', conversion: 'linear', dropoutV: .3, thermal },
    ], sinks: [{ port: 'VBUS', typicalMa: 5, peakMa: 10 }] },
    constraints: [dec('U1', 'IN', 'VSS', ['C1', 'C2'], 1, bq), dec('U1', 'OUT10', 'VSS', ['C3', 'C4'], 4.7, bq), dec('U1', 'OUT11', 'VSS', ['C3', 'C4'], 4.7, bq), dec('U1', 'BAT2', 'VSS', ['C5', 'C6'], 4.7, bq), dec('U1', 'BAT3', 'VSS', ['C5', 'C6'], 4.7, bq),
      { kind: 'battery-path', charger: 'U1', batteryPort: 'BAT', systemPort: 'SYS', powerPath: 'integrated', citation: bq },
      ...['VSS', 'EP'].map(pin => ({ kind: 'ground' as const, pin: `U1.${pin}`, citation: bq })),
      { kind: 'strap', pin: 'U1.CE', safe: 'low', to: 'net:GND', citation: bq }, { kind: 'strap', pin: 'U1.EN1', safe: 'low', to: 'net:GND', citation: bq }, { kind: 'strap', pin: 'U1.EN2', safe: 'high', to: 'net:VBUS', citation: bq },
      { kind: 'strap', pin: 'U1.TMR', safe: 'floating', citation: { ...bq, pages: '12–13, 35', note: 'OpenTMR retains nominal30min precharge/5h fast-charge timers; do not ground/disablesafety timers.' } }, { kind: 'strap', pin: 'U1.ITERM', safe: 'floating', citation: { ...bq, pages: '8, 12–13', note: 'BQ24074-specific ITERM open selects nominal10% termination; notTD/SYSOFF fromanother variant.' } },
    ],
    spiceChecks: [{ name: 'BQ24074 nominal charge programming', kind: 'charge-current', resistor: 'R2', coefficient: 890, target: 296.6666667, tolerance: .1, citation: { ...bq, pages: '12, 34', note: 'Ideal nominal890 AOhm/R law only, excluding tolerance/battery/thermal/termination dynamics.' } }],
    firmware: { libs: [], includes: [], usage: 'No firmware dependency. USB-present state, known1.5A source; CE low, EN2 high, EN1 low. TS fixed10k disables pack-temperature monitoring. PGOOD/CHG deliberately unused open-drain outputs; TMR/ITERM deliberately open. PH1=GND/PH2=BAT+ is this design assignment, confirm harness. Requires externally protected4.2V one-cell pack rated>=330mA charge; pack, temperature supervision and polarity remain unverified. SYSmin4.2V includes max475mV input dropout at1A plus75mV author trace reserve from4.75V input; it is not battery-fallback voltage. SYS890mA +charge330mA +overhead10mA <=1237.6mA guaranteed-low programmed ILIM. Direct5V audio/LED loads bypass this ILIM and must fit the whole1.5A source budget separately. Summed SYS+BAT thermal screening uses5.25V input,3.0V cell,25C ambient,44.5C/W reference thetaJA and110C designjunction; thermal copper/enclosure/transient behavior unverified.' },
  };
  const converter: BlockDraft = {
    schema: 'moki.block/1', id: 'tps63001-usb-sys-3v3', version: 1, title: 'TPS63001 3.3V from USB-present SYS', class: 'power',
    summary: 'USB-present4.2–4.5V SYS input; fixed3.3V,800mA peak/650mA continuous author budget at25C/85% assumed efficiency. Battery-input operating envelope remains unverified. 1.8A switch rating is not output capacity.',
    provenance: { author: 'agent', authorId: 'chip_eda' },
    parts: [part('U1', 'converter', { VOUT: p('1', 'power-out'), L2: p('2', 'bidirectional'), PGND: p('3', 'ground'), L1: p('4', 'bidirectional'), VIN: p('5', 'power-in', true, { min: 4.2, max: 4.5 }), EN: p('6', 'input'), PS: p('7', 'input'), VINA: p('8', 'power-in', true, { min: 4.2, max: 4.5 }), GND: p('9', 'ground'), FB: p('10', 'input'), EP: p('11', 'ground') }, { x: 0, y: 0 }, tps),
      two('L1', 'inductor', '2.2uH', 0, -4, coil), two('C1', 'bulkCap', '10uF', -4, 0, tpsRef), two('C2', 'bulkCap', '10uF', -4, 3, tpsRef),
      two('C3', 'bulkCap', '10uF', 4, -3, tpsRef), two('C4', 'bulkCap', '10uF', 4, 0, tpsRef), two('C5', 'bulkCap', '10uF', 4, 3, tpsRef), two('C6', 'bypass', '100nF', -2, 3, tpsRef)],
    nets: [{ name: 'SYS', pins: ['U1.VIN', 'U1.VINA', 'U1.EN', 'C1.1', 'C2.1', 'C6.1'] }, { name: 'V3V3', pins: ['U1.VOUT', 'U1.FB', 'C3.1', 'C4.1', 'C5.1'] }, { name: 'GND', pins: ['U1.PGND', 'U1.GND', 'U1.EP', 'U1.PS', 'C1.2', 'C2.2', 'C3.2', 'C4.2', 'C5.2', 'C6.2'] }, { name: 'SW_L1', pins: ['U1.L1', 'L1.1'] }, { name: 'SW_L2', pins: ['U1.L2', 'L1.2'] }],
    params: [{ id: 'operatingState', type: 'enum', options: ['usb-present-sys'], default: 'usb-present-sys', why: 'Input range4.2–4.5V USB-present only. Datasheet p1buck headline1.2A at3.6–5.5V and p6Fig1typical maximum-current envelope support a derated800mA author peak budget; not a guaranteed800mA boost/battery rating. P12inductor calculation must use actual minimum input for any future boost variant.' }, { id: 'outputVoltageBudget', type: 'number', min: 3.3, max: 3.3, default: 3.3, unit: 'V', why: 'Fixed3.3V silicon with FB directly atVOUT. Port3.135–3.465V is an author +/-5% design envelope, not a claimed datasheet fixed-output tolerance; verify loaded ripple/tolerance/transients before promotion.' }],
    ports: [{ id: 'SYS', label: 'USB-present SYS', kind: 'power-in', terminal: 'net:SYS', volts: { min: 4.2, max: 4.5 } }, { id: 'V3V3', label: '3.3V output', kind: 'power-out', terminal: 'net:V3V3', volts: { min: 3.135, max: 3.465 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:GND' }],
    power: { sources: [{ port: 'V3V3', volts: 3.3, maxMa: 800, continuousMa: 650, inputPort: 'SYS', mode: 'regulated', conversion: 'switching', efficiency: .85, thermal: { thetaJa: 48.7, maxJunctionC: 110, ambientC: 25 } }], sinks: [{ port: 'SYS', typicalMa: .1, peakMa: .1 }] },
    constraints: [dec('U1', 'VIN', 'PGND', ['C1', 'C2'], 4.7, tps), dec('U1', 'VINA', 'GND', ['C6'], .1, tpsRef), dec('U1', 'VOUT', 'PGND', ['C3', 'C4', 'C5'], 15, tps), ...['PGND', 'GND', 'EP'].map(pin => ({ kind: 'ground' as const, pin: `U1.${pin}`, citation: tps })), { kind: 'strap', pin: 'U1.EN', safe: 'high', to: 'net:SYS', citation: tps }, { kind: 'strap', pin: 'U1.PS', safe: 'low', to: 'net:GND', citation: tps }],
    firmware: { libs: [], includes: [], usage: 'Always on, PS/SYNC low for power-save; no MCU-controlled power sequencing. Fixed FB tied toVOUT; VIN/VINA directly shareSYS per complete TIreference. L1/L2 are bidirectional switching nodes joined only through2.2uH inductor, not GPIO. EP11/PGND3/GND9 must retain local quiet/power-ground layout fromTI. Output800mA peak/650mAcontinuous is a USB-state author allocation below1.2A buck headline, not derived from1.8A switchlimit. Efficiency85%, thetaJA48.7C/W, ambient25C and +/-5% output voltage are screening assumptions; no guaranteed all-temperature output envelope. Coilcraft2.3A10%-dropIsat and1.2A20C-riseIrms are25C reference values; native/core-loss/transient/EMI/thermal/effectiveC remain unverified. Re-author/review input range and inductor peak calculation before claiming battery fallback. Audio/LED current5V variants must remain on qualifiedUSB5V, not this3.3V rail.' },
  };
  // Preserve both original revisions byte-for-byte; these are separately identified variants.
  const ntc = structuredClone(charger);
  ntc.id = 'bq24074-usb-190ma-ntc-required';
  ntc.title = 'BQ24074 power path, 190mA charging, external pack NTC required';
  ntc.summary = 'USB-present state: qualified4.75–5.25V/1.5A input. Separate PH battery and SH external10kNTC connectors; no fixedTS bypass. Actual pack/NTC/harness thermal qualification remains blocked, not a claim of installed temperature supervision.';
  ntc.parts = ntc.parts.filter(p => p.ref !== 'R3');
  ntc.parts[ntc.parts.findIndex(p => p.ref === 'R2')] = two('R2', 'lowChargeIset', '4.7kOhm', 6, 0, { ...bq, pages: '12, 34', note: 'Actual4.7kOhm +/-1% ISET:890/4700=189.36mA typical, maximum975/(4700*.99)=209.54mA. Reserve210mA continuously, not a claim that DPPM always reduces charging.' });
  ntc.parts.push(part('J2', 'ntcHeader', { RET: p('1', 'ground'), SENSE: p('2', 'passive'), TAB3: p('3', 'nc', false), TAB4: p('4', 'nc', false) }, { x: 8, y: -8 }, { url: 'https://www.jst-mfg.com/product/pdf/eng/eSH.pdf', pages: '1, 3', note: 'Actual2-contact SH side-entry header; pads3/4 are mechanical tabs. This design assigns1=VSS and2=TS. Required external thermally coupled NTC plugs here, not an on-board ambient thermistor.' }));
  const ntcGround = ntc.nets.find(n => n.name === 'GND')!;
  ntcGround.pins = ntcGround.pins.filter(p => p !== 'R3.2'); ntcGround.pins.push('J2.RET');
  const tsNet = ntc.nets.find(n => n.name === 'TS_BYPASS')!; tsNet.name = 'TS_PACK'; tsNet.pins = ['U1.TS', 'J2.SENSE'];
  ntc.ports.push({ id: 'PACK_NTC', label: 'Required external pack NTC', kind: 'analog', terminal: 'net:TS_PACK' });
  ntc.params = ntc.params.filter(p => p.id !== 'temperatureMonitoring');
  ntc.params.push({ id: 'temperatureMonitoring', type: 'enum', options: ['external-pack-ntc-required-unqualified'], default: 'external-pack-ntc-required-unqualified', why: 'Required external SEMITEC103AT-2 C5346323 atSHJ2:10kOhmR25+/-1%,B25/85=3435K+/-1%, physically bonded to the protected pack with qualified insulated harness. SEMITECprimarycatalogpp12–13: https://www.semitec-global.com/uploads/2022/01/NTC_thermistors_Circuit_129M.pdf . Manufacturer TIpp13,29–30 describes nominal0–50C charge window and fault suspension; threshold/NTC tolerances, thermal coupling and response must be qualified. Unqualifiedbeta corners estimate hot46.13–55.89C/cold-1.81–2.90C, so this does not guarantee a common0–45C pack charging window. NTC catalog evidence exists; no thermistor is falsely placed on this PCB and no stock/installed-part claim is made.' });
  ntc.power.sources.find(s => s.port === 'BAT')!.maxMa = 210; ntc.power.sources.find(s => s.port === 'BAT')!.continuousMa = 210;
  ntc.power.sources.find(s => s.port === 'SYS')!.maxMa = 1000; ntc.power.sources.find(s => s.port === 'SYS')!.continuousMa = 800;
  ntc.spiceChecks![0]!.target = 189.3617021;
  ntc.spiceChecks![0]!.name = 'BQ24074 nominal190mA charge programming';
  ntc.firmware!.usage = 'USB-present state only; actual4.7kOhmISET reserves210mA charging, SYS1Apeak/800mAcontinuous plus10mAoverhead yields1220mA below guaranteed-lowILIM1237.62mA. No static double counting/waiver for DPPM: reserve full210mA while charging. Pack connectorPHJ1:1=ground/2=BAT+. Separate SHJ2:1=ground/2=TS; connect actual externalSEMITEC103AT-2 C5346323,10kOhmR25+/-1%,B25/85=3435K+/-1%, thermally coupled to that same protected1-cell4.2V pack. NTC is external procurement evidence, not a fake on-board sensor or supplied harness. TIpp13,29–30 nominal0–50C TS window is not a guaranteed exact pack-temperature limit; qualify threshold/NTC tolerances, coupling, wiring fault response and temperature transient. Protected pack must permit210mAcharge and the selected discharge state, with correct polarity and cutoff. Current schema has no typed external-device binding/qualification or pass-through battery-state model: variant remains blocked/unreviewed. Do not claim battery-runtime or all-functions-on-battery proof.';

  const qualifiedBuck = structuredClone(converter);
  qualifiedBuck.id = 'tps63001-qualified-sys-3v3';
  qualifiedBuck.title = 'TPS63001 3.3V, qualified3.0–4.5V SYS state';
  qualifiedBuck.summary = 'Conditional SYS3.0–4.5V input;700mA peak/400mAcontinuous author allocation at25C and85% assumed efficiency. Battery state requires loadedpack>=3.2V and reviewed power-path/wiring drops; no pack/runtime/all-functions guarantee.';
  qualifiedBuck.ports.find(p => p.id === 'SYS')!.volts = { min: 3, max: 4.5 };
  qualifiedBuck.parts[0]!.pins.VIN!.volts = { min: 3, max: 4.5 }; qualifiedBuck.parts[0]!.pins.VINA!.volts = { min: 3, max: 4.5 };
  qualifiedBuck.parts[0]!.datasheet = { ...tps, note: 'Conditional3.0–4.5V SYS variant. TIpp1,6,12–13 gives >2.4V boost headline up to800mA and typical curves; derated700mA peak/400mAcontinuous is an author budget, not an all-temperature guarantee or1.8A switch-limit substitution. Inductor boostcurrent calculation and hardware evidence remain required.' };
  for (const c of qualifiedBuck.constraints) c.citation = { ...c.citation, note: 'Conditional3.0–4.5V SYS variant; fixedFB/VIN/VINA/ground and local capacitance follow the cited complete reference. Output700mApeak/400mAcontinuous and85% efficiency are author screening assumptions, not a battery/current/transient guarantee. Effective capacitance, local switching layout and thermal behavior remain unverified.' };
  qualifiedBuck.parts.find(p => p.ref === 'L1')!.valueWhy = { ...coil, note: `${coil.note} This variant additionally screens minimum3.0V boost input, minimum1.25MHz frequency and minimum1.76uH inductance; the exact measured switching waveform/core loss is not proved.` };
  qualifiedBuck.power.sources[0]!.maxMa = 700; qualifiedBuck.power.sources[0]!.continuousMa = 400;
  qualifiedBuck.params.find(p => p.id === 'operatingState')!.options = ['qualified-sys-3.0-to-4.5'];
  qualifiedBuck.params.find(p => p.id === 'operatingState')!.default = 'qualified-sys-3.0-to-4.5';
  qualifiedBuck.params.find(p => p.id === 'operatingState')!.why = 'ConditionalSYSmin3.0V requires protected-cell terminalmin3.2V UNDERLOAD, minus100mV BQdrop at<=1A/VBAT>3V, minus100mV author harness/PCB reserve. It does not assert a typical pack protection cutoff meets3.2V; actual cutoff/dynamic behavior must be qualified. USBpresentSYS<=4.5V. No unsupported state is silently treated as powered.';
  qualifiedBuck.firmware!.usage = 'Conditional3.0–4.5V SYS only. TPS3.3V author budget700mApeak/400mAcontinuous and85% assumed efficiency; actual peripherals602.6mApeak need~818.9mA SYS at3.0V with3.465V upper output envelope. Battery terminal must remain>=3.2V underload through protected cutoff, with BQpath<=100mV at<=1A and harness/PCB<=100mV. No actual pack or undervoltage cutoff has been qualified. Battery-only current must include allSYSbranches, and charging must not be counted when USBabsent. Current5V MAXaudio/WS2812 variants are off withoutUSB; no full-function battery claim. Candidate low-outputSYSaudio and5VLED boost need separate reviewed variants and budgets. Same fixedFB, completeVIN/VINA supply,inductor/thermal/effectiveC/native/transient requirements as original TPSblock.';
  return [charger, converter, ntc, qualifiedBuck];
}

export function checkNtcPowerReference(drafts: BlockDraft[]): GateResult {
  const b = drafts.find(d => d.id === 'bq24074-usb-190ma-ntc-required'), t = drafts.find(d => d.id === 'tps63001-qualified-sys-3v3');
  const issues: GateResult['issues'] = [];
  const need = (ok: boolean, message: string, where = b?.id ?? 'ntc-required') => { if (!ok) issues.push({ rule: 'ntc-power-reference', severity: 'error', where, message }); };
  need(Boolean(b && t), 'Both separately identified NTC and qualified-SYS variants are required');
  if (!b || !t) return { gate: 'erc', ok: false, issues };
  const wired = (a: string, d: string) => b.nets.some(n => n.pins.includes(a) && n.pins.includes(d));
  const j = b.parts.find(p => p.ref === 'J2'), r = b.parts.find(p => p.ref === 'R2');
  need(j?.lcsc === 'C160402' && j.mpn === 'SM02B-SRSS-TB(LF)(SN)' && j.pins.RET?.pad === '1' && j.pins.SENSE?.pad === '2' && j.pins.TAB3?.role === 'nc' && j.pins.TAB4?.role === 'nc', 'Required external NTC uses the actual SH2contact header, with separate NC mounting tabs');
  need(wired('U1.TS', 'J2.SENSE') && wired('U1.VSS', 'J2.RET') && !wired('U1.TS', 'U1.VSS'), 'External NTC sense and ground must reach separate header contacts; no shortedTS');
  need(b.nets.find(n => n.pins.includes('U1.TS'))?.pins.length === 2 && !b.parts.some(p => p.ref === 'R3' || p.lcsc === 'C5346323'), 'NTC variant has no fixed bypass or fake on-board external thermistor; only IC-to-header TS branch');
  need(r?.lcsc === 'C23162' && r.value === '4.7kOhm' && wired('U1.ISET', 'R2.1') && wired('U1.VSS', 'R2.2'), 'Actual4.7kOhm1% ISET must program the210mA upper charge allocation');
  const charge = b.power.sources.find(s => s.port === 'BAT'), sys = b.power.sources.find(s => s.port === 'SYS');
  need(Boolean(charge && charge.maxMa >= 975 / (4700 * .99) * 1000 && charge.maxMa <= 210 && charge.continuousMa === charge.maxMa && sys && sys.maxMa <= 1000 && sys.continuousMa! <= 800 && sys.maxMa + charge.maxMa + 10 <= 1500 / (1200 * 1.01) * 1000), 'Reserve full programmed charge plus SYS and overhead within guaranteed-low ILIM; DPPM is not an excuse to waive static demand');
  need(t.ports.find(p => p.id === 'SYS')?.volts?.min === 3 && t.ports.find(p => p.id === 'SYS')?.volts?.max === 4.5 && t.power.sources[0]!.maxMa <= 700 && t.power.sources[0]!.continuousMa! <= 400 && t.power.sources[0]!.efficiency! <= .85, 'Qualified-SYS source remains bounded to the stated input/current/efficiency assumptions', t.id);
  return { gate: 'erc', ok: !issues.some(i => i.severity === 'error'), issues };
}

/** Separate operating-state arithmetic. Failed qualification remains explicit despite plausible numbers. */
export function batteryAndNtcEvidenceGates(): GateResult[] {
  const sysMin = 3.2 - .1 - .1; // Loaded pack terminal minus specified1A BQ drop and author wiring reserve.
  const railPeak = 602.6 * 3.465 / (sysMin * .85) + .1;
  const railTypical = 251.03 * 3.465 / (sysMin * .85) + .1;
  const quietAudioPeak = 125, quietAudioTypical = 60; // Separate candidate from audio researcher, not hardware current limit.
  const batteryPeak = railPeak + quietAudioPeak + 10;
  const ledBoostPeak = 63 * 5.25 / (sysMin * .8);
  const ripple = sysMin * (1 - sysMin / 3.465) / (1.25e6 * 2.2e-6 * .8);
  const maxVariantInputA = .7 * 3.465 / (sysMin * .85);
  const ntcTrip = (r: number, r25: number, beta: number) => 1 / (1 / 298.15 + Math.log(r / r25) / beta) - 273.15;
  const tripCorners = (vMin: number, vMax: number) => [vMin / 78e-6, vMax / 72e-6].flatMap(r => [9900, 10100].flatMap(r25 => [3435 * .99, 3435 * 1.01].map(beta => ntcTrip(r, r25, beta))));
  const hot = tripCorners(.270, .330), cold = tripCorners(2, 2.2);
  const measurements = [
    { where: 'qualified-battery-state', name: 'conditionalSYS minimum', measured: sysMin, target: 3, tolerance: 0, unit: 'V', ok: sysMin >= 3 },
    { where: 'qualified-battery-state', name: '3.3V rail peak input', measured: railPeak, target: 1000, tolerance: 0, unit: 'mA', ok: railPeak <= 1000 },
    { where: 'qualified-battery-state', name: 'rail plus quiet-audio peak, LEDoff', measured: batteryPeak, target: 1000, tolerance: 0, unit: 'mA', ok: batteryPeak <= 1000 },
    { where: 'qualified-battery-state', name: 'rail plus quiet-audio typical, LEDoff', measured: railTypical + quietAudioTypical + 10, target: 1000, tolerance: 0, unit: 'mA', ok: railTypical + quietAudioTypical + 10 <= 1000 },
    { where: 'TPS63001', name: 'conditional boost peak plus20% margin', measured: (maxVariantInputA + ripple / 2) * 1.2, target: 2.3, tolerance: 0, unit: 'A', ok: (maxVariantInputA + ripple / 2) * 1.2 <= 2.3 },
    { where: 'TPS63001', name: 'conditional boostRMS screen', measured: Math.sqrt(maxVariantInputA ** 2 + ripple ** 2 / 12), target: 1.2, tolerance: 0, unit: 'A', ok: Math.sqrt(maxVariantInputA ** 2 + ripple ** 2 / 12) <= 1.2 },
  ];
  const arithmeticIssues: GateResult['issues'] = measurements.filter(m => !m.ok).map(m => ({ rule: 'conditional-battery-budget', severity: 'error', where: m.where, message: `${m.name} fails the declared conditional bound` }));
  arithmeticIssues.push({ rule: 'state-arithmetic-only', severity: 'warning', message: 'Battery arithmetic assumes loaded3.2V minimum through protection cutoff, <=100mV BQdrop at<=1A/VBAT>3V, <=100mV wiring,85% TPS efficiency,25C and separately enforced quiet-audio budget. These are not qualified pack/hardware facts. NTC temperature corners use a beta approximation with TIbias/trip and SEMITECR25/Beta tolerances; not a certified0–50C window or response-time proof.' });
  arithmeticIssues.push({ rule: 'ntc-trip-tolerance-estimate', severity: 'warning', where: '103AT-2/BQ24074', message: `Unqualified beta-model corner estimates: hottrip${Math.min(...hot).toFixed(2)}..${Math.max(...hot).toFixed(2)}C; coldtrip${Math.min(...cold).toFixed(2)}..${Math.max(...cold).toFixed(2)}C. Inputs: TI72..78uAbias,270..330mVhot/2.0..2.2Vcold; SEMITEC10kOhmR25+/-1%,3435KB25/85+/-1%. Actual R/Tcurve,thermal coupling,response and pack-safe window still require qualification.` });
  return [{ gate: 'power', ok: !arithmeticIssues.some(i => i.severity === 'error'), issues: arithmeticIssues, measurements },
    { gate: 'power', ok: false, issues: [{ rule: 'all-functions-battery-budget', severity: 'error', message: `Adding a hypothetical5V LED boost at80% efficiency to rail+quietaudio draws${(batteryPeak + ledBoostPeak).toFixed(2)}mA, beyond the1A condition used for the guaranteed100mV BQbattery drop. Existing5V audio+LED variants are unpowered withoutUSB. A full-function battery claim needs separately reviewed loads,source/path and/or enforceable transient/current limits.` }], measurements: [{ where: 'all-functions-battery', name: 'rail plus quiet-audio plus hypotheticalLEDboost peak', measured: batteryPeak + ledBoostPeak, target: 1000, tolerance: 0, unit: 'mA', ok: false }] },
    { gate: 'verify', ok: false, issues: [
      { rule: 'external-ntc-qualification-missing', severity: 'error', message: 'RealSH connector and actual103AT-2 catalog evidence exist, but external pack-boundNTC/harness is not installed or qualified. Need typed external-component terminal binding,NTC R25/Beta tolerances,thermal coupling,temperature-window/fault-response and immutable qualification receipt. No external thermistor is falsely placed on the PCB.' },
      { rule: 'battery-pass-through-state-unsupported', severity: 'error', message: 'Current schema cannot express mutually exclusive USBcharge/battery-discharge states of bidirectionalBAT pads and a non-regulating BAT-to-SYS FET path with load-dependent drop. No fake external battery source is paralleled with charger output to bypass this gap.' },
      { rule: 'qualified-pack-minimum-unproved', severity: 'error', message: 'No actual protectedpack guarantees>=3.2V atconnector under the declared load through cutoff,>=1A discharge,>=210mA charge and correct thermal/polarity/harness conditions. GenericLiPo protection often cuts off lower; hardwareUVLO or qualifiedpack proof is required.' },
      { rule: 'quiet-audio-current-not-enforced', severity: 'error', message: 'CandidateMAX98357A3.0–4.5V/8Ohm audio<=0.1Wtyp/0.25Wpeak uses70% assumed efficiency plus4mAICoverhead, reserved60/125mA. It requires a separate reviewed audio variant and enforceable signal/gain/duty limit; hardware can draw more at fullscale. Current5Vaudio draft is not this variant.' },
    ] }];
}

/** Transparent arithmetic for the requested USB state; not measured hardware evidence. */
export function powerEvidenceGates(drafts: BlockDraft[]): GateResult[] {
  const charger = drafts.find(b => b.id === 'bq24074-usb-300ma-ts-bypass')!, converter = drafts.find(b => b.id === 'tps63001-usb-sys-3v3')!;
  const inputMin = charger.ports.find(p => p.id === 'VBUS')!.volts!.min, inputMax = charger.ports.find(p => p.id === 'VBUS')!.volts!.max;
  const sys = charger.ports.find(p => p.id === 'SYS')!.volts!, out = converter.ports.find(p => p.id === 'V3V3')!.volts!;
  const efficiency = converter.power.sources[0]!.efficiency!;
  const peak3v3 = 500 + 50 + 50 + .6 + 2; // MCU, header reserve, display, mic, SHT40.
  const typical3v3 = 200 + 0 + 50 + .53 + .5;
  const sysPeak = peak3v3 * out.max / (sys.min * efficiency) + .1;
  const usbPeak = sysPeak + 330 + 10 + 500 + 63; // charge, BQ overhead, amp, LED.
  const usbTypical = typical3v3 * out.max / (sys.min * efficiency) + .1 + 330 + 5 + 380 + 39;
  const ilimLow = 1500 / (1200 * 1.01) * 1000;
  const bqCombinedW = (inputMax - sys.min) * 700 / 1000 + (inputMax - 3) * 330 / 1000;
  // Buck CCM screening only: worst deltaI across this USB-state rectangle at VINmax/VOUTmin,
  // fmin1.25MHz and Lmin1.76uH. This does not bound start-up/core-loss/boost transients.
  const rippleA = (sys.max - out.min) * (out.min / sys.max) / (1.25e6 * 2.2e-6 * .8);
  const inductorPeakWithMarginA = (.8 + rippleA / 2) * 1.2;
  const inductorRmsA = Math.sqrt(.8 ** 2 + rippleA ** 2 / 12);
  const measurements = [
    { where: 'USB-present', name: 'qualifiedUSB peak allocation', measured: usbPeak, target: 1500, tolerance: 0, unit: 'mA', ok: usbPeak <= 1500 },
    { where: 'USB-present', name: 'qualifiedUSB typical allocation', measured: usbTypical, target: 1500, tolerance: 0, unit: 'mA', ok: usbTypical <= 1500 },
    { where: 'BQ24074', name: 'promisedSYS peak plus charging and overhead', measured: 890 + 330 + 10, target: ilimLow, tolerance: 0, unit: 'mA', ok: 1230 <= ilimLow },
    { where: 'BQ24074', name: 'summedSYS+BAT continuous thermal screen', measured: 25 + bqCombinedW * 44.5, target: 110, tolerance: 0, unit: 'C', ok: 25 + bqCombinedW * 44.5 <= 110 },
    { where: 'TPS63001', name: 'requested3.3V peak allocation', measured: peak3v3, target: converter.power.sources[0]!.maxMa, tolerance: 0, unit: 'mA', ok: peak3v3 <= converter.power.sources[0]!.maxMa },
    { where: 'BQ24074', name: 'SYS minimum plus specified dropout', measured: sys.min + .475, target: inputMin, tolerance: 0, unit: 'V', ok: sys.min + .475 <= inputMin },
    { where: 'LPS4012-222MRC', name: 'USB buckCCM peak plus20% margin', measured: inductorPeakWithMarginA, target: 2.3, tolerance: 0, unit: 'A', ok: inductorPeakWithMarginA <= 2.3 },
    { where: 'LPS4012-222MRC', name: 'USB buckCCM RMS screen', measured: inductorRmsA, target: 1.2, tolerance: 0, unit: 'A', ok: inductorRmsA <= 1.2 },
  ];
  const issues: GateResult['issues'] = measurements.filter(m => !m.ok).map(m => ({ rule: 'usb-allocation', severity: 'error', where: m.where, message: `${m.name} exceeds the declared state bound` }));
  issues.push({ rule: 'allocation-assumptions', severity: 'warning', message: 'Arithmetic uses author peripheral budgets,85% assumed efficiency, output+/-5% envelope and25C reference thermal model. Not measured source/thermal/transient/charge behavior; only USB-present state. 1.5A source must maintain4.75V atboard. BQILIM does not include directUSB amp/LED.' });
  return [{ gate: 'power', ok: !issues.some(i => i.severity === 'error'), issues, measurements }, { gate: 'verify', ok: false, issues: [
    { rule: 'battery-state-unverified', severity: 'error', message: 'Battery-fallback/absent/supplement/DPPM states are not represented by this single USB-present graph. Do not claim battery runtime or guaranteed battery output.' },
    { rule: 'battery-pack-unselected', severity: 'error', message: 'Protected4.2V one-cell pack, >=330mA charge/discharge capability, polarity and external temperature supervision have not been selected/verified. Charger is not pack protection.' },
    { rule: 'pack-temperature-disabled', severity: 'error', message: 'Fixed10k TS bypass intentionally disables battery-temperature monitoring; safety review or external supervision required before promotion.' },
    { rule: 'effective-capacitance-unverified', severity: 'error', message: 'Actual nominal catalog values are sourced, but tolerance/DC-bias/temperature-dependent effective capacitance and ESR are not independently verified.' },
    { rule: 'hardware-power-unverified', severity: 'error', message: 'Native routing, ground/power loops/EP thermal copper, loaded output voltage/efficiency, switch/inductor transient/current/temperature, USB startup and charger termination remain unverified. Typical curves support assumptions, not hardware guarantees.' },
  ] }];
}

export function createPowerBundle(parts: CatalogPart[]): PowerDraftBundle {
  const catalog = new Map(parts.map(p => [p.lcsc, p])); if (catalog.size !== parts.length) throw new Error('Duplicate power catalog identity');
  const drafts = createPowerDrafts(catalog);
  return { drafts, catalog: structuredClone(parts), gates: [...drafts.flatMap(d => checkBlockDraft(d, catalog)), checkPowerReference(drafts), checkNtcPowerReference(drafts), ...powerEvidenceGates(drafts), ...batteryAndNtcEvidenceGates()] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parts: CatalogPart[] = [];
  for (const [id] of Object.values(POWER_PARTS)) parts.push(await registerPart(id));
  const bundle = createPowerBundle(parts);
  await writeFile(resolve('src/blocks/data/power-drafts.json'), JSON.stringify(bundle, null, 2) + '\n');
  console.log(JSON.stringify({ drafts: bundle.drafts.map(d => d.id), parts: parts.length, gates: bundle.gates.map(g => ({ gate: g.gate, ok: g.ok, errors: g.issues.filter(i => i.severity === 'error') })) }, null, 2));
}
