# Tools and isolation

Only the already-running dev server at http://127.0.0.1:5173 was used. No production builds, service restarts, commits, pushes or external publication were performed. Updating code imported by Vite config causes Vite's automatic dev reload; one intermediate queued job was persisted as failed by its shutdown handler. Final jobs were created after source stabilization.

Herdr was not controlled because this tool environment does not have HERDR_ENV=1. Integration was communicated through the conversation and shared report/contract files.

Native KiCad: Debian bookworm-backports arm64 `kicad_9.0.8+dfsg-1~bpo12+1_arm64.deb` extracted locally under /tmp/moki-kicad-check/root9 with runtime dependencies extracted beside it (no apt install or root/service changes). The KiCad 7 package was tried first, then replaced for validation by KiCad 9 because the converter emits a KiCad 9 file version. The CLI logs include a missing global IPC schema resource warning from this unpacked layout; PCB and schematic exports are checked by exit code plus actual nonempty SVG files. This is native reader/plot acceptance, not a GUI interaction check, ERC approval, fabrication approval or hardware validation.

Evidence renderer: Bun bundles only eda/models/evidence-page.ts into a temporary file URL. Existing local Chromium plus existing /tmp/robotics-report-preview/node_modules/playwright drives it. The renderer waits for __DONE and checks page errors before capture; it starts no HTTP server and makes no network lighting requests.
