# Audio, LED and display-connector schematic research

5 November 2026. Draft electrical facts for agent-authored, **unreviewed** blocks; no promotion, fabrication approval, simulation, ERC/DRC or assembled-board measurements are implied. Owner refocus prioritizes schematic/reference-circuit correctness and cheap SPICE checks; no further footprint work was undertaken. Existing PDF text/tables and reference-circuit captions were inspected; rendered circuit images have not received a separate visual review.

## Actual supplier identities and evidence

| Function | Actual catalog/importer identity | Local evidence |
| --- | --- | --- |
| I2S microphone | TDK/InvenSense ICS-43434, C5656610 | `mic-importer.json`; `../search-research/jlc-post-ics43434.response` |
| I2S amplifier | ADI/Maxim MAX98357AETE+T, C910544, TQFN-16-EP(3x3), **not BGA** | `amp-importer.json`; `../search-research/jlc-post-max98357a.response` |
| Addressable LED | Worldsemi WS2812B-V5/W, C2874885, SMD5050-4P | `led-importer.json`; `ws2812-search.json` |
| LED level translator | TI SN74AHCT1G125DBVR, C7484, SOT-23-5 | `ahct-importer.json`; `ahct-search.json` |
| Display connector | JST SM04B-SRSS-TB(LF)(SN), C160404, SH **1 mm pitch** | `display-importer.json`; `../search-research/C160404-source-receipt.json` |

