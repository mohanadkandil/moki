# Moki architecture diagram

**Status:** implemented, read from the code on 6 Nov 2026.

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
| Nemotron 3.5 Parse | `src/agents/datasheet-parse.ts`, called from `src/agents/datasheet.ts`; `infra/modal/parse_app.py`; [ADR 0003](../adr/0003-datasheet-layout-parsing-nemotron-parse.md). It only runs when `MOKI_PARSE_URL` and `MOKI_PARSE_TOKEN` are set. Otherwise agents read pdf.js text. |

## Where each arrow comes from

| Arrow | Carries | Source |
| --- | --- | --- |
| Web to server, through the gateway | JSON, build files, SSE events | `web/src/landing/projectsApi.ts`, `web/src/board/api.ts` |
| agent-api to Agents | A turn | `runTurn` in `server/agent-api.ts` |
| Agents to board-api | Job requests over HTTP | `src/agents/board-client.ts` |
| board-api to workers | Spawned builds | `worker(...)` in `server/board-api.ts` |
| Agents to workers | SPICE and firmware compile, as gates before a build | `src/agents/chip-library.ts`, `src/agents/firmware.ts` |
| Agents to parts and evidence | Part search, blocks, datasheet reads | `src/agents/chip-library.ts` |
| Nemotron to Datasheets | Parsed pages. pdf.js text stays the authority for citations. | `src/agents/datasheet-parse.ts` |

## What the drawing simplifies

- **The agents row shows a chip-level turn.** A kit turn has no Block Author or Reviewer, and the Editor runs instead of the Designer when a change is requested. Canvas edits skip the models and go straight to the gates.
- **The Explainer is left out.** It only answers questions and never changes the plan.
- **The gateway only applies when hosted.** Under `npm run dev` the browser talks to the server directly.
- **The sandbox covers model-written firmware.** Fixed kit firmware templates compile without it.
- **Left out on purpose:** ports, routes, tokens, the private link, `/lab`, and the older prototype code that remains under `npm run dev`.

## The pictures

Every picture is a crop of real output, never stock art or a mock-up. The schematic, board and case all come from one fresh temp-monitor build, and the two screens are real product screenshots. Sources, crops and hashes are in [assets/sources.json](assets/sources.json). Change a crop by replacing its file in `assets/evidence/`.

## Checks

A browser check of the SVG measures the 87 text elements, 30 cards and zones, and 12 arrows. It found no text overlaps, no text within 4 units of an edge, no arrow through a card or a label, and no arrows touching. Readable text is at least 16 units, which is 11 px at GitHub's 830 px width. The small-caps labels are 13.5 units, about 9.3 px. The PNG was also inspected by eye at 830 px on GitHub's light and dark page colours, and at 1x and 2x.

The visual rules are in [style-guide.md](style-guide.md). Marks identify their tools and belong to their owners.
