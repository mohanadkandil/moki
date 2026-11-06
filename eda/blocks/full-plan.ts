import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listBlocks, materializeDraft, checkPlan, contentHash } from '../../src/blocks/library';
import type { BlockDraft, BoardPlan } from '../../src/blocks/contract';
const references = JSON.parse(await readFile('src/blocks/data/full-template-references.json', 'utf8'));
const initial: BoardPlan = JSON.parse(await readFile('src/blocks/data/spike-plan.json', 'utf8'));
const peripherals = JSON.parse(await readFile('src/blocks/data/peripheral-drafts.json', 'utf8')),
  power = JSON.parse(await readFile('src/blocks/data/power-drafts.json', 'utf8'));
const drafts: BlockDraft[] = [...peripherals.drafts, ...power.drafts];
const original = listBlocks().find((b) => b.id === 'esp32-s3-core')!;
const { contentHash: _hash, status: _status, provenance, ...fields } = structuredClone(original);
const mcu: BlockDraft = {
  ...fields,
  id: 'esp32-s3-audio-core',
  title: 'ESP32-S3 · I2S capture and playback',
  provenance: { author: provenance.author, authorId: provenance.authorId },
};
const chip = mcu.parts.find((p) => p.ref === 'U1')!;
for (const pad of ['4', '5', '7', '8', '9', '10']) chip.pins[pad]!.role = 'output';
chip.pins['6']!.role = 'input';
mcu.ports.push(
  {
    id: 'I2S_MIC',
    label: 'I2S microphone RX',
    kind: 'bus',
    bus: { protocol: 'i2s', role: 'controller', signals: { BCLK: 'U1.4', WS: 'U1.5', SD: 'U1.6' } },
  },
  {
    id: 'I2S_AMP',
    label: 'I2S speaker TX',
    kind: 'bus',
    bus: { protocol: 'i2s', role: 'controller', signals: { BCLK: 'U1.7', WS: 'U1.8', SD: 'U1.9' } },
  },
  { id: 'LED_DATA', label: 'Level-shifted WS2812 data', kind: 'gpio', terminal: 'U1.10' },
);
mcu.firmware!.includes.push('driver/i2s.h');
mcu.firmware!.usage +=
  ' I2S0 RX: GPIO4 BCLK,5 WS,6 data-in. I2S1 TX: GPIO7 BCLK,15 WS,16 data-out. GPIO17 goes only to AHCT LED input. Native USB and boot pins remain fixed.';
drafts.push(mcu);
const plan: BoardPlan = {
  schema: 'moki.plan/1',
  title: 'ESP32-S3 audio display control board · qualified USB operation',
  layers: 2,
  board: { widthMm: 100, heightMm: 120, cornerRadiusMm: 3 },
  blocks: [],
  links: [],
  sections: [],
  drafts,
};
const add = (inst: string, id: string, x: number, y: number) => {
  const b = [...listBlocks(), ...drafts.map(materializeDraft)]
    .filter((b) => b.id === id)
    .sort((a, b) => a.version - b.version)
    .at(-1)!;
  if (!b) throw new Error('Unknown ' + id);
  plan.blocks.push({ inst, block: id, version: b.version, params: {}, at: { x, y } });
  plan.sections!.push({
    id: inst,
    title: b.title,
    purpose: b.summary,
    insts: [inst],
    notes: [
      b.power.sources.length
        ? 'Source ratings apply only to the declared USB operating condition.'
        : 'Actual imported parts; electrical and thermal budgets are assumptions pending hardware tests.',
      ...(id.includes('bq24074')
        ? [
            'External qualified10k NTC and protected cell required; battery mode not validated by this USB-state template.',
          ]
        : []),
    ],
    ...(b.parts.some((p) => p.ref.startsWith('U'))
      ? {
          reference: {
            lcsc: b.parts.find((p) => p.ref.startsWith('U'))!.lcsc,
            datasheetUrl: b.parts.find((p) => p.ref.startsWith('U'))!.datasheet.url,
            page: inst === 'mcu' ? 41 : 1,
            quote:
              inst === 'mcu'
                ? 'This is the typical application circuit of the module'
                : inst === 'usb'
                  ? 'Very low capacitance ESD protection'
                  : inst === 'charger'
                    ? 'Standalone 1-Cell 1.5-A Linear Battery Chargers with Power Path'
                    : inst === 'buck'
                      ? 'High-Efficient Single Inductor Buck-Boost Converter'
                      : inst === 'mic'
                        ? 'Multi-Mode Microphone with I2S Digital Output'
                        : inst === 'amp'
                          ? 'Simply supply power, LRCLK,'
                          : inst === 'led'
                            ? 'Single Bus Buffer Gate With 3-State Output'
                            : 'External module header: source circuit is a declared interface contract',
          },
        }
      : {}),
  });
};
add('mcu', mcu.id, 0, 32);
add('usb', 'usb-c-sink', -25, -42);
add('buttons', 'boot-reset-buttons', 0, -27);
add('header', 'i2c-header', 30, 40);
add('charger', 'bq24074-usb-190ma-ntc-required', 0, -4);
add('buck', 'tps63001-usb-sys-3v3', -24, 8);
add('mic', 'i2s-mic-ics43434', 30, 16);
add('amp', 'i2s-amp-max98357a', 28, -12);
add('display', 'ssd1306-i2c-header', 30, -42);
add('led', 'ws2812b-v5-levelshift', -30, -14);
const link = (from: string, to: string) => plan.links.push({ from, to });
for (const i of plan.blocks.filter((i) => i.inst !== 'mcu')) link('mcu.GND', i.inst + '.GND');
link('usb.VBUS', 'charger.VBUS');
link('usb.VBUS', 'amp.V5');
link('usb.VBUS', 'led.V5');
link('charger.SYS', 'buck.SYS');
for (const inst of ['mcu', 'header', 'mic', 'display']) link('buck.V3V3', inst + '.V3V3');
for (const port of ['EN', 'BOOT']) link('mcu.' + port, 'buttons.' + port);
link('mcu.USB', 'usb.USB');
link('mcu.I2C', 'header.I2C');
link('mcu.I2C', 'display.I2C_DISPLAY');
link('mcu.I2S_MIC', 'mic.I2S_MIC');
link('mcu.I2S_AMP', 'amp.I2S_AMP');
link('mcu.LED_DATA', 'led.LED_DATA');
plan.drafts = drafts.filter((d) => plan.blocks.some((i) => i.block === d.id && i.version === d.version));
for (const section of plan.sections!) if (references[section.id]) section.reference = references[section.id];
plan
  .sections!.find((s) => s.id === 'charger')!
  .notes.push('Reference adapts example charging current to190mA; ITERM/TMR use datasheet defaults.');
plan
  .sections!.find((s) => s.id === 'amp')!
  .notes.push('Reference Rev16 Fig17 uses WLP names; selected TQFN mapping is checked separately.');
plan.app = { source: await readFile(resolve(import.meta.dir, 'full-app.cpp'), 'utf8') };
const defs = [...listBlocks(), ...drafts.map(materializeDraft)],
  gates = checkPlan(plan, defs),
  out = resolve('docs/engineering/2026-11-05-chip-level/evidence/chip_eda/full-template');
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'plan.json'), JSON.stringify(plan, null, 2));
await writeFile(resolve(out, 'preflight.json'), JSON.stringify(gates, null, 2));
console.log(JSON.stringify(gates));
