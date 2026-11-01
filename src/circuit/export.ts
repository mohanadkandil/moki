import { moduleDef } from './catalog.js';
import type { Revision } from './session.js';
import { checkDesign } from './validate.js';

export const PREVIEW_DISCLAIMER =
  'Connected design preview from a bounded template. Not a simulation, an electrical rule check (ERC), a PCB layout, or evidence that this hardware works. Pinouts and outlines are typical for these hobby modules; check your own boards.';

/** A JSON artifact of one revision: the graph plus a flat netlist, labelled for what it is. */
export function exportRevision(revision: Revision, generatedAt = new Date()) {
  const { design } = revision;
  const graphChecks = checkDesign(design);
  return {
    kind: 'moki.circuit-preview.export',
    schema: design.schema,
    disclaimer: PREVIEW_DISCLAIMER,
    generatedAt: generatedAt.toISOString(),
    revision: revision.number,
    /** Wiring identity: equal for revisions with the same parts and nets. */
    fingerprint: revision.fingerprint,
    /** Unique for each distinct revision content (wiring plus settings). */
    contentId: revision.contentId,
    brief: revision.brief,
    template: design.template,
    interpretation: {
      chosenBy: revision.interpretation.chosenBy,
      recognized: revision.interpretation.recognized,
      notes: revision.interpretation.notes,
    },
    parts: design.parts.map(p => ({ ...p, moduleName: moduleDef(p.module).name })),
    nets: design.nets,
    // Keyed by net id, which the graph checks keep unique; the display name travels with it.
    netlist: Object.fromEntries(design.nets.map(n => [n.id, { name: n.name, pins: n.endpoints.map(e => `${e.part}.${e.pin}`) }])),
    behaviorForFirmware: design.behavior,
    notes: design.notes,
    graphStructureChecks: {
      scope: 'References, pin reuse, supply ranges and GPIO capabilities inside this graph only.',
      issues: graphChecks.map(i => i.message),
    },
  };
}
