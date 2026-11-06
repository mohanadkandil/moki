// A saved design laid out for a card. Apart from the component so it can be tested, and away from gallery.ts so the
// landing doesn't load the schematic code until a card needs it.
import type { CircuitDesign } from '../../../src/circuit/model';
import { layOutSheet, type SheetLayout } from '../studio/schematic/layout';
import { sheetFromDesign } from '../studio/schematic/sheet';

/** Null for a design this can't draw. A saved chat is old data, and one odd project mustn't take the landing down with it. */
export function drawingLayout(sheet: { title: string; parts: unknown[]; nets: unknown[] }): SheetLayout | null {
  try {
    // A card has no room for the notes, so the summary doesn't carry them.
    return layOutSheet(sheetFromDesign({ ...sheet, notes: [] } as unknown as CircuitDesign), { aspect: 1.6 });
  } catch {
    return null;
  }
}
