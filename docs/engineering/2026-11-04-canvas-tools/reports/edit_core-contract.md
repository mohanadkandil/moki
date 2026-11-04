# edit_core contract — integration notice

Status: **planned; implementation follows E7 P2-1/P2-2 fixes**. Existing submit() does not yet apply edits. This document must not be treated as proof that edits landed.

`POST /api/board/jobs` will accept exactly the brief's shape:

```ts
{
  design?: CircuitDesign; // exactly one of design/source
  source?: string;
  baseJobId: string;
  edits: {
    placements?: Array<{ refdes: string; x: number; y: number; rotation: number }>;
    board?: { widthMm: number; heightMm: number; cornerRadiusMm: number };
    usbEdge?: 'left' | 'right' | 'top' | 'bottom';
  };
}
```

Coordinates are the existing circuit/PCB frame: mm, X right, Y up, about the board centre; rotations are in degrees. Invalid edits will be rejected **before queue admission** with HTTP 400 and `{ error: '<plain message>' }`. Successful jobs will echo normalized `input.edits` and `input.baseJobId`, so tools can distinguish an applied edit from ignored fields. Final numeric constraints/merge rules will be documented with implementation.

No shape change is planned for job `drc`, `stages`, or `enclosure.json` validation failures. Each edit produces a new job and retains the base job. The existing create flow without edits remains supported.

Agent integration: canvas_ui and agent_core should code against this shape, but stub until this status changes to implemented/verified and real job IDs are supplied. Herdr could not be used from this execution environment because HERDR_ENV is unset; notices are in the shared conversation/documents.

Updated coordinate/recovery/diff decisions are in [edit_core.md](edit_core.md): placements use pcb_component.center; base-only requests recover stored input; editSummary is top-level. That report supersedes the initial exactly-one-of wording above for requests with a base.
