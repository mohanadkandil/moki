# Installed tscircuit skill: USB-C evaluation and useful routing guidance

Read-only installed-source investigation, 2026-11-06. No component substitution, native build, dependency change or routing run was performed for this evaluation.

## Sources and installed versions

Read `/home/sogo/.codex/skills/tscircuit/SKILL.md`, `SAVED_FANOUT_PATHS.md`, `WORKFLOW.md`, `FOOTPRINTS.md`, `CHECKLIST.md`, and `elements/{connector,copperpour,keepout,analogsimulation,constraint}.md`.

Installed files examined:

- `eda/node_modules/tscircuit/package.json`: `0.0.3075`; its `dist/index.js` reexports `@tscircuit/core`.
- `eda/node_modules/@tscircuit/core/package.json`: `0.0.2266`; implementation `dist/index.js` (Connector, canonical USB-C aliases, part-footprint fetch and routing phase preparation). Its embedded package-version constant is `0.0.2265`; the installed manifest reports `0.0.2266`.
- `eda/node_modules/@tscircuit/props/package.json`: `0.0.718`; schemas in `dist/index.js`.
- `eda/node_modules/@tscircuit/checks/package.json`: `0.0.269`; official post-pour connectivity check in `dist/index.js` and original source in `dist/index.js.map`.

## Bare USB-C standard does not prove the pinned part

The skill recommends `<connector standard="usb_c" />`. In this installed core, that standard supplies connector semantics and canonical aliases; it does not select a fixed static footprint.

`Connector.doInitialFetchPartFootprint()` obtains `partsEngine.fetchPartCircuitJson`, chooses supplier numbers (unless explicitly pinned), fetches the part Circuit JSON, and calls `_addConnectorFootprintFromCircuitJson()`. Without a configured fetcher and without an explicit footprint, this path returns without fetching a footprint. The current isolated build does not supply that parts engine.

`convertCircuitJsonToUsbCStandardCircuitJson()` adds canonical port hints to the fetched geometry. It does not replace pad geometry or renumber the actual supplier footprint. Its fallback canonical-port numbering must not be confused with this HRO import's different physical numbering.

Consequently, bare `standard="usb_c"` cannot be claimed to match C165948. Preserve the initial brief's actual supplier identity, verified physical pins and immutable footprint receipts. A future semantic connector wrapper could preserve the exact explicit imported footprint, pin labels, manufacturer part number and supplier identity; that requires its own geometry/alias diagnostic. No routing improvement has been demonstrated from changing the element type alone.

## Pinned HRO comparison target

Actual imported part: HRO `TYPE-C-31-M-12`, LCSC `C165948`.

- Supplier response: `eda/blocks/parts/C165948/catalog-response.json`; importer receipt: `receipt.json` in the same directory.
- Receipt URL: `https://jlcsearch.tscircuit.com/api/easyeda_components/C165948`, fetched `2026-11-05T21:49:00.995Z`.
- Importer: `easyeda@0.0.391`.
- Raw importer SHA-256: `f4a936c8dda71f28e6c26870bc0c4c0ad9719faaff4eb9f16af8010fa9bbce38`.
- Catalog receipt: `sha256:7bd08b687d8d0b901fb91b86a3c834972bd938733d5aa21c71da3e88ff3990ee`.
- Footprint SHA-256: `a776b0d3da5224266b3423589502a9656e8cf0432b7525f8e5a65d7959bd078a`.
- Converted TSX SHA-256: `cd9c6d214938f7fe823eee6712b29385880a27ca906e115392b1c6bbe215bcaa`.

The recorded `part.tsx` has **12 SMT pads, 4 plated slotted shield mounts, 2 non-plated locating holes and 1 courtyard outline**. The power/GND SMT pads are polygons. Shell centers are at X approximately ±4.325112 mm, with asymmetric front/rear slot dimensions. Locating holes are approximately 0.6 mm diameter at X ±2.899918 mm. These are manufacturer-package details that a generic USB-C standard alone does not pin.

| Actual numeric pin | Imported label | Built-in canonical alias |
| --- | --- | --- |
| 1, 2, 3, 4 | EH2, EH1, EH4, EH3 | SHELL2, SHELL1, SHELL4, SHELL3 |
| 5, 6 | SBU2, CC1 | unchanged |
| 7, 8, 9, 10 | DN2, DP1, DN1, DP2 | DM2, DP1, DM1, DP2 |
| 11, 12 | SBU1, CC2 | unchanged |
| 13, 14 | GND1, GND2 | unchanged |
| 15, 16 | VBUS1, VBUS2 | unchanged |

## What helped in this debugging round

The skill's saved-fanout guidance supports retaining real native trace paths with stable pin selectors and inspecting actual emitted geometry. The implementation uses the installed native saved-phase API; schema acceptance alone is not treated as routing or connectivity proof.

Explicit `routeRemaining: true` is necessary for the current large phased candidate. Job `365a210f-a69f-4526-a8e4-57abf5ad397d` emitted 79 traces and 31 vias, then recorded `pcb_autorouting_error_remaining_routes_subcircuit_source_group_0`: the basic preflight skipped more than 50 remaining routes and explicitly directed the caller to set that board prop. Root added it for the next run. This is a specific installed-core behavior: omission does not guarantee that this large implicit phase executes.

The candidate is **not complete**. It retains 111 port-connectivity errors and an explicit skipped-routing error. A pure rerun of official `checkEachPcbPortConnectedToPcbTraces()` on the final Circuit JSON, with all old `_error` records removed, still reports 111 errors: 61 GND-related and 50 others. Thus stale diagnostics have not been established. The official pour check requires all net peers to share a physical copper root; one disconnected ground island can cause all 61 GND ports to report, so those counts do not locate individual breaks. Exact input hash, timing and fresh errors are retained in `official-postpour-port-check.json`.

Native completion, native DRC and the independent physical copper continuity gate remain required. No diagnostic is suppressed by this evaluation.
