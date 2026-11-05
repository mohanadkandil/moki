// What a carrier design can answer for the requirement engine. Currents are typical module figures, so anything
// computed from them is labelled estimated. A carrier board runs from USB, so it has no battery of its own.
import { MODULE, pinDef } from '../circuit/catalog.js';
import type { CircuitDesign } from '../circuit/model.js';
import type { DeviceFacts } from './protocol.js';
import type { AgentJob } from './facts.js';

/** Typical draw with no radio in use, in mA. Estimates, not measurements of these boards. */
const TYPICAL_MA: Record<string, { typical: number; peak: number }> = {
  [MODULE.esp32]: { typical: 60, peak: 120 }, [MODULE.oled]: { typical: 15, peak: 25 }, [MODULE.encoder]: { typical: 1, peak: 1 },
  [MODULE.ds18b20]: { typical: 1, peak: 2 }, [MODULE.bme280]: { typical: 1, peak: 1 }, [MODULE.ldr]: { typical: 1, peak: 1 },
  [MODULE.led]: { typical: 10, peak: 15 }, [MODULE.piezo]: { typical: 5, peak: 25 },
};

/** What each module gives a device, in the words a requirement can use. Closed, so a check can't fail on a synonym. */
const MODULE_INTERFACES: Record<string, string[]> = {
  [MODULE.oled]: ['display'], [MODULE.encoder]: ['knob', 'button'], [MODULE.piezo]: ['buzzer'], [MODULE.led]: ['led'], [MODULE.ldr]: ['light_sensor'],
  [MODULE.ds18b20]: ['temperature_sensor'], [MODULE.bme280]: ['temperature_sensor', 'humidity_sensor', 'pressure_sensor'],
};
export const CARRIER_INTERFACES: readonly string[] = ['usb_power', ...new Set(Object.values(MODULE_INTERFACES).flat())];

export function factsFromDesign(design: CircuitDesign, job?: Pick<AgentJob, 'board'>): DeviceFacts {
  const signals: Record<string, string[]> = {};
  for (const net of design.nets) {
    for (const end of net.endpoints) {
      const pin = pinDef(design.parts.find(p => p.id === end.part)?.module ?? '', end.pin);
      if (pin?.gpio) signals[net.name] = [...(signals[net.name] ?? []), ...(pin.gpio.input ? ['input'] : []), ...(pin.gpio.output ? ['output'] : []), ...(pin.gpio.adc1 ? ['adc'] : [])];
    }
  }
  const load = design.parts.reduce((sum, part) => { const draw = TYPICAL_MA[part.module]; return { typical: sum.typical + (draw?.typical ?? 0), peak: sum.peak + (draw?.peak ?? 0) }; }, { typical: 0, peak: 0 });
  const interfaces = [...new Set(['usb_power', ...design.parts.flatMap(p => MODULE_INTERFACES[p.module] ?? [])])];
  // Nominal voltages aren't evidence, so a voltage requirement stays unchecked until something measures it.
  return { interfaces, signals, netVolts: {}, batteryPresent: false, loadMa: { ...load, estimated: true }, partCount: design.parts.length, ...(job?.board ? { boardMm: [job.board.widthMm, job.board.heightMm] as [number, number] } : {}) };
}
