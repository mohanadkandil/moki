import { createElement as e, cloneElement, Children, isValidElement } from 'react';
import { RootCircuit } from 'tscircuit';
import { convertCircuitJsonToSchematicSvg } from 'circuit-to-svg';
import type { BlockDef, BoardPlan } from '../../src/blocks/contract';
import type { PlanGraph, PlacedPart } from '../../src/blocks/graph';
import { layoutSchematicNotes } from './schematic-notes';
const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export function nativePart(p: PlacedPart, imported: any, schematic = false) {
  let node = imported.component({ name: p.ref, pcbX: p.at.x, pcbY: p.at.y, pcbRotation: p.at.rotation });
  if (node.type === 'crystal') {
    if (!p.part.crystal) throw new Error(`${p.ref}: imported crystal requires a cited crystal.loadCapacitancePf`);
    node = cloneElement(node, { loadCapacitance: `${p.part.crystal.loadCapacitancePf}pF` });
  } else if (p.part.crystal) throw new Error(`${p.ref}: crystal facts require an imported crystal component`);
  const omit = new Set((p.part.omitPads ?? []).map((pad) => imported.pins.get(pad)));
  if (omit.size || p.part.correction) {
    const fp = node.props.footprint;
    node = cloneElement(node, {
      pinLabels: Object.fromEntries(
        Object.entries(node.props.pinLabels ?? {}).filter(([pin]) => !omit.has(pin)),
      ),
      footprint: cloneElement(fp, {
        children: Children.toArray(fp.props.children).filter(
          (c: any) =>
            !isValidElement<any>(c) ||
            (!((p.part.lcsc === 'C2913198' || p.part.omitImportedVias) && c.type === 'via') &&
              !c.props.portHints?.some((pin: string) => omit.has(pin))),
        ),
      }),
    });
  }
  // PCB ports must come from physical footprint clusters. A custom schematic symbol
  // can suppress repeated-pad clustering (e.g. the nine ESP32-S3 EP lands).
  if (!schematic && node.props.symbol) node = cloneElement(node, { symbol: undefined });
  if (schematic && p.part.value && /^R/.test(p.localRef))
    return e('resistor', { ...node.props, resistance: p.part.value });
  if (schematic && p.part.value && /^C/.test(p.localRef))
    return e('capacitor', { ...node.props, capacitance: p.part.value });
  if (schematic && p.part.switch) return e('pushbutton', node.props);
  return node;
}
/** Native symbols/layout per functional section, stitched into one auditable engineering sheet. */
export async function schematicSheet(
  plan: BoardPlan,
  blocks: BlockDef[],
  graph: PlanGraph,
  imports: Map<any, any>,
) {
  const sections: NonNullable<BoardPlan['sections']> =
    plan.sections ??
    plan.blocks.map((i) => {
      const b = blocks.find((b) => b.id === i.block && b.version === i.version)!;
      return { id: i.inst, title: b.title, purpose: b.summary, insts: [i.inst], notes: [] };
    });
  const cols = 2,
    cellW = 1000,
    header = 100,
    foot = 100;
  const textLayouts = sections.map(section => layoutSchematicNotes(section));
  const rowHeights = Array.from({ length: Math.ceil(sections.length / cols) }, (_, row) =>
    Math.max(...textLayouts.slice(row * cols, (row + 1) * cols).map(layout => layout.neededHeight)) + 30);
  let body = '';
  const audit: any[] = [];
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]!,
      parts = graph.parts.filter((p) => section.insts.includes(p.inst)),
      refs = new Set(parts.map((p) => p.ref));
    const nodes: any[] = parts.map((p) => nativePart(p, imports.get(p.part), true));
    for (const net of graph.nets) {
      const pins = net.pins.filter((p) => refs.has(p.ref));
      if (!pins.length) continue;
      nodes.push(e('net', { name: net.name }));
      for (const p of pins) {
        const part = parts.find((q) => q.ref === p.ref)!;
        const pin = imports.get(part.part).pins.get(p.pad);
        if (!pin) throw new Error(`No physical pin mapping ${p.ref}.${p.pad}`);
        nodes.push(e('trace', { from: `.${p.ref} > .${pin}`, to: `net.${net.name}` }));
      }
    }
    const c = new RootCircuit({ platform: { pcbDisabled: true } });
    c.add(
      e(
        'board',
        { schAutoLayoutEnabled: true, schTraceAutoLabelEnabled: true, schMatchAdapt: true },
        ...nodes,
      ),
    );
    c.render();
    await c.renderUntilSettled();
    const cj = c.getCircuitJson(),
      errors = cj.filter((x: any) => x.type.endsWith('_error'));
    if (errors.length) throw new Error(`Schematic ${section.title}: ${JSON.stringify(errors)}`);
    const svg = convertCircuitJsonToSchematicSvg(cj);
    const size = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
    const w = Number(size?.[1] ?? 1200),
      h = Number(size?.[2] ?? 600);
    const x = (index % cols) * cellW + 25,
      y = rowHeights.slice(0, Math.floor(index / cols)).reduce((sum, height) => sum + height, header);
    const styles: Record<string, string> = {
      boundary: 'fill:#ffffff',
      'schematic-boundary': 'fill:none;stroke:#dddddd',
      component: 'fill:none;stroke:#840000',
      chip: 'fill:#ffffe7;stroke:#840000',
      'component-pin': 'fill:none;stroke:#840000',
      text: 'font-family:Arial,sans-serif;fill:#007a25',
      'pin-number': 'fill:#a90000',
      'port-label': 'fill:#006464',
      'component-name': 'fill:#006464',
    };
    const inner = svg
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
      .replace(/(fill|stroke)="transparent"/g, '$1="none"')
      .replace(
        /(fill|stroke)="rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)"/g,
        (_all, attr, r, g, b, alpha) => `${attr}="rgb(${r},${g},${b})" ${attr}-opacity="${alpha}"`,
      )
      .replace(
        /<text\b([^>]*)>/g,
        (_tag, attrs: string) =>
          '<text' + attrs.replace(/\s(?:stroke|stroke-width|paint-order)="[^"]*"/g, '') + '>',
      )
      .replace(/<([a-z][\w:-]*)\b([^>]*)>/g, (all, tag: string, attrs: string) => {
        const classes = attrs.match(/class="([^"]*)"/)?.[1] ?? '';
        const declared = attrs.match(/style="([^"]*)"/)?.[1] ?? '';
        const rules = classes
          .split(/\s+/)
          .map((c) => styles[c] ?? '')
          .filter(Boolean)
          .join(';');
        if (!rules) return all;
        const closing = attrs.trimEnd().endsWith('/') ? '/' : '';
        return (
          '<' +
          tag +
          attrs.replace(/\sstyle="[^"]*"/g, '').replace(/\/\s*$/, '') +
          ' style="' +
          rules +
          ';' +
          declared +
          '"' +
          closing +
          '>'
        );
      });
    const scale = Math.min(930 / w, 435 / h);
    const textLayout = textLayouts[index]!;
    body += `<g data-section="${escape(section.id)}"><rect x="${x}" y="${y}" width="950" height="${textLayout.neededHeight}" fill="#fff" stroke="#1e3443" stroke-width="1.5"/><text x="${x + 18}" y="${y + 32}" font-size="21" font-weight="700">${escape(section.title)}</text><g transform="translate(${x + 10 + (930 - w * scale) / 2} ${y + 48 + (435 - h * scale) / 2}) scale(${scale})">${inner}</g>`;
    textLayout.noteLines.forEach((note, j) => {
      body += `<text x="${x + 18}" y="${y + textLayout.noteStartY + j * textLayout.lineHeight}" font-size="14">${escape(note)}</text>`;
    });
    if (section.reference) {
      textLayout.referenceLines.forEach((line, j) => {
        body += `<text x="${x + 18}" y="${y + textLayout.referenceStartY + j * textLayout.lineHeight}" font-size="13" fill="#255c8b">${escape(line)}</text>`;
      });
      body += `<a href="${escape(section.reference.datasheetUrl)}"><rect x="${x + 12}" y="${y + textLayout.referenceStartY - 16}" width="925" height="${textLayout.referenceLines.length * textLayout.lineHeight + 5}" fill="#ffffff" fill-opacity="0"/></a>`;
    }
    body += '</g>';
    audit.push({
      section: section.id,
      parts: parts.map((p) => ({ ref: p.ref, inst: p.inst, lcsc: p.part.lcsc })),
      circuitJson: cj,
    });
  }
  const height = rowHeights.reduce((sum, height) => sum + height, header + foot);
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${height}" viewBox="0 0 2000 ${height}"><rect width="2000" height="${height}" fill="#fff"/><g font-family="Arial,sans-serif" fill="#182c38"><text x="25" y="43" font-size="28" font-weight="700">${escape(plan.title)}</text><text x="25" y="73" font-size="15">Moki · named nets join across sections · ${plan.layers} layers · supplier-backed parts · hardware unverified</text>${body}<path d="M25 ${height - 70}H1975" stroke="#1e3443"/><text x="25" y="${height - 40}" font-size="15">SCHEMATIC · ${escape(plan.schema)} · ${graph.parts.length} parts · ${sections.length} sections · Review status and gate evidence travel with this sheet.</text></g></svg>`,
    audit,
  };
}
