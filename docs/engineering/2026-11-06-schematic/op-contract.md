# Schematic edit and live contract (proposed by schem_ui, 6 Nov 2026)

The UI edits the design, never a drawing. One operation list is shared by the canvas and the Editor.

## 1. Operations

`DesignOp` in `src/agents/edits.ts` stays the one type. Existing ops keep their shape. New ones:

| op | fields | carrier | chip plan |
|---|---|---|---|
| `add_part` | `id, module, role, value?` | yes | refused: "This board is built from blocks. Add a block." |
| `remove_part` | `id` | yes | refused unless the part is the whole block; otherwise says which block owns it |
| `connect` | `net, endpoints[{part,pin}], kind?, why?, analog?` | yes | only ports: see `link` |
| `disconnect` | `net, part, pin` | yes | see `unlink` |
| `rename_net` (new) | `net, name` | yes | yes where the net isn't block-internal |
| `set_value` (new) | `part, value` | yes | block param where one exists |
| `add_note` (new) | `text, part?, net?, section?` | `design.notes` | `sections[].notes` |
| `remove_note` (new) | `text` | yes | yes |
| `add_block` (new) | `inst, block, version?, params?, section?` | refused: "This board is built from modules." | yes |
| `remove_block` (new) | `inst` | refused | yes, with its links |
| `link` / `unlink` (new) | `from, to` as `inst.PORT` | refused | yes |

Refusals are one plain sentence a maker can read.

## 2. Job API (`server/board-api.ts`)

- `POST /api/board/ops/check` with `{ baseJobId, ops }`: dry run, nothing built.
  - `200 { ok: true, changes: string[], warnings: string[] }`
  - `200 { ok: false, reason: string, opIndex: number }`
- `POST /api/board/jobs` with `{ baseJobId, ops }`: one rebuild for the batch. `202 { jobId }`, or `400 { error }` with the same reason. The job is a normal job: rule checks, routing, case and the firmware cache.
- `GET /api/board/library`: `{ modules: [{ id, name, category, pins: number }], blocks: [{ id, version, title, summary, class, status, parts: number, ports: [{ id, label, kind }] }] }`. Reviewed blocks only, unless the entry says `status: 'unreviewed'`.
- Add `design.json` and `plan-graph.json` to `BOARD_ARTIFACT_NAMES`. The canvas draws from them; today neither has a URL, so a build opened from history has no design to draw or edit.

Until `ops/check` and `{ baseJobId, ops }` exist, the canvas falls back on carrier designs: it applies `applyDesignOps` locally and posts `{ design, baseJobId }`, which the job API already validates.

## 3. Live events (agent turn SSE, `src/agents/protocol.ts`)

```ts
| { type: 'plan.partial'; step: string; design?: CircuitDesign; plan?: BoardPlan; graph?: SheetGraph }

interface SheetGraph {
  parts: { ref: string; inst: string; title: string; mpn?: string; value?: string; pins: { id: string; label: string; role?: string }[] }[];
  nets: { name: string; pins: { ref: string; pin: string }[] }[];
}
```

- `step` is what the agent is doing, in words: "Reading the BME280", "Adding the USB-C section".
- Send everything known so far, after each Designer step, not a delta. Parts are matched by ref, so repeats are harmless.
- Carrier: `design` alone is enough. Chip: `plan` plus `graph`, from `planGraph` on the blocks resolved so far, because the browser has no block library.
- An empty `design`/`plan` with a `step` is fine: the pill updates and the sheet waits.
- `agentChat.ts` calls a new `onPartial(event)` option on `useStudioAgent`, and clears it when the turn ends. `Studio.tsx` holds it and passes it to the canvas.

## 4. As built (6 Nov 2026, schem_ui and agent_core)

This section overrides the above where they differ.

- **`POST /api/board/ops/check`** has three answers:
  - Can't apply: `{ ok:false, reason, opIndex, changes:[], warnings:[] }`, with no plan. The client drops that step.
  - Applies but fails checks: `{ ok:false, reason, changes, warnings, plan|design, graph? }`, with no `opIndex`. The draft stays and can still be drawn.
  - Fine: `{ ok:true, changes, warnings, plan|design, graph?, needsReview? }`.
  - `graph` is left out if a half-wired plan can't be drawn yet.
- **`ops: []`** on the check returns the board as it stands. The client draws every chip sheet from this graph, so live, draft and final share one source. `POST /api/board/jobs` with `ops: []` still refuses and makes no job.
- **Carrier Apply** posts `{ baseJobId, ops }` and gets `202` or `400 { error }`.
- **Chip Apply never posts to jobs.** Any chip edit changes a reviewed plan, and the job API returns 400 unless a review receipt matches that exact plan. The client calls `agent.send('Apply my edit', { mode:'chip', jobId, ops })`: Reviewer, Fixer if a citation is missing, firmware only if wiring changed, then the job. This costs model money, so the button reads "Review and apply".
- **Chip `rename_net`** is `{ net: current name, name }`, resolved on the server. It's refused for the ground net, nets inside a block, names in use, and names outside `[A-Za-z_][A-Za-z0-9_]*`.
- **Chip `set_value`** takes `part` as `inst.param`. **`add_block`** is `{ inst, block }` with an optional `version` and `section`. The draft cap is 64 ops.
- **`GET /api/board/library?mode=carrier|chip&q=`:** `modules` for carrier, `blocks` with `ports`, `params` and `status` for chip. No mode returns both.
