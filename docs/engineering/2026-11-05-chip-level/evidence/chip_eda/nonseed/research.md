# Non-seed candidate: SHT40-AD1B-R2

Research captured 5 November 2026. **Suitable to author as an unreviewed block; not promoted, fabricated, routed, tested or physically verified by this research.** Only this evidence directory was written. No package/code changes, builds or paid model calls were made.

## Catalog and importer provenance

The [actual JLCPCB catalog page](https://jlcpcb.com/partdetail/Sensirion-SHT40_AD1BR2/C2909890) identifies Sensirion **SHT40-AD1B-R2, C2909890**, extended SMT part, package DFN-4-EP(1.5×1.5). The captured HTML is `jlc-catalog.html`; its HTTP receipt and SHA-256 are in `fetch-receipts.json`. The number was taken from that catalog response, then independently matched against the importer response. Current purchasing stock, price and assembly availability are not asserted.

The [tscircuit EasyEDA cache endpoint](https://jlcsearch.tscircuit.com/api/easyeda_components/C2909890) returned the actual symbol/footprint payload, retained as `tscircuit-easyeda-cache.json`; request metadata/hash are in `importer-fetch-receipts.json`. Cache `fetched_at` is **2026-09-07T14:59:57.364Z**, not today's fresh upstream fetch. The primary [jlcsearch API documentation](https://github.com/tscircuit/jlcsearch/blob/main/README.md) describes its shared EasyEDA cache. Direct EasyEDA API and resource-page requests returned 403; the optional footprinter-string lookup returned 500. These failures are recorded, not hidden.

Identity: component UUID `704b4bce23e04ce88c7b56255b0d6a76`; footprint UUID `d243d258368c4d11b605e1b814b0df31`; model UUID `f817eda30a194870afe8b70bfc254f82`. No 3D model was downloaded or validated. `importer-analysis.json` retains original pin/pad strings and a clearly labelled coordinate conversion; it is analysis, not a fabricated replacement catalog response.

## Manufacturer-verified pin map and reference circuit

Sensirion's [SENSEVAL-SHT4XV1 technical description, v1.1 March 2023, printed p2](https://sensirion.com/media/documents/93E06008/640B25FB/SENSEVAL_SHT4XV1_technical_description.pdf#page=2) supplies the reference schematic and pin table. Download retained as `sensirion-eval-v1.1.pdf`.

| Sensor pin | Function | Proposed connection |
| --- | --- | --- |
| 1 | SDA, bidirectional | I²C SDA; 10 kΩ to sensor VDD |
| 2 | SCL, clock input | I²C SCL; 10 kΩ to sensor VDD |
| 3 | VDD | 3.3 V; 100 nF bypass to VSS |
| 4 | VSS/GND | Ground |

The evaluation schematic uses **100 nF, 10 V, X7R**, two **10 kΩ** pull-ups and address **0x44**. Its p8 cautions that pull-ups depend on the complete bus and suggests checking waveforms. Passive supplier numbers have not been selected by this research; use separately captured catalog entries, never generated IDs.

## Manufacturer constraints

Current [SHT4x datasheet v7.3, June 2026](https://sensirion.com/media/documents/33FD6951/6A7C10A0/HT_DS_Datasheet_SHT4x_V7.3.pdf), retained as `sensirion-sht4x-v7.3.pdf`:

| Printed page | Constraint |
| --- | --- |
| 9 | VDD 1.08–3.6 V; measurement 320 µA typical, 500 µA maximum. Highest heater setting: 60 mA typical, 100 mA maximum. |
| 9 | Pull-up minimum 390 Ω at VDD≥1.62 V; 820 Ω below. Bus capacitance: Cb<trise/(0.8473×Rp); fast-mode rise limit 300 ns, fast-mode-plus 120 ns. |
| 10 | Any pin absolute limit VSS−0.3…VDD+0.3 V; power-up maximum 1 ms. |
| 11 | No clock stretching; busy reads NACK. |
| 13–14 | Heater duty at most 10%; heated readings lack normal accuracy; heater operation requires adequate supply and ambient below 65 °C. |
| 16–17 | Avoid soldering/exposing copper beneath central die pad; no copper beneath sensor except pin pads. Die pad has no electrical connection to any pin. |

The catalog's 400 nA figure is not a worst-case power budget. The product-page family headline accuracy also must not be substituted for SHT40's own accuracy.

## Importer conflict: central EP copper

The actual importer symbol has pins **1=SDA, 2=SCL, 3=VDD, 4=VSS, 5=EP**. Its footprint includes a **0.4×1.1 mm central copper PAD5**, contrary to the manufacturer land-pattern recommendation above. **Do not ground pin 5 or silently accept the unmodified footprint.** Record an explicit, reviewed transformation removing this imported centre copper/paste primitive; retain only the four functional contact pads. Check all exported layers/paste and pours against the keepout. The shared footprint also contains its own historical datasheet link; this research uses the manufacturer PDF rather than treating that link as sensor pinout authority.

Pins 1–4 agree functionally with the manufacturer table. Imported pad centres, about the package origin with Y up, are approximately 1=(-0.6774,+0.4001), 2=(-0.6774,-0.4001), 3=(+0.6774,-0.4001), 4=(+0.6774,+0.4001) mm; pads are approximately 0.5050×0.4200 mm. These are converted importer coordinates, **not independent confirmation of the manufacturer's land-pattern dimensions or final assembly orientation**. Compare converted output against datasheet Figure 17/18 before promotion.

## Proposed engineering policy and gates

- Default **heater disabled**. At 3.3 V, two 10 kΩ pull-ups consume up to 0.66 mA together; adding 0.5 mA sensor measurement gives **1.16 mA**. A 2 mA block allocation is an author-selected margin. Enabling the highest heater needs more than **100.66 mA** sensor-plus-pull-up allocation, with explicit regulator headroom; do not rely on the microamp average.
- From the manufacturer's rise-time equation, 10 kΩ permits less than **35.4 pF at fast-mode**; it is not a universal 400 kHz choice. Account for parallel pull-ups, all devices and traces. Use 100 kHz for the first proof and verify capacitance/timing before claiming faster operation.
- Pull-ups share sensor VDD. No direct 5 V interface; prevent powered MCU/pull-ups driving an unpowered sensor. Declare SDA open-drain/bidirectional, SCL input, VDD power input and VSS ground. Address collision checking must include fixed 0x44.
- Place bypass close to the IC; a proposed ≤2 mm placement rule is an author policy, not a quoted manufacturer distance. Keep the sensing opening exposed; place away from warm regulators/MCU and provide ambient airflow. A conservative all-copper-layer keepout under the sensor, excluding contact pads, is likewise an author policy pending manufacturer-layout review.
- Start lifecycle **unreviewed** in block metadata, UI and BOM. Required proof: reference-circuit tests; ERC mutants for missing bypass/pull-ups, wrong voltage/current and address clash; successful routing/DRC; exported copper/paste keepout checks; pin/pad orientation review; measured pipeline evidence. An independent reviewer or human must inspect the authored source and those results before an explicit, attributed promotion record. Research completion alone must never promote it.

Remaining uncertainty: converted footprint fidelity/orientation, exact keepout implementation, solder/paste process, thermal accuracy in the final enclosure, actual bus load/waveforms, selected passive catalog provenance, purchased part availability and hardware behavior. No manufacturing approval is implied.
