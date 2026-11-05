import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { saveBlockDraft, checkPlan, listBlocks } from '../../src/blocks/library';
import type { BoardPlan, BlockDraft } from '../../src/blocks/contract';
const draft: BlockDraft = JSON.parse(await readFile('src/blocks/data/sht40-draft.json', 'utf8'));
await saveBlockDraft(draft);
const plan: BoardPlan = JSON.parse(await readFile('src/blocks/data/spike-plan.json', 'utf8'));
plan.title = 'ESP32-S3 SHT40 temperature and humidity board';
plan.drafts = [draft];
plan.blocks.push({
  inst: 'sht40',
  block: draft.id,
  version: draft.version,
  params: {},
  at: { x: 20, y: -2 },
});
plan.links.push(
  { from: 'ldo-ap2112-3v3.V3V3', to: 'sht40.V3V3' },
  { from: 'esp32-s3-core.GND', to: 'sht40.GND' },
  { from: 'esp32-s3-core.I2C', to: 'sht40.I2C' },
);
plan.sections!.push({
  id: 'sensor',
  title: 'SHT40 · temperature and humidity',
  purpose: draft.summary,
  insts: ['sht40'],
  notes: [
    '0x44, 100kHz; heater disabled; CRC-8 checked by firmware.',
    '100nF local bypass; shared10k pull-ups; no central copper/paste.',
  ],
  reference: {
    lcsc: 'C2909890',
    datasheetUrl: draft.parts[0]!.datasheet.url,
    page: 16,
    quote: 'There shall be no copper under the sensor other than at the pin pads.',
  },
});
plan.requirements = [
  {
    id: 'usb',
    plain: 'Has a USB-C sink interface',
    metric: 'interface_present',
    args: { kind: 'usb_c_sink' },
    op: 'present',
    source: 'maker',
  },
  {
    id: 'size',
    plain: 'Fits a60by70mm board',
    metric: 'board_size_mm',
    op: '<=',
    value: [60, 70],
    source: 'maker',
  },
  {
    id: 'count',
    plain: 'No more than24 placed parts',
    metric: 'part_count',
    op: '<=',
    value: 24,
    source: 'maker',
  },
];
plan.app = {
  source: `#include <Arduino.h>
#include <Wire.h>
#include "pins.h"
static uint8_t crc8(const uint8_t *p) {uint8_t c=0xff;for(int i=0;i<2;i++){c^=p[i];for(int j=0;j<8;j++)c=(c&0x80)?uint8_t((c<<1)^0x31):uint8_t(c<<1);}return c;}
void setup(){Serial.begin(115200);Wire.begin(PIN_SHT40_I2C_SDA,PIN_SHT40_I2C_SCL);Wire.setClock(100000);delay(10);}
void loop(){Wire.beginTransmission(0x44);Wire.write(0xFD);if(Wire.endTransmission()!=0){Serial.println("Sensor unavailable");delay(1000);return;}delay(10);if(Wire.requestFrom(uint8_t(0x44),uint8_t(6))!=6){Serial.println("Sensor read failed");delay(1000);return;}uint8_t b[6];for(int i=0;i<6;i++)b[i]=Wire.read();if(crc8(b)!=b[2]||crc8(b+3)!=b[5]){Serial.println("Sensor CRC failed");delay(1000);return;}float t=-45.0f+175.0f*((uint16_t(b[0])<<8)|b[1])/65535.0f;float h=-6.0f+125.0f*((uint16_t(b[3])<<8)|b[4])/65535.0f;h=constrain(h,0.0f,100.0f);Serial.print(t,2);Serial.print(" C, ");Serial.print(h,2);Serial.println(" %RH");delay(1000);}
`,
};
const gates = checkPlan(plan);
if (gates.some((g) => !g.ok)) throw new Error(JSON.stringify(gates));
const out = resolve('docs/engineering/2026-11-05-chip-level/evidence/chip_eda/sht40-board');
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'plan.json'), JSON.stringify(plan, null, 2));
await writeFile(resolve(out, 'preflight.json'), JSON.stringify(gates, null, 2));
console.log(out);
