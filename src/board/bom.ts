import { moduleDef } from '../circuit/catalog.js';
import type { CircuitDesign } from '../circuit/model.js';
import { footprintFor } from './catalog-footprints.js';

export const ascii = (value: string) => value.replace(/¼/g, '1/4').replace(/²/g, '2').replace(/″/g, ' in').replace(/Ω/g, 'ohm').replace(/−/g, '-').replace(/°/g, ' deg ').replace(/[^\x20-\x7e]/g, '');
const csv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

/** Catalog names survive unchanged by the EDA converter, including assembly supplies. */
export function catalogBom(design: Pick<CircuitDesign, 'parts'>): string {
  const rows: (string | number)[][] = [['Designator', 'Quantity', 'Description', 'Value', 'Footprint', 'Assembly note']];
  for (const part of [...design.parts].sort((a, b) => a.id.localeCompare(b.id))) {
    const module = moduleDef(part.module), footprint = footprintFor(part.module);
    rows.push([part.id, 1, ascii(module.name), ascii(part.value ?? ''), footprint.footprint, 'Verify actual module dimensions and pin order']);
    if (footprint.kind === 'female-header') {
      const columns = new Map<number, number>();
      for (const pin of footprint.pins) columns.set(pin.x, (columns.get(pin.x) ?? 0) + 1);
      // Two long rows for DevKitC; all other sockets are a single row.
      const counts = module.category === 'controller' ? [...columns.values()] : [footprint.pins.length];
      for (const [i, count] of counts.entries()) {
        rows.push([`${part.id}-SOCKET${i + 1}`, 1, `Female socket 1x${count}, 2.54 mm pitch`, '', 'Through-hole', 'Carrier PCB; verify socket height']);
        rows.push([`${part.id}-HEADER${i + 1}`, 1, `Male header 1x${count}, 2.54 mm pitch`, '', 'Through-hole', 'Module side; may already be fitted or supplied. KY-040 right-angle variants need checking']);
      }
    }
  }
  rows.push(['CASE-SCREWS', 4, 'M3 x 16 mm machine screw', '', 'Case hardware', 'Verify thread engagement on a printed test fit']);
  return rows.map(row => row.map(csv).join(',')).join('\n') + '\n';
}
