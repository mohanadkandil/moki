# USB5V → 3.3V converter candidate

`tps63001-usb-5v-3v3@1`, content hash `b57cf365a9e1166ecbf9fb51eddf68fd6b4c84ae833878387928b690a16103f8`.

Separate data-only variant; original `tps63001-usb-sys-3v3@1` hash remains `f6737dba04f161f87426c22a99896fbe7b1ad7f7e50818fb51a0b17d4c7e11dc`. This worker emitted the bundle; root alone integrates seed/parts/public receipt fallback and runs native routing. No production/dev restart, native render, routing or compile was performed here.

## Contract and topology

- VBUS: power-in, qualified **4.75–5.25V at the board**. Link `usb.VBUS` → `ldo.VBUS` and share GND. The upstream source must support aggregate USB current; no assumption that an arbitrary USB host permits 1.5A.
- V3V3: power-out, fixed3.3V, **650mA continuous /800mA peak** author allocation. Port3.135–3.465V is an author ±5% budgeting envelope, not a measured tolerance/ripple guarantee.
- U1 actual **C28060 TPS63001DRCR**, physical11pads includingEP11. VIN5/VINA8/EN6 directly VBUS; PS/SYNC7 low; PGND3/GND9/EP11 common ground. Fixed-output FB10 directly VOUT1, no fake resistor divider.
- Actual **C20416998 LPS4012-222MRC2.2uH** bridges L1pad4/L2pad2 through separate switching nets, never a direct short.
- C1–C5 actual **C162430 GRM21BZ71C106KE15L10uF16V X7R0805** (2input/3output); C6 actual **C14663 CC0603KRX7R9BB104100nF50V0603**. Nominal20uF input/30uF output, not an asserted effective22uF. Higher-rated MLCCs replace the old variant's6.3V bulk parts only in this new identity.
- No firmware library/header required.

All four actual immutable importer captures are embedded in `src/blocks/data/usb-buck-drafts.json`. Replay tests verify catalog identity, physical pads, footprint SHA and raw SHA; a tampered response fails integrity validation. No part or supplier receipt was invented.

## Primary-reference basis

