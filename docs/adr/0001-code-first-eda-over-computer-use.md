# ADR 0001: Code-first EDA instead of computer-use GUI agents

- **Status:** Accepted
- **Date:** 2026-11-06
- **Deciders:** Mohanad Kandil

## Context

Moki turns a maker's description into a working device: schematic, PCB, enclosure and firmware.

The first prototype used **computer use**. A model drove FreeCAD and KiCad in remote GUI desktops (Daytona), by taking screenshots and clicking. In practice:

- **Speed:** a simple timer took **more than one hour** end to end. This was observed by the owner across sprint runs. It was not captured as a timing file.
- **Cost:** high. Every step is a screenshot plus a vision-model call, and a desktop VM runs the whole time.
- **Reliability:** results depend on pixel-level UI state. They are hard to reproduce, cache or test.
- **Checking:** there are no machine-readable outputs to check between steps.

## Decision

Generate the hardware **as code**, with deterministic tools:

| Layer | Tool | Output |
|---|---|---|
| Electronics, schematic, PCB | tscircuit (TSX → circuit JSON), with pinned versions in an isolated Bun package `eda/` | schematic SVG, PCB, Gerbers, BOM, pick-and-place, GLB |
| Enclosure | build123d (Python) from `mech-handoff.json`; create-fdm-enclosure kept as a baseline | STEP, STL, assembly GLB |
| Firmware | PlatformIO project, compiled in a sandbox with no network | firmware zip plus a compile receipt |

**How each job runs:**
- Every job is a subprocess with a timeout and an environment allowlist.
- The cache key is the sha256 of the source plus the tool versions.
- Every stage records how long it took.

## Evidence (measured)

**Machine:** 8-core Neoverse-N1 (arm64), 16 GB, Bun 1.4.4. Source: `docs/engineering/2026-11-04-tscircuit/evidence/bench.json`. Each template ran 5 times cold, with caches bypassed, and 3 times with the EDA cache reused.

| Template | Cold p50 | Cold p95 | Cached p50 | Autoroute p50 | Firmware compile p50 |
|---|---|---|---|---|---|
| focus-timer | 31.2 s | 32.2 s | 19.0 s | 2.0 s | 18.0 s |
| light-lamp | 25.8 s | 27.4 s | 12.5 s | 1.4 s | 12.8 s |
| temp-monitor | 31.7 s | 34.0 s | 19.1 s | 1.6 s | 18.6 s |

**What every one of those runs produced:** a routed 2-layer board with 0 DRC errors, an enclosure, and compiled firmware.

**Chip-level boards** (real LCSC parts, native routing) take longer. Source: `docs/engineering/2026-11-06-chip-live/`.
- RP2040 plus DRV8833 motor controller: 160–389 s, depending on the plan.
- No-MCU discrete boards (night light, water-leak buzzer): about 15 s.

**Comparison:**
- The computer-use path took more than an hour for a simple timer. This is reported by the owner, not benchmarked here.
- The code-first path takes about 26–34 s cold, measured, for the same class of device. That is roughly **100× faster**, and every output is a file that code can check.

## Consequences

**Good:**
- **Faster and cheaper:** seconds instead of an hour, and no desktop VMs.
- **Reproducible and cacheable:** the same source gives the same board.
- **Checkable:** ERC, DRC, copper connectivity, SPICE and compile all run on real files, which made the gated agent pipeline in ADR 0002 possible.
- **Editable:** the schematic editor and the chat both edit one plan, and the artifacts are regenerated from it.

**Costs and risks:**
- **tscircuit changes fast.** We pin exact versions in `eda/` and keep a lockfile.
- **Native routing of dense chip-level boards is the weak spot.** Some plans fail DRC or time out, and the chip timeout is 10 minutes. This is tracked work.
- **Generated code runs on the host today.** It is a subprocess with an environment allowlist. Per-build micro-VMs (Fly.io Machines) are planned before multi-user use.
- **Nothing has been fabricated or powered yet.** All checks are software checks.

## Not chosen
- **Computer use with KiCad or FreeCAD:** too slow and costly, and not testable (see above).
- **KiCad scripting directly:** viable, but a heavier install. tscircuit gives React/TSX authoring, autorouting and viewers in one toolchain. Boards still export to KiCad (`kicad.zip`).
