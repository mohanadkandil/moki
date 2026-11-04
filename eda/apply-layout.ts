import { moduleDef } from '../src/circuit/catalog.js';
import { footprintFor } from '../src/board/catalog-footprints.js';
import { layoutOutline, layoutFromCircuit, validateLayout, type BoardLayout } from '../src/board/edits.js';

export function manualEditsFor(layout: BoardLayout) {
  return { pcb_placements: layout.parts.map(p => ({ selector: p.refdes, relative_to: 'group_center', center: p.origin, rotation: p.rotation })) };
}

/** Apply edits to trusted tscircuit component props, never rewriting the owner's TSX.
 * The installed manualEdits schema supports positions; pcbRotation supplies rotation. */
export function applyLayout(circuit: { _getBoard(): any; selectOne(selector: string): any }, layout: BoardLayout, algorithmFn?: (input: any) => Promise<any>): void {
  const board = circuit._getBoard() as any;
  if (!board) throw new Error('Layout edits need a single board');
  const originalPlacements = board.props.manualEdits?.pcb_placements ?? [];
  const originalCenters = new Map(layout.parts.map(p => {
    const part = circuit.selectOne(`.${p.refdes}`);
    return [p.refdes, part && board._getPcbManualPlacementForComponent?.(part)];
  }));
  const placements = manualEditsFor(layout).pcb_placements.map(({ rotation, ...p }) => p);
  board.setProps({ ...board.props, width: layout.board.widthMm, height: layout.board.heightMm, outline: layoutOutline(layout.board),
    minTraceToPadEdgeClearance: .2, minViaEdgeToPadEdgeClearance: .2,
    // The pinned core's preset resolver discards algorithmFn when preset is set.
    autorouter: { ...(typeof board.props.autorouter === 'object' ? board.props.autorouter : {}), preset: algorithmFn ? undefined : 'auto', local: true, traceClearance: .25, ...(algorithmFn ? {algorithmFn} : {}) },
    manualEdits: { ...board.props.manualEdits, pcb_placements: placements } });
  for (const pose of layout.parts) {
    const part = circuit.selectOne(`.${pose.refdes}`) as any;
    if (!part || part.parent !== board) throw new Error(`Layout edits require ${pose.refdes} directly on the carrier board`);
    const original = originalPlacements.find((p: any) => p.selector === pose.refdes || p.selector === `.${pose.refdes}`);
    const originalCenter = originalCenters.get(pose.refdes) ?? original?.center;
    const oldX = Number(part.props.pcbX ?? originalCenter?.x ?? 0), oldY = Number(part.props.pcbY ?? originalCenter?.y ?? 0), oldRotation = Number(part.props.pcbRotation ?? 0);
    part.setProps({ ...part.props, pcbX: undefined, pcbY: undefined, pcbRotation: pose.rotation });
    // Ref/value labels generated as board siblings must follow their component too.
    const delta = (pose.rotation - oldRotation) * Math.PI / 180;
    for (const label of board.children ?? []) {
      const text = label.props?.text;
      if (typeof text !== 'string' || (text !== pose.refdes && !text.startsWith(`${pose.refdes} `))) continue;
      const x = Number(label.props.pcbX ?? 0) - oldX, y = Number(label.props.pcbY ?? 0) - oldY;
      label.setProps({ ...label.props, pcbX: pose.origin.x + x * Math.cos(delta) - y * Math.sin(delta), pcbY: pose.origin.y + x * Math.sin(delta) + y * Math.cos(delta), pcbRotation: Number(label.props.pcbRotation ?? 0) + pose.rotation - oldRotation });
    }
  }
  for (const child of board.children ?? []) {
    if (child.lowercaseComponentName === 'hole' && Math.abs(Number(child.props.diameter) - 3.2) < .001) {
      const sx = Math.sign(Number(child.props.pcbX)), sy = Math.sign(Number(child.props.pcbY));
      const hole = layout.mountingHoles.find(h => Math.sign(h.x) === sx && Math.sign(h.y) === sy);
      if (!hole) throw new Error('Cannot identify a board mounting-hole corner');
      child.setProps({ ...child.props, pcbX: hole.x, pcbY: hole.y });
    }
    if (typeof child.props?.text === 'string' && child.props.text.startsWith('CARRIER ')) child.setProps({ ...child.props, pcbY: layout.board.heightMm / 2 - 3 });
  }
}

export function verifyLayout(cj: any[], layout: BoardLayout): void {
  const actual = layoutFromCircuit(cj, { parts: layout.parts.map(p => ({ id: p.refdes, module: p.module })) });
  validateLayout(actual);
  if (actual.parts.length !== layout.parts.length || actual.mountingHoles.length !== layout.mountingHoles.length || Math.abs(actual.board.cornerRadiusMm - layout.board.cornerRadiusMm) > .01) throw new Error('Rendered outline or component set did not match the validated edit');
  const board = cj.find(e => e.type === 'pcb_board');
  if (!board || Math.abs(board.width - layout.board.widthMm) > .01 || Math.abs(board.height - layout.board.heightMm) > .01) throw new Error('Rendered board dimensions did not match the validated edit');
  for (const hole of layout.mountingHoles) {
    if (!cj.some(e => e.type === 'pcb_hole' && Math.hypot(e.x-hole.x,e.y-hole.y)<.01 && Math.abs(e.hole_diameter-hole.diameterMm)<.01)) throw new Error('Rendered mounting holes did not match the validated board edit');
  }
  for (const pose of layout.parts) {
    const source = cj.find(e => e.type === 'source_component' && e.name === pose.refdes);
    const part = cj.find(e => e.type === 'pcb_component' && e.source_component_id === source?.source_component_id);
    const difference = ((Number(part?.rotation ?? 0) - pose.rotation + 540) % 360) - 180;
    if (!part || Math.hypot(part.center.x - pose.center.x, part.center.y - pose.center.y) > .01 || Math.abs(difference) > .01 || Math.hypot(part.footprint_origin.x - pose.origin.x, part.footprint_origin.y - pose.origin.y) > .01) {
      throw new Error(`Rendered ${pose.refdes} pose did not match its validated edit`);
    }
  }
}

export function metadataForLayout(cj: any[], layout: BoardLayout, original?: any) {
  return { ...original, widthMm: layout.board.widthMm, heightMm: layout.board.heightMm, cornerRadiusMm: layout.board.cornerRadiusMm,
    outline: layoutOutline(layout.board), layers: 2, dimensionsVerified: false, mountingHoles: layout.mountingHoles,
    parts: layout.parts.map(p => {
      const source = cj.find(e => e.type === 'source_component' && e.name === p.refdes);
      const component = cj.find(e => e.type === 'pcb_component' && e.source_component_id === source?.source_component_id);
      const def = moduleDef(p.module), old = original?.parts?.find((x: any) => x.id === p.refdes);
      return { ...old, id: p.refdes, module: p.module, x: p.origin.x, y: p.origin.y, rotation: p.rotation, widthMm: def.size.w, heightMm: def.size.h,
        pins: footprintFor(p.module).pins.map(pin => {
          const hole = cj.find(e => e.type === 'pcb_plated_hole' && e.pcb_component_id === component.pcb_component_id && e.port_hints?.includes(`pin${pin.number}`));
          if (!hole) throw new Error(`Rendered ${p.refdes}.${pin.id} has no physical pad`);
          return { id: pin.id, x: hole.x, y: hole.y };
        }) };
    }) };
}
