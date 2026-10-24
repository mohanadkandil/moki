# Moki technical architecture

Open http://127.0.0.1:5173/architecture/index.html while `npm run dev` is running.

The canonical standalone diagram is [`web/public/architecture/index.html`](../../web/public/architecture/index.html). It also ships unchanged in the Vite production build. Rebuild it from repository-local assets:

```sh
python3 scripts/render-architecture.py
```

The renderer makes no model or network calls. Logos are embedded inline; Manrope loads from Google Fonts. Brand/style provenance is in [style-guide.md](style-guide.md), and technology-logo sources are recorded in [assets/sources.json](assets/sources.json). BFL and Daytona marks come from their official sites; the OpenAI mark is the Lobe Icons rendition; the remaining technology marks come from Simple Icons. Marks identify their respective tools and belong to their owners.

This is the **current implementation**, read from `server/workshop-api.ts`, `scripts/design-run.ts`, and the project/inspiration stores. The coordinator uses direct OpenAI Responses calls. Model calls happen through the local server; Daytona executes engineering tools in two isolated workspaces. The deterministic validation worker reopens actual STEP geometry. The separate Agents SDK scaffold is not drawn as the live executor.

Seven nodes keep the main flow readable. Merged project/run state and generated files into the shared-artifact card; grouped React/Vite/Three.js under the workspace and Node.js/TypeScript/OpenAI under orchestration. Low-level ports, CLI flags, individual API routes and the standalone SDK scaffold are omitted. The BFL node covers both the initial four image directions and final concept film; the film is based on the selected image, not the exported CAD.

The footer explicitly marks the unimplemented schematic, electrical-check, routing and populated-board-fit stages. The current PCB is an outline with mounting holes. No manufacturing readiness is asserted.

Verified: diagram-design single-file/accessibility self-check passes; actual browser loads Manrope, all ten brand symbols have nonzero geometry, all text stays within the viewBox, and the diagram has no crossing or overlapping connector routes. The local scroll container preserves readable width on smaller displays; print scales the whole figure.

## Repository preview

The root README embeds [a PNG preview](../media/architecture.png). The [SVG export](moki-architecture.svg) preserves editable vector geometry; SVG viewers that cannot load the external Manrope font may substitute another typeface. Use the PNG for a consistent preview.
