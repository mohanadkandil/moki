import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { registerPart, contentHash } from '../../src/blocks/library';
import { importedPinMap } from './imported';
import { checkBlockDraft, checkPlan } from '../../src/blocks/erc';
import type {
  BlockDraft,
  BlockDef,
  BlockPart,
  BoardPlan,
  CatalogPart,
  Citation,
} from '../../src/blocks/contract';
const root = resolve('src/blocks/data');
await mkdir(root, { recursive: true });
const original = await Bun.file(
  'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/spike/input.json',
).json();
const catalogs = new Map<string, CatalogPart>();
for (const id of [...new Set<string>(original.parts.map((p: any) => p.lcsc)), 'C2909890']) {
  const p = await registerPart(id);
  catalogs.set(id, p);
}
const esp: Citation = {
  url: 'https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf',
  pages: '11–16, 41, 45–46',
  note: 'Reference pin map, 10k/1uF EN reset, 22uF+100nF supply bypass; see retained manufacturer PDF.',
};
const ap: Citation = {
  url: 'https://www.diodes.com/datasheet/download/AP2112.pdf',
  pages: '1–4, 12',
  note: 'AP2112K fixed 3.3V reference; 1uF input/output; thermal rating conditional on board and ambient.',
};
const usb: Citation = {
  url: 'https://www.st.com/resource/en/datasheet/usblc6-2.pdf',
  pages: '1–3',
  note: 'Data-line pass-through pairs 1/6 and 3/4, GND2, VBUS5.',
};
const usbHardware: Citation = {
  url: 'https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/esp-hardware-design-guidelines-en-master-esp32s3.pdf',
  pages: '21',
  note: 'USB section: GPIO19 D-/GPIO20 D+; initial series values22/33Ohm, close to MCU. Native autorouting does not prove90Ohm differential impedance.',
};
const cc: Citation = {
  url: 'https://community.infineon.com/t5/Knowledge-Base-Articles/USB-Type-C-connector-Rp-Rd-and-Ra-termination-resistors/ta-p/253544',
  note: 'Manufacturer KBA: upstream-facing peripheral has Rd on CC pins; fixed5.1kOhm. Current advertising must be supplied by the knownexternal5V1.5A source.',
};
const sht: Citation = {
  url: 'https://sensirion.com/media/documents/33FD6951/6A7C10A0/HT_DS_Datasheet_SHT4x_V7.3.pdf',
  pages: '9–16',
  note: 'SHT40 address0x44; 100nF bypass, no central copper pad; heater disabled.',
};
const q = (url: string, note: string): Citation => ({ url, note });
const padGPIO: Record<string, number> = {
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 15,
  '9': 16,
  '10': 17,
  '11': 18,
  '12': 8,
  '15': 3,
  '16': 46,
  '17': 9,
  '18': 10,
  '19': 11,
  '20': 12,
  '21': 13,
  '22': 14,
  '23': 21,
  '24': 47,
  '25': 48,
  '26': 45,
  '27': 0,
  '28': 35,
  '29': 36,
  '30': 37,
  '31': 38,
  '32': 39,
  '33': 40,
  '34': 41,
  '35': 42,
  '38': 2,
  '39': 1,
};
const role = (ref: string, pad: string): BlockPart['pins'][string] => {
  const base = { pad, role: 'passive' as any };
  if (ref === 'U1') {
    if (['1', '40', '41'].includes(pad)) return { pad, role: 'ground', required: true };
    if (pad === '2') return { pad, role: 'power-in', required: true, volts: { min: 3, max: 3.6 } };
    return {
      pad,
      role: ['3', '15', '16', '26', '27'].includes(pad)
        ? 'input'
        : ['12', '17'].includes(pad)
          ? 'open-drain'
          : 'bidirectional',
      ...(['3', '12', '13', '14', '17', '27'].includes(pad) ? { required: true } : {}),
      volts: { min: 0, max: 3.6 },
    };
  }
  if (ref === 'U2')
    return {
      pad,
      role:
        pad === '1'
          ? 'power-in'
          : pad === '2'
            ? 'ground'
            : pad === '3'
              ? 'input'
              : pad === '5'
                ? 'power-out'
                : 'nc',
      ...(['1', '2', '3', '5'].includes(pad) ? { required: true } : {}),
    };
  if (ref === 'U3' && pad === '2') return { pad, role: 'ground', required: true };
  if (ref === 'J2' && ['5', '6'].includes(pad)) return { pad, role: 'nc' };
  return base;
};
const importedMaps = new Map<string, Map<string, string>>();
for (const [id, c] of catalogs) {
  if (id === 'C2909890') continue;
  importedMaps.set(id, importedPinMap(await Bun.file(`eda/blocks/parts/${id}/raw.json`).json()));
}
// Keep the proven PCB arrangement, improving the LDO output bypass distance.
original.parts.find((p: any) => p.ref === 'C2').x = -17;
original.parts.find((p: any) => p.ref === 'C2').y = 25;
const definitions: BlockDef[] = [];
const placements: BoardPlan['blocks'] = [];
const groups: Record<string, { title: string; class: string; refs: string[]; citation: Citation }> = {
  'esp32-s3-core': {
    title: 'ESP32-S3 + reset and boot bias',
    class: 'mcu',
    refs: ['U1', 'C3', 'C4', 'C5', 'R1', 'R2', 'R9', 'R10'],
    citation: esp,
  },
  'usb-c-sink': {
    title: 'USB-C sink + ESD',
    class: 'usb',
    refs: ['J1', 'U3', 'R3', 'R4', 'R5', 'R6'],
    citation: usb,
  },
  'ldo-ap2112-3v3': { title: '3.3 V regulator', class: 'power', refs: ['U2', 'C1', 'C2'], citation: ap },
  'boot-reset-buttons': {
    title: 'BOOT / RESET buttons',
    class: 'input',
    refs: ['SW1', 'SW2'],
    citation: esp,
  },
  'i2c-header': {
    title: 'I2C expansion header',
    class: 'connector',
    refs: ['J2', 'R7', 'R8'],
    citation: esp,
  },
};
const refs = new Map(Object.entries(groups).flatMap(([id, g]) => g.refs.map((ref) => [ref, id] as const)));
const netNames = Object.keys(original.nets);
for (const [id, g] of Object.entries(groups)) {
  const selected = original.parts.filter((p: any) => g.refs.includes(p.ref));
  const xs = selected.map((p: any) => p.x),
    ys = selected.map((p: any) => p.y);
  const anchor = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const parts: BlockPart[] = selected.map((p: any) => {
    const c = catalogs.get(p.lcsc)!;
    const value = p.ref.startsWith('C')
      ? ({ C3: '22uF', C4: '100nF' }[p.ref] ?? '1uF')
      : p.ref.startsWith('R')
        ? ['R3', 'R4'].includes(p.ref)
          ? '5.1kOhm'
          : ['R5', 'R6'].includes(p.ref)
            ? '22Ohm'
            : '10kOhm'
        : undefined;
    return {
      ref: p.ref,
      lcsc: p.lcsc,
      mpn: c.mpn,
      catalogReceipt: c.catalogReceipt,
      datasheet: g.citation,
      pinout: 'verified',
      pins: Object.fromEntries(
        c.pins.map((pin) => {
          const logical = importedMaps.get(p.lcsc)!.get(pin.pad)!.replace(/^pin/, '');
          return [logical, { ...role(p.ref, logical), pad: pin.pad }];
        }),
      ),
      at: { x: p.x - anchor.x, y: p.y - anchor.y, rotation: p.rotation },
      ...(value
        ? {
            value,
            valueWhy: ['R5', 'R6'].includes(p.ref)
              ? usbHardware
              : ['R3', 'R4'].includes(p.ref)
                ? cc
                : g.citation,
          }
        : {}),
      ...(['SW1', 'SW2'].includes(p.ref) ? { switch: 'normally-open' as const } : {}),
      ...(p.ref === 'U1'
        ? {
            correction: {
              ...esp,
              note: 'Omit 12 unassigned 0.25/0.4mm imported thermal vias; retain every electrical pad. EP solder/thermal vias optional.',
            },
          }
        : {}),
    };
  });
  const nets = netNames
    .map((name) => ({
      name,
      pins: (original.nets[name] as string[]).filter((pin) => g.refs.includes(pin.split('.')[0]!)),
    }))
    .filter((n) => n.pins.length);
  const cross = nets.filter((n) =>
    (original.nets[n.name] as string[]).some((pin) => refs.get(pin.split('.')[0]!) !== id),
  );
  const ports: BlockDef['ports'] = cross
    .filter((n) => !['SDA', 'SCL', 'USB_DP_MCU', 'USB_DM_MCU'].includes(n.name))
    .map((n) => ({
      id: n.name,
      label: n.name,
      kind:
        n.name === 'GND'
          ? 'ground'
          : n.name === 'VBUS'
            ? id === 'usb-c-sink'
              ? 'power-out'
              : 'power-in'
            : n.name === 'V3V3'
              ? id === 'ldo-ap2112-3v3'
                ? 'power-out'
                : 'power-in'
              : 'gpio',
      terminal: `net:${n.name}`,
      ...(['EN', 'BOOT'].includes(n.name) ? { fixedFunction: n.name === 'EN' ? 'reset' : 'boot' } : {}),
      ...(n.name === 'V3V3'
        ? { volts: id === 'ldo-ap2112-3v3' ? { min: 3.234, max: 3.366 } : { min: 3, max: 3.6 } }
        : n.name === 'VBUS'
          ? { volts: id === 'usb-c-sink' ? { min: 4.75, max: 5.25 } : { min: 4.5, max: 5.25 } }
          : {}),
    }));
  if (nets.some((n) => n.name === 'SDA'))
    ports.push({
      id: 'I2C',
      label: 'I2C',
      kind: 'bus',
      bus: {
        protocol: 'i2c',
        role: id === 'esp32-s3-core' ? 'controller' : 'passive',
        signals: { SDA: 'net:SDA', SCL: 'net:SCL' },
      },
    });
  if (nets.some((n) => n.name === 'USB_DP_MCU'))
    ports.push({
      id: 'USB',
      label: 'Native USB',
      kind: 'bus',
      bus: {
        protocol: 'usb2',
        role: id === 'esp32-s3-core' ? 'peripheral' : 'passive',
        signals: { DP: 'net:USB_DP_MCU', DM: 'net:USB_DM_MCU' },
      },
    });
  const constraints: BlockDef['constraints'] = [];
  const power: BlockDef['power'] = { sources: [], sinks: [] };
  const dec = (
    ic: string,
    powerPin: string,
    groundPin: string,
    caps: string[],
    minUf: number,
    distance: number,
  ) =>
    constraints.push({
      kind: 'decoupling',
      ic,
      powerPin,
      groundPin,
      caps,
      minUf,
      maxDistanceMm: distance,
      citation: g.citation,
    });
  if (id === 'esp32-s3-core') {
    dec('U1', '2', '1', ['C3', 'C4'], 22.1, 25);
    constraints.push(
      { kind: 'pullup', pin: 'U1.3', to: 'net:V3V3', resistor: 'R1', ohms: 10000, citation: esp },
      { kind: 'strap', pin: 'U1.27', safe: 'high', resistor: 'R2', to: 'net:V3V3', citation: esp },
      { kind: 'strap', pin: 'U1.26', safe: 'low', resistor: 'R9', to: 'net:GND', citation: esp },
      { kind: 'strap', pin: 'U1.16', safe: 'low', resistor: 'R10', to: 'net:GND', citation: esp },
      { kind: 'strap', pin: 'U1.15', safe: 'floating', citation: esp },
      {
        kind: 'keepout',
        x: -anchor.x,
        y: 31.4 - anchor.y,
        width: 29,
        height: 7.2,
        layers: ['top', 'bottom'],
        excludeParts: ['U1'],
        purpose: 'ESP32-S3 antenna: no copper or other components; exclude only its own module courtyard',
        citation: esp,
      },
    );
    power.sinks.push({ port: 'V3V3', typicalMa: 200, peakMa: 500 });
  } else if (id === 'usb-c-sink') {
    power.sources.push({ port: 'VBUS', volts: 5, maxMa: 1500, mode: 'external' });
    constraints.push({
      kind: 'usb-c-sink',
      connector: 'J1',
      cc1: '6',
      cc2: '12',
      resistors: ['R3', 'R4'],
      ohms: 5100,
      citation: cc,
    });
  } else if (id === 'ldo-ap2112-3v3') {
    dec('U2', '1', '2', ['C1'], 1, 6);
    dec('U2', '5', '2', ['C2'], 1, 6);
    power.sources.push({
      port: 'V3V3',
      volts: 3.3,
      maxMa: 600,
      continuousMa: 250,
      inputPort: 'VBUS',
      mode: 'regulated',
      conversion: 'linear',
      dropoutV: 0.4,
      thermal: { thetaJa: 184, maxJunctionC: 125, ambientC: 25 },
    });
    power.sinks.push({ port: 'VBUS', typicalMa: 0.055, peakMa: 0.1 });
  } else if (id === 'i2c-header') {
    power.sinks.push({ port: 'V3V3', typicalMa: 0, peakMa: 50 });
    constraints.push(
      { kind: 'pullup', pin: 'net:SDA', to: 'net:V3V3', resistor: 'R7', ohms: 10000, citation: esp },
      { kind: 'pullup', pin: 'net:SCL', to: 'net:V3V3', resistor: 'R8', ohms: 10000, citation: esp },
    );
  }
  const draft: BlockDraft = {
    schema: 'moki.block/1',
    id,
    version: id === 'ldo-ap2112-3v3' ? 2 : 1,
    title: g.title,
    summary:
      id === 'usb-c-sink'
        ? 'USB-C Rd sink with native data ESD. Requires a known 5V supply advertising at least1.5A; no PD negotiation/current-detection claim.'
        : g.title,
    class: g.class,
    provenance: { author: 'agent', authorId: 'chip_eda' },
    parts,
    nets,
    params: [],
    ports,
    power,
    constraints,
    firmware: {
      libs: [],
      includes: ['Arduino.h', 'pins.h', ...(id === 'i2c-header' ? ['Wire.h'] : [])],
      usage:
        id === 'i2c-header'
          ? '3.3V header: contacts1GND,2VCC,3SDA,4SCL. Budget50mA max for external device.'
          : 'Fixed native USB and BOOT/RESET are not application GPIOs.',
    },
    ...(id === 'esp32-s3-core'
      ? {
          mcu: {
            family: 'esp32s3',
            pio: {
              platform: 'platformio/espressif32@6.10.0',
              board: 'esp32-s3-devkitc-1',
              framework: 'arduino',
              environment: 'esp32s3',
            },
            pins: [
              {
                id: 'U1.3',
                gpio: 'EN',
                caps: ['input', 'reset'],
                fixedFunction: 'reset',
                reserved: 'Dedicated enable/reset input',
              },
              {
                id: 'U1.27',
                gpio: 0,
                caps: ['input', 'boot'],
                fixedFunction: 'boot',
                reserved: 'Boot strap control',
              },
              {
                id: 'U1.13',
                gpio: 19,
                caps: ['input', 'output', 'bidirectional', 'usb2'],
                fixedFunction: 'usb2',
                reserved: 'Native USB D-',
              },
              {
                id: 'U1.14',
                gpio: 20,
                caps: ['input', 'output', 'bidirectional', 'usb2'],
                fixedFunction: 'usb2',
                reserved: 'Native USB D+',
              },
              ...Object.entries(padGPIO)
                .filter(([pad]) => !['15', '16', '26', '27', '28', '29', '30'].includes(pad))
                .map(([pad, gpio]) => ({
                  id: `U1.${pad}`,
                  gpio,
                  caps: [
                    'input',
                    'output',
                    'bidirectional',
                    'open-drain',
                    'i2c',
                    'spi',
                    'i2s',
                    'uart',
                    'pwm',
                    ...(gpio <= 20 ? ['adc'] : []),
                  ],
                })),
            ],
            flashKb: 8192,
            ramKb: 512,
          },
          spiceChecks: [
            {
              kind: 'rc-reset',
              name: 'EN reaches75% VDD',
              resistor: 'R1',
              capacitor: 'C5',
              supplyV: 3.3,
              thresholdRatio: 0.75,
              target: 13.8629436,
              tolerance: 0.25,
              citation: esp,
            },
          ],
        }
      : {}),
  };
  const gates = checkBlockDraft(draft, catalogs);
  const errors = gates.flatMap((x) => x.issues.filter((y) => y.severity === 'error'));
  if (errors.length) console.error(id, JSON.stringify(errors));
  definitions.push({
    ...draft,
    contentHash: contentHash(draft),
    status: 'unreviewed',
    provenance: { ...draft.provenance, reviews: [] },
  });
  placements.push({ inst: id, block: id, version: draft.version, params: {}, at: anchor });
}
const links: BoardPlan['links'] = [];
for (const name of ['GND', 'VBUS', 'V3V3', 'EN', 'BOOT']) {
  const instances = definitions.filter((d) => d.ports.some((p) => p.id === name));
  for (let i = 1; i < instances.length; i++)
    links.push({ from: `${instances[0]!.id}.${name}`, to: `${instances[i]!.id}.${name}` });
}
links.push(
  { from: 'esp32-s3-core.I2C', to: 'i2c-header.I2C' },
  { from: 'esp32-s3-core.USB', to: 'usb-c-sink.USB' },
);
const plan: BoardPlan = {
  schema: 'moki.plan/1',
  title: 'ESP32-S3 USB-C control board',
  layers: 2,
  board: { widthMm: 60, heightMm: 70, cornerRadiusMm: 0 },
  blocks: placements,
  links,
  sections: definitions.map((d) => ({
    id: d.id,
    title: d.title,
    purpose: d.summary,
    insts: [d.id],
    notes:
      d.id === 'usb-c-sink'
        ? [
            'CC1/CC2: independent5.1k pull-downs; sink only.',
            'Supply contract: known5V/1.5A Type-C source; no PD negotiation.',
          ]
        : d.id === 'esp32-s3-core'
          ? [
              'EN:10k/1uF reset delay; GPIO0 pull-up with BOOT switch.',
              'GPIO45/46 pull-downs; antenna no-copper keepout.',
            ]
          : d.id === 'ldo-ap2112-3v3'
            ? [
                'AP2112:600mA IC rating,250mA continuous board budget at25°C.',
                '1uF input/output bypass; no thermal-transient proof.',
              ]
            : ['Real imported parts and named nets; see block reference.'],
    ...(d.parts.some((p) => p.ref.startsWith('U'))
      ? {
          reference: {
            lcsc: d.parts.find((p) => p.ref.startsWith('U'))!.lcsc,
            datasheetUrl: d.parts.find((p) => p.ref.startsWith('U'))!.datasheet.url,
            page: d.id === 'esp32-s3-core' ? 41 : d.id === 'ldo-ap2112-3v3' ? 2 : 1,
            quote:
              d.id === 'esp32-s3-core'
                ? 'This is the typical application circuit of the module'
                : d.id === 'usb-c-sink'
                  ? 'Very low capacitance ESD protection'
                  : 'Typical Applications Circuit',
          },
        }
      : {}),
  })),
};
const history: BlockDef[] = (await Bun.file(resolve(root, 'seed.json')).exists())
  ? await Bun.file(resolve(root, 'seed.json')).json()
  : [];
await writeFile(resolve(root, 'parts.json'), JSON.stringify([...catalogs.values()], null, 2));
await writeFile(
  resolve(root, 'seed.json'),
  JSON.stringify(
    [...history.filter((b) => b.id === 'ldo-ap2112-3v3' && b.version === 1), ...definitions],
    null,
    2,
  ),
);
await writeFile(resolve(root, 'spike-plan.json'), JSON.stringify(plan, null, 2));
await writeFile(
  'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/seed-gates.json',
  JSON.stringify(checkPlan(plan, definitions), null, 2),
);
console.log(
  JSON.stringify(
    { blocks: definitions.length, parts: catalogs.size, planGates: checkPlan(plan, definitions) },
    null,
    2,
  ),
);
