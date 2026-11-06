# DC motor block evidence — 6 November 2026

`dc-motor-drv8833@1` is an **unreviewed data-only circuit**. The generated bundle is `src/blocks/data/motor-drafts.json`; its exact catalog responses and importer responses are bundled as immutable receipts for offline replay. No native render, routing, firmware compile, assembled motor test or manufacturing qualification was run by this author.

The actual search selected **TI DRV8833PWPR / C50506**, HTSSOP PWP16 with exposed pad, 0.65 mm pitch. The search reported24,969 in stock at capture; stock is historical evidence, not a purchasing guarantee. The importer display title is `DRV8833PWP`, while its exact supplier/manufacturer field says `DRV8833PWPR`. Root added a narrow audited exception bound to C50506, the actual component UUID45436c08a4eb421789f0595cfd35863a, exact package UUID558b71b9c87a4a7fb849ca445194ba81 and supplier field. The bundle preserves `DRV8833PWPR` as the MPN. It does not generically strip reel suffixes.

Source attribution for the retained imported symbols/footprints: **JLCEDA/EasyEDA Official Library**, [JLCEDA](https://lceda.cn/) and [EasyEDA](https://easyeda.com). Raw source/license fields are retained. No downloaded or imported3D model is claimed.

The authoritative circuit reference is [TI DRV8833 SLVSAR1E](https://www.ti.com/lit/ds/symlink/drv8833.pdf), retained as `drv8833-ti.pdf`, SHA256 `3e400e333f08f1b93ec99a2d52a6af2a864e88462cc892282208548d9e9f0de4`. The main document is RevE; its orderable-package addendum is dated17July2026. Pin facts use the **HTSSOP/TSSOP column**, not the different WQFN numbering. The importer matches all17 declared contacts:

| Physical pad | Signal | Treatment |
| --- | --- | --- |
| 1 | nSLEEP | 47kOhm pull-up toVM; fixed enabled |
| 2,4 | AOUT1,AOUT2 | Separate motor terminals atJ1 pads1,2 |
| 3 | AISEN | 0.51Ohm sense resistor toGND |
| 5,7 | BOUT2,BOUT1 | Unused outputs, unconnected |
| 6 | BISEN | Grounded unused bridge sense return |
| 8 | nFAULT | Open drain, unused and unconnected |
| 9,10 | BIN1,BIN2 | Grounded: unused bridge coasts |
| 11 | VCP | 10nF X7R capacitor toVM |
| 12 | VM | Qualified4.75–5.25V input |
| 13,17 | GND,PowerPAD | Both grounded; native thermal realization pending |
| 14 | VINT | 2.2uF internal-bias bypass toGND; no external rail/load |
| 15,16 | AIN2,AIN1 | Exported IN2/IN1,3.3V logic interface |

TI pp3–4 specify the pins and external capacitor connections. Pages5–7 give operating domains, input thresholds, supply current and sense threshold. Pages9–11 describe bridge truth states, PWM, chopping and sleep. Pages14–16 cover bulk capacitance, local layout and thermal limitations. In particular, VCP's capacitor connects **toVM**, not ground. VINT is a bypass-only terminal, not a made-up rated supply output. Generic ERC therefore models VINT as a passive bypass terminal and VCP as bidirectional; the separate reference gate checks their exact capacitor topology.

The placed circuit uses nine parts with eight distinct real catalog identities:

| Part | Actual LCSC / MPN | Selected purpose |
| --- | --- | --- |
| U1 | C50506 / DRV8833PWPR | Driver |
| C1 | C1589 / CL10B103KB8NNNC | 10nF50V X7R charge-pump capacitor |
| C2 | C23630 / CL10A225KO8NNNC | 2.2uF16V X5R internal-bias bypass |
| C3,C4 | C162430 / GRM21BZ71C106KE15L | Two10uF16V X7R VM ceramics |
| C5 | C134850 / OCR470M1CBK-0605 | 47uF16V polarized polymer bulk |
| R1 | C25819 / 0603WAF4702T5E | 47kOhm1% nSLEEP pull-up |
| R2 | C34068 / 1206W4F510LT5E | 0.51Ohm1%,250mW1206 current sense |
| J1 | C160352 / B2B-PH-SM4-TB(LF)(SN) | PH2mm motor contacts1,2; mechanicaltabs3,4 unconnected |

The C5 importer symbol has its plus marking on physical pad1. Its supplier description lists1.65A@100kHz ripple, but a manufacturer PDF could not be retained: the catalog URL returnedHTML and official catalog/item-list URLs returned404. The failedHTML is explicitly named `lelon-ocr-catalog.failed.html`; it is not represented as a PDF. C5 ESR/ripple limits, polarity and dimensions still require independent manufacturer/assembly review. Nominal capacitor values do not prove effective DC-biased capacitance. The2x10uF ceramics give nominal margin over TI's10uF recommendation; the47uF bulk is an author starting value, not a proven USB transient or regenerative-energy solution.

Only bridgeA is used. TI's sense threshold160–240mV and0.51Ohm±1% give a **25°C nominal-tolerance screening interval310.62–475.34mA**, with392.16mA typical. The3.75us blanking interval, resistor800ppm/°C TCR, winding inductance and dynamic conditions prevent claiming a hard500mA limit. At500mA, nominal-tolerance resistor dissipation is about0.1288W before temperature derating. No final thermal/current rating is claimed from the IC's package headline rating.

The VM sink reserves **205mA typical /505mA peak**: author-assumed200/500mA motor envelope plus5mA driver/bias margin. A real5V motor has not been selected. Startup, locked-rotor current, inductance, speed/reverse duty and braking must fit that declared contract or the block must be revised. Bulk capacitance and TI protection features do not turn the reservation into a guaranteed USB current limiter. The board must have a known1.5A4.75–5.25V source; an arbitrary USB host does not imply that permission. RP2040 VBUS feedsVM directly, with shared ground; motor current never goes through the3.3V LDO.

Ports are exactly `VM`, `GND`, `IN1`, `IN2`. Actual RP2040 integration links `rp.VBUS→motor.VM`, `rp.GND→motor.GND`, `rp.MOTOR_IN1→motor.IN1`, `rp.MOTOR_IN2→motor.IN2`. Its actual MCU facts map GP14/GP15 with PWM/output capability. The generic Port schema has no PWM-requirement field; this requirement is explicit in usage and independently asserted in the actual integration test. Arduino core `digitalWrite`/`analogWrite` need no third-party library. Default both inputsLOW gives coast; initialization waits beyond wake-up time. Firmware, EMI, motor stall, regeneration, heatsinking, supply droop and manufacturing fit remain unverified.

Measured focused acceptance:9/9 motor tests pass including the actual authored RP2040 bundle, catalog-response replay, physical pin-map/value mutants, reference-net faults, missing bypass, NC connection, unknown pinout, over-budget load, disconnected ground, incompatible supply and MCU output-capability faults. Combined motor/catalog/ERC/S3/review run:73/73 pass,0skips,650.54ms; output is `focused-tests.tap`. Targeted strict TypeScript passes. All generated motor ERC, power and reference gates pass; its review status remains unreviewed. Root independently owns publication/integration and any later native builds.