All identifiers come from the retained actual responses. Adjacent `.receipt.json` files preserve request URL/time/hash; copied display evidence points to the coordinator's actual source receipt. Stock snapshots are not availability promises. JLC catalog results include unstocked assembly/module pseudo parts; selection must bind exact supplier ID and MPN. The microphone's [current official product page](https://invensense.tdk.com/products/digital/ics-43434/) marks it EOL, also retained as `mic-product.html`: suitable as a seed proof only with an explicit lifecycle warning, not an unqualified new-design recommendation.

## ICS-43434 microphone

Primary: TDK/InvenSense DS-000069 v1.2, retained real PDF `mic-primary.pdf` (21 pages), [official manufacturer-linked download](https://d17t6iyxenbwp1.cloudfront.net/s3fs-public/2026-03/DS-000069-ICS-43434-v1.2.pdf?VersionId=W5u1f2s5LpMkDjoZSc3k7UxneMl9.WkV). Product page exposes this URL. Earlier `mic-datasheet.pdf` is HTML, not a datasheet PDF; its receipt records that failure.

Datasheet pin description p10 and application circuit Figure 8 p13 (decoupling guidance p15) agree with raw importer: **1 WS**, **2 LR**, **3 GND**, **4 SCK**, **5 VDD**, **6 SD**. Supply 1.65–3.63 V. Place 100 nF ceramic X7R directly between VDD/GND, short connections without intervening vias; p15 gives placement guidance. Tie LR low for the left slot or high for right; do not leave it floating. SD tri-states outside its time slot; the application circuit calls for 100 kΩ SD-to-GND. WS has internal 100 kΩ pulldown; this does not replace correct clock wiring.

Use 48 kHz WS and 64 SCK per stereo frame (3.072 MHz) for a shared mic/MAX98357A I2S bus, 24-bit mic data within 32-bit slots, no MCLK. High-performance sample-rate range is 23–51.6 kHz; low-power 6.25–18.75 kHz. Supply current table: HP 490 µA typ/550 µA max, LP 230/300 µA, sleep 12/20 µA (specified operating conditions apply). These are not speaker/amplifier power budgets.

Bottom acoustic port requires an open PCB acoustic path and enclosure access; do not cover with copper/solder or seal against the case. Exact acoustic-hole/keepout geometry is **not verified here**. Schematic draft must expose correct I2S direction (mic SD drives MCU input), channel strap, supply and decoupler; lifecycle and mechanical constraints remain explicit blockers to promotion.

## MAX98357A amplifier

Primary [ADI datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX98357A-MAX98357B.pdf), current accessible web text Rev16 July2019. Direct PDF downloads timed out (`amp-datasheet.pdf` is empty and its receipt says timeout). A real manufacturer-authored PDF copied from the exact C910544 JLC product's supplied download is retained as `amp-manufacturer-jlc-mirror.pdf`, **older Rev11 May2018**, 38 pages. Its URL and hash are in adjacent receipt and `amp-catalog-pdf-urls.json`. Pin/reference values below agree across inspected revisions; the older mirror is not mislabeled current.

TQFN pin table p15: **1 DIN**, **2 GAIN_SLOT**, **3 GND**, **4 SD_MODE**, **5 NC**, **6 NC**, **7 VDD**, **8 VDD**, **9 OUTP**, **10 OUTN**, **11 GND**, **12 NC**, **13 NC**, **14 LRCLK**, **15 GND**, **16 BCLK**, **17 EP**. Connect both supply pins, all GND pins and exposed pad to GND with thermal connection. Leave NC pins unconnected. This EP treatment is different from SHT40's forbidden central copper.

Supply 2.5–5.5 V. Applications p33 specify **100 nF + 10 µF VDD-to-GND**, short return and supply paths. GAIN_SLOT p28: direct VDD = 6 dB, direct GND = 12 dB, floating = 9 dB, 100 kΩ to VDD = 3 dB, 100 kΩ to GND = 15 dB. A draft may choose the explicit GND/12 dB strap; annotate rather than infer a resistor value from another option.

SD_MODE is an analog multi-threshold channel/shutdown input. Direct valid logic high selects left, low shuts down; for a 3.3 V control source the p17 resistor table uses 210.2 kΩ for right or 634 kΩ for mono mix. Do not copy 1.8 V control values 69.8 kΩ/300 kΩ onto a 3.3 V circuit. Observe the input-versus-VDD restriction and power sequencing when MCU stays powered while amplifier is off; the datasheet discusses series resistance for over-rail input operation. This draft has **not verified an off-supply injection-current-safe control circuit**; either enforce sequencing or independently check the resistor/current prescription before promotion.

Digital BCLK/LRCLK/DIN VIH minimum is 1.3 V, so normal 3.3 V I2S is compatible while the amplifier is powered. MAX98357**A** accepts I2S; B is left justified. Supported LRCLK: 8/16/32/44.1/48/88.2/96 kHz; not 11.025/12/22.05/24 kHz. A 48 kHz, 64 BCLK/frame bus matches the mic. Speaker connects **between OUTP and OUTN**, neither output to GND. Filterless operation assumes speaker series inductance >10 µH; verify actual speaker and cable EMC requirements.

Choose a verified 8 Ω speaker and a separately budgeted 5 V rail. At 5 V, datasheet p1 characterizes 8 Ω output at 1.8 W/10% THD or 1.4 W/1% THD; 4 Ω reaches 3.2 W/10% or 2.5 W/1%. Typical 92% efficiency is not a minimum guarantee. Example **engineering budget assumption**, not an IC guaranteed maximum: 1.8 W/(5 V × 0.8 assumed efficiency) = 450 mA plus active quiescent current; reserve at least a deliberately justified 500 mA for this selected use and validate rail/transients/thermal limits. At 1.8 W into 8 Ω, speaker RMS current is 0.474 A and sine peak 0.671 A. Do not count only the 2.75 mA typical / 3.35 mA maximum quiescent current at the specified table conditions as full-load draw. Thermal data based on a specified four-layer board does not validate a two-layer implementation.

## WS2812B-V5/W and 3.3 V logic

Primary Worldsemi [WS2812B_V5/W V6.1](https://world-semi.com/web/userfiles/productfile/WS2812B_V5WDatasheet_V6.1_EN.pdf), real eight-page `led-primary.pdf`. Earlier `led-manufacturer-lcsc-mirror.pdf` is an HTML wrapper, not a PDF.

Pin/ratings tables p2–3: **1 VDD, 2 DOUT, 3 VSS, 4 DIN**. Actual EasyEDA symbol has a stale SPICE/header number 3 on DIN but displayed physical number 4; pinned EasyEDA parser gives physical number precedence. Catalog parser now matches it with a regression against `led-importer.json`; this is not a reason to remap actual physical pad 4 to pad 3.

The p2 table labels 3.7–5.3 V as **absolute maximum ratings**, rather than providing a clean separate recommended-operating range: do not silently relabel this as guaranteed operating limits. The input table specifies **VIH ≥0.63×VDD**. At 5.3 V the threshold is 3.339 V, exceeding nominal 3.3 V MCU output even before VOH losses: direct 3.3 V data is not guaranteed. Use the verified C7484 AHCT translator for a 5 V design. Timing table: 800 kb/s protocol and reset low >280 µs; firmware must use this variant's reset window.

Manufacturer characterizes ~12 mA per color channel, ~0.6 mA typical quiescent: nominal white estimate 36.6 mA. A 60 mA/LED reserved budget is a conservative **authoring policy**, not a guaranteed maximum stated by this variant's datasheet. V5/W explicitly advertises no external capacitors required; optional 100 nF local decoupling and a 330 Ω data series resistor are engineering defaults requiring rationale, not manufacturer-mandated values for this exact part.

TI [SN74AHCT1G125 RevP March2024](https://www.ti.com/lit/ds/symlink/sn74ahct1g125.pdf), retained `ahct-datasheet.pdf`: **1 /OE low**, **2 A ← MCU data**, **3 GND**, **4 Y → LED DIN**, **5 VCC 5 V**. Supply 4.5–5.5 V, input VIH 2 V/VIL 0.8 V; 3.3 V drive is compatible. Output minimum VOH 3.8 V at the specified 4.5 V/8 mA test condition exceeds LED threshold above. Decoupling guidance p10 recommends 100 nF close to the supply. AHCT requires a 4.5–5.5 V operating rail; the LED table imposes a 5.3 V upper bound. A nominal 5 V shared rail with tolerance confined to **4.5–5.3 V** is a draft design constraint; the LED’s poorly separated absolute/operating ratings still require review. Do not leave buffer input floating; independently verify MCU-off/buffer-on sequencing and LED connector hot-plug behavior before promotion.

## SSD1306 module connector contract

The actual C160404 part is a four-signal JST **SH 1 mm** connector, not JST PH 2 mm and not a bare OLED controller. Raw symbol numbers 1–4 are cable signals; 5/6 are mechanical mount tabs. Proposed interface **1 GND, 2 +3.3 V, 3 SCL, 4 SDA** is our explicit cable contract, not a manufacturer guarantee about arbitrary SSD1306 display modules. Confirm actual module/cable polarity, voltage, I/O levels and connector mating family before use. SSD1306 I2C 0x3C versus 0x3D depends on the selected module's address strap; no module has been selected or verified in this research.

External module current and on-module pullups/regulator are unknown. Do not invent a complete display current budget or bare-controller charge-pump circuit. Board-level I2C pulls must account for parallel module pullups and total bus capacitance. Any connector-side capacitor values are design assumptions until the actual module datasheet is attached. A later bare SSD1306 implementation needs its own exact catalog identity, complete pinout and reference-circuit review; this connector draft does not satisfy that task.

## Outstanding checks

No blocks in this note have independently passed ERC, SPICE, layout/DRC, firmware compilation or promotion review. Exact-ID datasheet metadata/receipts are implemented in the catalog service; future agent downloads must use those response URLs and enforce DNS/redirect/private-network controls. Historical primary-source research links above were discovered before that authoring restriction and must not be silently substituted for response-pinned receipts in a new agent draft. Independent review must check datasheet citations, circuit images, required control pins, current/thermal assumptions, MCU off-state injection and the actual speaker/display module. No additional packages, builds, production changes or paid model calls were used for this research.