1. [TI TPS63001 datasheet SLVS520C](https://www.ti.com/lit/ds/symlink/tps63001.pdf), retained at `docs/engineering/2026-11-05-chip-level/evidence/chip_eda/power-research/tps63001-manufacturer.pdf`, SHA256 `9cac9b7c360f493fcd5a765c25718ce6df4fc26134e7d7ca39ced0dcfc760b95`. P1 specifies1.2A output at3.3V in buck operation with3.6–5.5V input; this USB domain is wholly buck. P4 reference thetaJA46.8C/W. P5 fmin1.25MHz and switch-limit min1.6A/typ1.8A test condition3.6V/25C; this is **not** a guaranteed1.6A all-USB/full-temperature limit or output current. P11 fixed-FB wiring and recommended LPS4012 series. P12 input≥4.7uF and nominal output15uF recommended. P16 switching/ground/EP layout remains required.
2. [TI complete reference SLVA358A](https://www.ti.com/lit/an/slva358a/slva358a.pdf), p6–7, retained adjacent to the previous datasheet (`ti-tps63001-reference-slva358a.pdf`), SHA256 `aaffb9d127ce4ed341773d5b64e6500d6870bb4066713f6cc04983ec3a0df681`. Direct VIN/VINA common rail and fixed feedback are preserved. No mixed partial100ohm-filter variant.
3. [Coilcraft LPS4012 manufacturer sheet](https://www.coilcraft.com/getmedia/a31b0140-5adf-4f7e-b7bf-5e9d605a87b9/LPS4012.pdf), captured here as `coilcraft-LPS4012.pdf`, SHA256 `ca4c3d9625ce88141d6a67d740d6ffeaf4fba19bd9391665c1a8a0aa1fa647b8`. Exact -222 row gives2.2uH±20%, DCRmax0.100ohm, Isat2.3A at10% drop and Irms1.2A for20C rise. Footnotes say temperature-rise current is a25C reference, not an absolute rating guarantee.
4. [Murata exact-part manufacturer sheet retained via supplier](https://datasheet.lcsc.com/datasheet/pdf/aafbc71d90a9d89f42f5e94d0f700539.pdf?productCode=C162430), p1, `murata-C162430.pdf`, SHA256 `591dd237e95ddb3fdd1faf87f2f1dcdc05738c086937e9622fa76a86c7307246`. It identifies GRM21BZ71C106KE15L/K,10uF±10%,16Vdc,X7R0805. It does **not** provide a DC-bias curve or a minimum effective capacitance at the operating rails. `C162430-supplier.*` and PDF receipt retain the actual fetch identity.

## Conservative arithmetic, separate from hardware qualification

`air-erc.json` includes complete reproducible measurements from `usbBuckEvidence()`. CCM ripple is screened at all VIN4.75/5.25 and VOUT3.135/3.465 corners, Lmin1.76uH, fmin1.25MHz. Worst ripple≈0.574071A; at800mA output the inductor peak≈1.087036A, with20% author margin≈1.304443A, below the2.3A25C saturation reference. RMS≈0.816984A, below the1.2A20C-rise reference. This is a steady-state buck screen, not proof of startup/transient/core-loss waveforms or boost operation.

Assumed85% efficiency at650mA and3.465V gives≈0.3975W total converter loss. Author thetaJA60C/W is more conservative than TI's46.8C/W reference;25C ambient yields≈48.85C modeled junction, below110C author limit. Loss includes the whole converter allocation rather than pretending all IC losses are known. Actual PCB copper/EP thermal resistance and efficiency must be measured. Peak input allocation800mA×3.465/(4.75×.85)+.1mA≈686.65mA. No1.8V input/650mA boost claim is made.

The supply is usable by the planner as a declared engineering allocation; it remains **unreviewed**. Warnings explicitly preserve effective-capacitance/DC-bias, ESR, thermal copper, startup/load-step, USB negotiation/inrush, EMI and measured current/temperature/efficiency as unfinished qualification. Passing pure ERC/reference arithmetic is not a manufacturing or hardware guarantee.

## Measured software acceptance

- `tests/blocks-usb-buck.test.ts`: **8/8 pass**, retained `tests.tap`.
- Targeted strict TypeScript check: **pass**, empty `typecheck.log`.
- Deterministic generation and all4 exact importer receipts replay; tampering rejected.
- Dedicated topology gate plus generic draft ERC/power and inductor/thermal arithmetic: **pass**.
- Owner's actual air plan, changing only new converter id and `ldo.SYS`→`ldo.VBUS`: **ERC and power pass**, `air-erc.json`. Load250.5mA typical/552mA peak fits650/800. Board/placement fields are unchanged; this is not a placement pass.
- Exact650mA continuous/800mA peak synthetic budget boundary passes;650.01mA typical or800.01mA peak rejects. The synthetic test changes load metadata only, not physical part identities.
- 2.5V source, old SYS direct-USB input, wrong physical pin mapping, missing supplier capture, changed feedback, missingEP ground, shorted switching nodes, wrong actual capacitor/inductor and unjustified current/efficiency/ambient changes reject.

Reproduce with `node_modules/.bin/tsx --test tests/blocks-usb-buck.test.ts` and `node_modules/.bin/tsx docs/engineering/2026-11-06-chip-live/evidence/chip_eda/usb-buck/check-air.ts`. Generator reads retained captures; it does not run a model, render or compile firmware.

## SHT preflight integration fix

The first actual air job `e0ad14a3-8a23-4ea6-bda7-6fbd16a4b592` stopped before routing because native `routingDisabled` still renders the compiler's four explicit SHT40 `pcbPath` stubs. The original blanket `pcb_trace` guard rejected these intentional local footprint exits.

`eda/blocks/fanout.ts` now has **code-owned** `allowPreRoutedFootprintHints?: boolean`. Default behavior still rejects any preexisting trace. When enabled, any preexisting traces must consist exactly of four SHT40-AD1B-R2/C2909890 native local exits per sensor. It checks unique PCB trace identity, exact physical source pins1–4, source trace → one source port → actual PCB port/land → unique named source net and subcircuit connectivity, cardinal native placement, top0.15mm two-point routes, start-port binding, exact local pad/exit coordinates and0.522582mm length. Extra routes, duplicates, incomplete sensors, vias and altered endpoint/source/net membership reject. Native pad/trace/drill/via/board/cutout checks run on a clone; SHT keepout's actual own-component exclusion is respected. New fanout proposals also keep native≥0.127mm foreign-net clearance from retained hints. It returns a `preRoutedFootprintHints` audit; final native/source/copper gates remain required.

The positive fixture is explicitly a **derived subset of retained actual native SHT output**, preserving the original four footprint stubs and all actual source/pad geometry while removing subsequent autorouter traces/vias. It is not new native routing acceptance. Tests cover cardinal transformations, default rejection, extra/routed/via/shifted/wrong-net/source mutants, foreign copper/drill/keepout/board violations and a new exit crossing a foreign-net retained hint. Six new tests plus14existing fanout tests: **20/20 pass**; targeted strict TypeScript check passes. Full log: `fanout-preflight-tests.tap`. No native render or firmware compile was used for this fix.

Root integration: pass `allowPreRoutedFootprintHints: graph.parts.some(p => p.part.lcsc === 'C2909890')` only for the compiler-created routing-disabled diagnostic. No author JSON flag or arbitrary TSX bypass is added.
