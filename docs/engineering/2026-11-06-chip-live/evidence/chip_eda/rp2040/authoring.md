# RP2040 minimal v1 author evidence

Author: `chip_review-rp2040-author`. This is authoring evidence, not independent approval. Published v1 content hash: `458373d65744db7e252cca97bf94f096a8b1bb77da4672c01b276408290f4c90`. The draft and generator were left unchanged after the coordinator published this revision.

The bundle contains 33 physical parts, 14 exact supplier identities and 28 immutable actual HTTP receipts. It includes bare RP2040 QFN56+EP, W25Q16JVSSIQ 2MB SOIC8 flash, recommended ABM8-272-T3 12MHz crystal, 15pF loads and 1k output damping, internal 1.1V regulator bypass, AP2112K 3.3V, USB-C independent 5.1k Rd, USBLC6, 27Ohm USB links, RUN pullup/reset and isolated BOOTSEL. Canonical GP0–GP29, ADC aliases, GP14/15 motor aliases and optional GP20/21 I2C0 ports use actual physical pads.

`node --import tsx --test tests/blocks-rp2040.test.ts`: **8/8 PASS**, 584ms total. Tests bind the published hash, deterministic generation and verified retained receipt integrity; check physical pad completeness and manufacturer-derived core/flash/crystal/USB/reset mappings; reject missing power/ground pads, catalog substitution, a core rail short, undersized bypass and missing ADC capability. These source tests do not establish physical behavior. Local `preflight.json` passes ERC and power, with unreviewed and thermal-assumption warnings. No native generation, layout, routing, toolchain installation or compilation was performed by this author.

Primary source records:

- Raspberry Pi hardware design guide, actual retained Release2 August2026 PDF: physical p7–14 reference circuits; p8 power/bypass, p9 flash/BOOTSEL, p10–11 oscillator/recommended crystal, p12 USB, p14 full minimal circuit. The raw receipt records its SHA and bytes.
- Raspberry Pi RP2040 datasheet, retained actual PDF: physical p12–14 pinout/functions; p152–153 bypass; p156–161 internal regulator; p615 power pads; p623–625 operating ranges/power. The 100mA core rating is distinct from the higher fault current limit.
- Abracon ABM8-272-T3 RevB retained PDF: physical p1 electrical and p2 mechanical pin map (manufacturer printed p4). Pins1/3 active, pins2/4 ground. Raw SHA and size are in `crystal.pdf.receipt.json`.
- Winbond manufacturer W25Q16JV RevH April2019 retained supplier-manual PDF: physical p6 SOIC8 pinmap, p8 functions, p58–60 operating/DC, p66 SOIC208mil, p72–73 ordering. Retrieval was through the actual exact-ID supplier manual response; its receipt retains the retrieval URL and raw hash. No guessed official download URL is treated as successful evidence.
- Existing primary AP2112 and ST USBLC6 source evidence was reused; the failed local ST PDF download is not represented as a retained raw PDF.
- Official tagged PlatformIO platform and board manifests are retained with receipts. Target is **`platformio/raspberrypi@1.20.0`, `board=pico`, `framework=arduino`**. This is Arduino-mbed. `installed-variant-check.json` records exact local framework source hashes establishing D0–D29→GP0–GP29, analog26–29 and empty variant initialization. `rpipico` is not the official platform board ID.

Operating conditions and unresolved qualification:

- Known 4.75–5.25V source able to deliver 1.5A is mandatory. Independent CC Rd does not detect advertised current and implements no PD. Motor consumption uses VBUS, bypassing the LDO.
- 3.3V output is author-derated to 150mA; direct IO/flash budget is 15mA typical/70mA peak plus 20/60mA modeled core load through the 1.1V regulator. Core rating is 100mA. These are bounded author estimates, not measured startup/transient/simultaneous-load or trace-current results. AP2112 thermal analysis assumes 25C ambient and 184C/W.
- GP20/21 optional I2C has **no onboard pullups**. External 3.3V pullups and explicitly configured MbedI2C/mbed I2C are required. Default `Wire` uses GP4/5. Bare-chip circuitry has no Pico LED, SMPS or VSYS divider.
- ADC ports conservatively limit external voltage to 3.234V, the modeled minimum ADC supply. ADC accuracy, bus capacitance, crystal startup/load tolerance, QSPI boot/signal integrity, USB differential impedance/return, EMI, ESD, physical bypass placement and motor noise/transients remain unqualified.
- Independent electrical review, actual native physical gates and sandbox firmware compile belong to subsequent coordinator/reviewer acceptance. No author self-promotion or hardware/manufacturing approval is recorded.
