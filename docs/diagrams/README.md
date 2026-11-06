# Moki architecture diagram

**Status:** implemented, read from the code on 6 Nov 2026. The two dashed boxes are proposed and not built.

The drawing answers one question: what runs where when a maker's idea becomes a board?

Rebuild it from repository-local files:

```sh
python3 scripts/render-architecture.py
```

That writes three outputs from one source, and makes no model or network calls:

| Output | Use |
| --- | --- |
| [`docs/media/architecture-2026-11.png`](../media/architecture-2026-11.png) | The README image |
| [`moki-architecture.svg`](moki-architecture.svg) | Vector copy, with Manrope and the logos embedded |
| [`web/public/architecture/index.html`](../../web/public/architecture/index.html) | Standalone page, at `/architecture/index.html` under `npm run dev` |

Edit `scripts/render-architecture.py`, not the outputs. The PNG needs Chromium: set `MOKI_CHROME`, or have one on your `PATH` or in the Playwright cache. Vite copies the HTML into the production build, but the production server doesn't serve that path.

## Where each node comes from

| Node | Source |
| --- | --- |
| Web | `web/src/App.tsx`, `web/src/landing/routes.ts`, `web/src/RecentProjects.tsx`, tabs in `web/src/studio/Canvas.tsx` |
| Gateway | `MOKI_BOARD_API_TOKEN` in `server/agent-api.ts` and `server/board-api.ts`. The gateway itself lives outside this repository. |
| project-api, agent-api, board-api | `server/*-api.ts`, loaded as plugins in `vite.config.ts`. SSE is in `server/agent-api.ts`. The queue is in `server/board-api.ts`, which refuses a sixth waiting job. |
| Thumbnails | `server/thumbnail.ts`, run by `server/board-api.ts` |
| Agents | Roles in `src/agents/protocol.ts`, flow in `src/agents/turn.ts` and `src/agents/chip.ts` |
| Model seam, budget | `createProvider` and `JOB_CAP_USD` in `src/agents/model.ts` |
| Gates | `src/agents/turn.ts`, `src/agents/chip.ts`, `src/blocks/erc.ts`, `src/blocks/spice.ts`, `src/blocks/review.ts`, `src/blocks/verify.ts` |
| Build workers | `runWorker` and its allowlist in `src/board/process.ts` |
| tscircuit | `eda/render.ts`, `eda/blocks/build.ts`, `eda/package.json` |
| build123d | `mech/enclosure.py`, `mech/requirements.txt`, `eda/enclosure.ts` |
| PlatformIO | `src/firmware/index.ts`, `src/agents/firmware.ts`, `src/agents/pio-sandbox.sh` |
| ngspice | `eda/blocks/spice-runner.ts`, started from `src/blocks/spice.ts` |
| Catalog, block library | `src/blocks/catalog.ts`, `src/blocks/library.ts`, `src/blocks/review.ts` |
| Datasheets | `src/agents/datasheet.ts` |
| Nemotron 3.5 Parse (proposed) | [ADR 0003](../adr/0003-datasheet-layout-parsing-nemotron-parse.md). `infra/modal/parse_app.py` exists, but nothing in `server/` or `src/` calls it. |
| Fly.io micro-VMs (proposed) | [ADR 0001](../adr/0001-code-first-eda-over-computer-use.md). No code exists. |

## Where each arrow comes from

| Arrow | Carries | Source |
| --- | --- | --- |
| Web to server, through the gateway | JSON, build files, SSE events | `web/src/landing/projectsApi.ts`, `web/src/board/api.ts` |
| agent-api to Agents | A turn | `runTurn` in `server/agent-api.ts` |
| Agents to board-api | Job requests over HTTP | `src/agents/board-client.ts` |
| board-api to workers | Spawned builds | `worker(...)` in `server/board-api.ts` |
| Agents to workers | SPICE and firmware compile, as gates before a build | `src/agents/chip-library.ts`, `src/agents/firmware.ts` |
| Agents to parts and evidence | Part search, blocks, datasheet reads | `src/agents/chip-library.ts` |

## What the drawing simplifies

- **The agents row shows a chip-level turn.** A kit turn has no Block Author or Reviewer, and the Editor runs instead of the Designer when a change is requested. Canvas edits skip the models and go straight to the gates.
- **The Explainer is left out.** It only answers questions and never changes the plan.
- **The gateway only applies when hosted.** Under `npm run dev` the browser talks to the server directly.
- **The sandbox covers model-written firmware.** Fixed kit firmware templates compile without it.
- **Left out on purpose:** ports, routes, tokens, the private link, `/lab`, and the older prototype code that remains under `npm run dev`.

## Checks

A browser check of the SVG measures the 78 text elements, 29 cards and zones, and 13 arrows. It found no text overlaps, no text within 4 units of an edge, no arrow through a card or a label, and no arrows touching. The smallest text is 16 units, which is 11 px at GitHub's 830 px width. The PNG was also inspected by eye at that width.

Logo sources and hashes are in [assets/sources.json](assets/sources.json), and the visual rules are in [style-guide.md](style-guide.md). Marks identify their tools and belong to their owners.
