# Seed power blocks: verified identities, pin maps and limits

Research date: 5 November 2026. Scope is manufacturer/reference-circuit research and read-only catalog/importer queries. No application code, packages, firmware, routing or production services changed. These are **unreviewed block candidates**, not verified manufactured designs.

Raw symbol/footprint/model records are from the **JLCEDA/EasyEDA Official Library**: [JLCEDA](https://lceda.cn/), [EasyEDA](https://easyeda.com/). Full responses, including their original attribution/license fields, are retained unchanged. `catalog-import-summary.json` records the supplier identities, symbol and footprint UUIDs, pin maps and pad numbers. Presence of a 3D model record does not prove the model was downloaded or correctly aligned.

## What is established

All six candidates below were found in actual LCSC catalog pages, then returned successful raw EasyEDA API responses with matching manufacturer, MPN and supplier code. Every electrical symbol pin was checked against the manufacturer's datasheet. The raw footprint contains the expected pad identities. This worker did **not** convert these payloads to tscircuit, verify land-pattern dimensions, run DRC or measure physical fit; the coordinator owns importer/render proof.

| Intended use | Manufacturer / exact MPN | Confirmed LCSC | Saved response |
| --- | --- | --- | --- |
| 3.3 V LDO | Diodes AP2112K-3.3TRG1 | [C51118](https://www.lcsc.com/product-detail/C51118.html) | `ap2112-easyeda.json` |
| Alternative 3.3 V LDO | MICRONE ME6211C33M5G-N | [C82942](https://www.lcsc.com/product-detail/C82942.html) | `me6211-easyeda.json` |
| Single-cell charger | Microchip MCP73831T-2ACI/OT | [C424093](https://www.lcsc.com/product-detail/C424093.html) | `mcp73831-easyeda.json` |
| Fixed 3.3 V buck-boost | TI TPS63001DRCR | [C28060](https://www.lcsc.com/product-detail/C28060.html) | `tps63001-easyeda.json` |
| Through-hole PH battery connector | JST B2B-PH-K-S(LF)(SN) | [C131337](https://www.lcsc.com/product-detail/C131337.html) | `jst-ph-easyeda.json` |
| SMT PH alternative | JST B2B-PH-SM4-TB(LF)(SN) | [C160352](https://www.lcsc.com/product-detail/C160352.html) | `jst-ph-smt-easyeda.json` |

The successful AP2112 search response also contains same-name parts from other manufacturers. In particular C23380830 is TECH PUBLIC, **not Diodes**. Those candidates must not inherit the Diodes datasheet constraints. Query identity must include manufacturer, full orderable MPN and supplier code, not just the family name. Four other queries to jlcsearch returned HTTP 500; direct LCSC catalog pages and the official EasyEDA API succeeded. Manifests retain failures instead of treating them as absent parts. EasyEDA's embedded stock fields and LCSC/search stocks differ; neither is an assembly-availability guarantee.

## Pin maps

Numbers are physical package pads, not schematic drawing order. Datasheet page links are one-based PDF page numbers.

| Part/package | Verified pad map | Primary source |
| --- | --- | --- |
| AP2112K, SOT25 | 1 VIN; 2 GND; 3 EN; 4 NC; 5 VOUT | [Diodes DS39724 rev.2-2, pp.1–2](https://www.diodes.com/datasheet/download/AP2112.pdf#page=2) |
| ME6211C33M5G-N, SOT23-5 | 1 VIN; 2 VSS; 3 CE; 4 NC; 5 VOUT | [MICRONE V14 linked to C82942, p.4](https://datasheet.lcsc.com/datasheet/pdf/d15331d096a848ac81a26b001a32d4e3.pdf?productCode=C82942#page=4) |
| MCP73831T-2ACI/OT, SOT23-5 | 1 STAT; 2 VSS; 3 VBAT; 4 VDD; 5 PROG | [Microchip DS20001984H, p.11](https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP73831-Family-Data-Sheet-DS20001984H.pdf#page=11) |
| TPS63001DRCR, VSON10 + exposed pad | 1 VOUT; 2 L2; 3 PGND; 4 L1; 5 VIN; 6 EN; 7 PS/SYNC; 8 VINA; 9 GND; 10 FB; exposed pad PGND | [TI SLVS520C, p.3](https://www.ti.com/lit/ds/symlink/tps63001.pdf#page=3) |
| JST PH2 | Contacts 1 and 2; polarity is a design/harness assignment, not a universal PH battery convention | [JST PH drawing, pp.1–4](https://www.jst-mfg.com/product/pdf/eng/ePH.pdf#page=3) |

TPS63001's unnumbered exposed pad is numbered **11 / PAD** in this EasyEDA symbol and footprint. The block must connect pad11 to PGND. The SMT JST import exposes **four** symbol/footprint pins: electrical contacts1/2 and mounting tabs3/4. Tabs must be classified as mechanical anchors rather than extra battery contacts; their net/NC treatment needs an explicit block rule. C131337 is through-hole and is not an SMT pick-and-place assembly solution by itself.

## AP2112: usable current needs a thermal budget

The manufacturer's application circuit uses 1 µF input and output capacitors; X5R/X7R ceramic is recommended. Tie EN high deliberately for an always-on block and leave NC unconnected. At the 3.3 V version, the datasheet gives a 600 mA minimum electrical output-current capability at VIN=4.3 V, typical 250 mV / maximum 400 mV dropout at 600 mA, and EN high/low limits of 1.5 V / 0.4 V. Its disabled output is discharged through a typical 60 Ω path. [DS39724 pp.2,8](https://www.diodes.com/datasheet/download/AP2112.pdf#page=8)

These facts do not establish a continuous 500 mA rail from USB5V. The SOT25 no-heatsink junction-to-ambient thermal resistance is 184 °C/W; the absolute junction maximum is 150 °C. [DS39724 p.3](https://www.diodes.com/datasheet/download/AP2112.pdf#page=3)

Calculated screening example, not a board measurement: 5→3.3 V at 500 mA dissipates approximately **0.85 W** and would imply a **156 °C rise** using 184 °C/W. At ambient40 °C with a chosen design junction limit125 °C, the same simplified model limits continuous load to approximately272 mA at VIN5.0 V, or237 mA at VIN5.25 V. Those values are estimates, not new part ratings; actual copper, enclosure and airflow still need verification. Burst operation also needs a time-domain/current/transient analysis.

A safe seed contract should record the device's 600 mA electrical rating separately from its board-dependent sustainable current. Do not advertise the spike as a measured ≥500 mA supply. The 3.3 V LDO also cannot hold 3.3 V throughout a one-cell LiPo discharge, because the cell falls below the required regulation headroom. Do not parallel the LDO output with another regulator or assume reverse blocking; the discharge path is an additional reason to model disabled-state behavior explicitly.

## ME6211: the exact supplier-attached datasheet is materially weaker

For C82942 the attached document is **V14**, saved as `me6211-c82942-manufacturer-v14-lcsc-mirror.pdf`. Its C-series reference circuit uses 1 µF CIN and CL, CE tied to VIN and NC open. The extracted original reference-circuit images are preserved; `me6211-v14-page2-Image34.png` was visually inspected and shows that connection. [MICRONE V14 pp.2,4](https://datasheet.lcsc.com/datasheet/pdf/d15331d096a848ac81a26b001a32d4e3.pdf?productCode=C82942#page=2)

V14 lists **500 mA in the typical column**, at VIN=VOUT+1 V and TA25 °C, with ±2% output accuracy. It gives typical dropout120 mV at100 mA and260 mV at200 mA; it supplies no maximum500 mA dropout specification in that table. CE high is1.0 V and low0.5 V. [V14 pp.8–9](https://datasheet.lcsc.com/datasheet/pdf/d15331d096a848ac81a26b001a32d4e3.pdf?productCode=C82942#page=8)

More decisively, V14's **absolute** package dissipation rating is only **300 mW for SOT23**. [V14 p.5](https://datasheet.lcsc.com/datasheet/pdf/d15331d096a848ac81a26b001a32d4e3.pdf?productCode=C82942#page=5) Calculated 5→3.3 V at500 mA requires850 mW; even4.2→3.3 V at500 mA requires450 mW. Therefore this exact documented candidate cannot satisfy an unconditional continuous500 mA source requirement. Even the simple300mW/1.7V≈176mA value is an absolute-limit screen, not a recommended operating current.

A V20 family document was also found via a different LCSC item and retained separately. It has changed headline values, including ±1% and input range, and must not silently replace C82942's V14 evidence. The manufacturer website timed out during this research. Resolution requires confirming the exact ordered-device revision and its guaranteed thermal/current conditions, or choosing a better-supported regulator. Do not promote this candidate merely because the catalog title says500mA.

## MCP73831 + battery: charger first, system power path separately

C424093 is the **4.20 V -2AC** option: preconditioning10% of programmed current, precondition threshold66.5% of VREG, termination7.5%, recharge96.5%. The AT option has different thresholds, so swapping C424093 for a same-family -2AT part changes behavior. [DS20001984H p.26](https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP73831-Family-Data-Sheet-DS20001984H.pdf#page=26)

Candidate defaults: 10 kΩ PROG-to-VSS gives100 mA nominal; 2 kΩ gives500 mA nominal. The relation is IREG[mA]=1000/RPROG[kΩ]. Manufacturer guidance uses4.7 µF at VDD and at VBAT; keep them close to their respective IC/ground pins. Floating PROG disables charging. 500 mA is the programming ceiling, not an assured thermally sustainable charge rate. [DS20001984H pp.11,15,18](https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP73831-Family-Data-Sheet-DS20001984H.pdf#page=18)

STAT on **MCP73831 is tri-state and actively drives high**, unlike MCP73832's open drain. Its high output is related to VDD (VOH typicalVDD−0.4 V at4 mA), so direct connection to a3.3 V MCU GPIO while VDD=5 V is invalid without a verified level interface. An LED indicator through a calculated resistor, or no STAT connection, is the safer initial block. [DS20001984H pp.4,15](https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP73831-Family-Data-Sheet-DS20001984H.pdf#page=4)

The SOT23 thermal model is230 °C/W on the specified standard board, with large-area copper potentially improving it; thermal regulation reduces charging current. At5 V, a3.0 V cell and500 mA, calculated charger loss is1 W. A100 mA candidate reduces that to0.2 W, but the actual battery's allowed charge rate, temperature, input budget and board thermal conditions still govern. This charger has no battery-temperature input or safety timer. Reverse discharge protection at its input is not a complete battery overdischarge/short-circuit protector. A battery block must declare a compatible4.20 V single-cell chemistry, protection status, charge-current limit and harness polarity. [DS20001984H pp.1,5,14,18](https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP73831-Family-Data-Sheet-DS20001984H.pdf#page=5)

Do **not** connect an always-running system directly to VBAT and call it a complete charge-while-use solution: system current can stop the charger reaching its termination threshold. Microchip explicitly explains this failure and supplies a P-channel MOSFET + Schottky diode + gate-pulldown load-sharing topology;100 kΩ is its example pulldown. That topology needs separately sourced, verified switch/diode parts and input-current accounting. AN1149's worked circuit uses MCP73837; the separate saved MCP7383X reference design demonstrates the approach with MCP73832, whose power pins follow the same charger family. This is reference guidance, not proof that an unreviewed MOSFET orientation is correct. [Microchip AN1149 pp.5–6](https://ww1.microchip.com/downloads/en/AppNotes/01149c.pdf#page=5), [MCP7383X reference guide pp.6–8,16](https://ww1.microchip.com/downloads/en/DeviceDoc/51746a.pdf#page=16)

For a first usable battery block, choose either charge-only while system-disabled, an independently reviewed discrete load-sharing block, or a reviewed integrated power-path charger. USB source current must cover **system input current + charging current**, including conversion losses and startup peaks. CC pull-downs alone do not justify assuming an arbitrary high-current USB source.

## TPS63001: appropriate topology, conditional current and layout

The fixed3.3 V device requires an inductor **between L1/pad4 and L2/pad2**, FB/pad10 connected directly to VOUT/pad1, VIN/pad5 powered, VINA/pad8 supplied/decoupled, and both GND/pad9 and PGND/pad3 plus exposed pad11 correctly grounded. EN is active high. PS/SYNC low enables power-save; high forces fixed-frequency operation. Reference values are2.2 µH,10 µF input, two10 µF output capacitors, and a100 Ω /0.1 µF control-supply filter in the datasheet circuit. The component table is keyed by descriptions because the first-page diagram and later table use different C-number assignments. [TI SLVS520C pp.1,3,10–12](https://www.ti.com/lit/ds/symlink/tps63001.pdf#page=10)

The fixed device needs **no output-voltage divider**. TI also supplies a simpler complete reference, PMP4778, with VIN/VINA supply connections, three10 µF capacitors,2.2 µH and a0 Ω FB-to-VOUT link; retain one reviewed topology rather than mixing partial diagrams. [TI SLVA358A pp.6–7](https://www.ti.com/lit/an/slva358a/slva358a.pdf#page=6)

Recommended VIN/VINA range is1.8–5.5 V, operating junction−40 to125 °C. The advertised output envelope is up to1.2 A buck at VIN3.6–5.5 V and up to800 mA boost at VIN>2.4 V. The1.8 A typical switch-current figure is **not** the output rating; the electrical table's switch-current limit is1.6/1.8/2.0 A min/typ/max at the stated test condition. Do not assign a single unrestricted1.8 A source budget. [SLVS520C pp.1,4–5](https://www.ti.com/lit/ds/symlink/tps63001.pdf#page=5)

Calculated battery-budget example: a3.3 V500 mA load is1.65 W. At VIN2.5 V and assumed90% efficiency it draws about733 mA before other battery loads. Battery/protection/connector/inductor/trace ratings must cover the input-side demand and peaks. Inductor saturation selection must use worst-case minimum input and peak current; TI asks for20% above the calculated peak. A nominal2.2 µH value alone is insufficient. Effective ceramic capacitance after DC bias/tolerance must also meet the chosen reference's requirements. [SLVS520C pp.11–12](https://www.ti.com/lit/ds/symlink/tps63001.pdf#page=12)

Hard layout requirements: short/wide power loops; inductor and input/output capacitors next to the IC; local control ground separated from noisy power-current paths and joined nearby; feedback sensing kept quiet; exposed-pad solder/thermal path. A routed two-layer DRC-clean board alone does not prove switching stability, transient behavior or EMI. The datasheet quotes46.8 °C/W in the thermal table and48.7 °C/W in its later example: these are reference thermal conditions, not exact predictions for this board. [SLVS520C pp.4,16](https://www.ti.com/lit/ds/symlink/tps63001.pdf#page=16)

## Inputs needed for a generic ERC contract

These are research requirements for the later implementation, not an implemented checker:

- Distinguish absolute ratings, guaranteed electrical bounds, typical values, design assumptions and measured limits. Unknown required limits must fail closed rather than becoming zero or infinite capacity.
- Model regulator input/output ranges, dropout or conversion behavior, sustainable current under temperature/VIN, peaks, losses and capacitor requirements. Propagate downstream demand back to the supplying source through conversion efficiency.
- Model battery chemistry/max voltage, allowed charge/discharge current, temperature/protection declarations, power-path state and connector polarity. Check charging and system demand together in every supported source state.
- Model push-pull, open-drain and tri-state voltage domains. MCP73831 STAT is the concrete regression case. Classify NC, exposed pad and connector mechanical anchors explicitly.
- Bind each block revision to its exact manufacturer/MPN/LCSC and immutable importer/datasheet hashes, plus review status. Do not allow same-name supplier substitutions to inherit approval.
- Retain adjacency/loop/thermal constraints for layout verification. ERC validates intent; routed physical realization and hardware tests need separate gates.

## Evidence and limits

Saved PDFs include original manufacturer datasheets for AP2112, MCP73831 and TPS63001; MICRONE V14/V20 manufacturer-authored documents mirrored by LCSC; Microchip AN1149/reference guide; TI SLVA358A; JST's official PH drawing. Download manifests contain URLs, retrieval times, sizes, hashes and failed attempts. Text extraction used an already-installed vendored pypdf reader; some rotated/glyph text is imperfect, so PDFs and the inspected original ME reference images remain authoritative. No dependencies were installed.

Open: exact capacitor/inductor/load-sharing FET/diode procurement and derating; complete thermal validation; connector tab mapping through the actual tscircuit importer; routing; DRC; copper; physical power sequencing/transient/charging tests. No hardware was fabricated or ordered, and no manufacturer performance was measured.
