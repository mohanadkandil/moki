// Not every idea needs a microcontroller. A model decides that, and these rules hold it: a brief that asks for something
// only code can do keeps a controller, however it's read. A wrong "needs code" costs an MCU; a wrong "no code" costs a board.
import type { BlockDef, BoardPlan } from '../blocks/contract.js';

const NEEDS_CODE = /\b(screens?|displays?|oled|lcd|tft|e-?ink|wi-?fi|bluetooth|ble|wireless|lora|zigbee|mqtt|internet|online|apps?|phones?|menus?|programm?(?:able|ed)?|firmware|code|software|microcontrollers?|mcu|esp32\S*|esp8266|rp2040|stm32\S*|arduino|attiny\S*|pico|logs?|logging|logger|records?|stores?|saves?|remembers?|counts?|counters?|scores?|games?|calendar|schedules?|clocks?|countdown|melody|song|speech|voice|(?<!555[ -])timers?|after \d+ ?(?:s|secs?|seconds?|mins?|minutes?|hours?))\b/i;

/** The word in a brief that means it needs code, or null when nothing does. */
export function needsCodeWord(brief: string): string | null { return NEEDS_CODE.exec(brief)?.[0]?.toLowerCase() ?? null; }

export const hasMcu = (plan: Pick<BoardPlan, 'blocks'>, blocks: readonly BlockDef[]) => plan.blocks.some(i => blocks.find(b => b.id === i.block && b.version === i.version)?.mcu);

/** Why this plan can't go without a microcontroller. Empty when it can. */
export function noCodeIssues(plan: Pick<BoardPlan, 'blocks'>, blocks: readonly BlockDef[], brief: string): string[] {
  const issues: string[] = [];
  const word = needsCodeWord(brief);
  if (word) issues.push(`The brief asks for "${word}", which needs code, so this board needs a microcontroller.`);
  for (const instance of plan.blocks) {
    const block = blocks.find(b => b.id === instance.block && b.version === instance.version);
    if (block?.ports.some(port => port.kind === 'bus' && port.bus?.protocol !== 'usb2')) issues.push(`${block.title} talks over a bus, and with no microcontroller nothing would drive it.`);
  }
  return issues;
}

/**
 * Automatic placement puts the first block on the board's top edge, and this block's connector faces up.
 * So it goes first, or a cable couldn't reach the socket. A model can't be relied on to know that.
 */
export function powerInputFirst<T extends Pick<BoardPlan, 'blocks'>>(plan: T): T {
  const input = plan.blocks.filter(i => i.block === 'usb-c-power-only');
  return input.length ? { ...plan, blocks: [...input, ...plan.blocks.filter(i => i.block !== 'usb-c-power-only')] } : plan;
}

/** What the Firmware tab says, and the closing line. */
export const NO_CODE_TAB = 'This board has no code: its parts do the whole job, so there’s nothing to flash.';
