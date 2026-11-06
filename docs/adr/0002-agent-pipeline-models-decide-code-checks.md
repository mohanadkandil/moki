# ADR 0002: Agent pipeline where models decide and code builds and checks

- **Status:** Accepted
- **Date:** 2026-11-06
- **Deciders:** Mohanad Kandil

## Context

The chat has to turn a vague idea ("a reaction-time game", "an RP2040 motor controller") into a board, a case and firmware. One model writing everything at once can't be checked, and its mistakes look as confident as its successes.

## Decision

Use a **pipeline of narrow agents around one shared plan, with code gates between them.** We don't use a free-form multi-agent chat.

```
Verifier → (maker confirms) → Designer [+ Block Author] → gates → Reviewer → Firmware → build → Fixer (bounded)
```

| Agent | Job |
|---|---|
| **Verifier** | Turns the request into checkable requirements before any design, and asks clarifying questions when the request is vague. It decides whether the idea needs a microcontroller at all, and whether the module kit or a chip-level board fits. |
| **Designer** | Writes a structured plan, not free code: kit modules, or reusable chip-level blocks built from real LCSC parts. |
| **Block Author** | When the library lacks a block, finds a real part, reads its datasheet and writes one. The block is labelled *unreviewed* until an independent review promotes it, bound to a content hash. |
| **Reviewer** | A separate model checks the schematic against datasheets. Every citation is verified by code against the page text. |
| **Firmware** | Writes the app and compiles it in a sandbox with no network, with up to 3 tries. |
| **Fixer** | Bounded: at most 2 retries. It may not change the layer count for clearance errors, or repeat a change that made errors go up. |
| **Editor and Explainer** | Edit the plan, and explain it. |

**Rules:**
- **Code owns everything measurable:**
  - board size, computed from part envelopes;
  - placement legality;
  - the gates: ERC, requirements, SPICE, review, DRC, compile;
  - prices and budget caps: $2 per turn.
- **The plan is the single source of truth.** PCB, case and firmware are regenerated from it.
- **Model output is data, never instructions.** Datasheet text is untrusted.

## Evidence (measured)

**Kit bench.** OpenAI `gpt-6.1-sol`, live, 11 briefs. Source: `docs/engineering/2026-11-04-agents/evidence/agent-bench.json`.
- All 11 behaved as expected: 6 built with 0 DRC errors and compiled firmware, and 5 declined correctly as out of scope.
- **Total model cost: $0.103.** A successful build cost $0.010–0.016, with 9.8–12.2 s of agent time.

**Chip-level live runs.** Source: `docs/engineering/2026-11-06-chip-live/evidence/chip-live-bench.json`.
- 12 runs, $6.00 in total; a run that reached review cost $0.50–0.90 and took 4–11 minutes.
- They found real bugs, each fixed with a test:
  - a price-table error that hit the budget cap early;
  - datasheet fetches returning 403;
  - the Reviewer silently truncating large blocks;
  - a crash on a `"180deg"` rotation;
  - a routing timeout;
  - the model guessing a board too small for its parts;
  - the Fixer making things worse by switching layers.
- **Not yet accepted:** no chip-level brief has built end to end live. The exact live RP2040 plan passes all 8 gates offline, with 0 DRC errors and compiled firmware (job `3eb2b76f`). Routing for other plans is still being hardened.

**Replays.** These separate model mistakes from pipeline bugs: model calls are scripted, and everything else is real.
- The reaction game built on the kit: 0 DRC errors, compiled, 37 s.
- No-MCU boards built with no firmware stage: a night light at 20 × 42 mm and a water buzzer at 28 × 56 mm.

**Tests:** about 1,270, most of them added after a real failure.

## Consequences

**Good:**
- Each failure points to one stage.
- Costs are small and capped.
- Outputs are checked, not trusted.
- Reviewed blocks and parsed datasheets are reused across projects, so cost falls as the library grows.

**Costs and risks:**
- More code to maintain than a single prompt.
- Chip-level routing remains the bottleneck: CPU-bound, up to about 6 minutes.
- No hardware has been fabricated or flashed. Blocks stay *unreviewed* until promoted.

## References
- Anthropic, *Building effective agents*, and its multi-agent research system.
- OpenAI, *A practical guide to building agents*: manager versus handoffs.
- Cognition, *Don't build multi-agents*. This informed choosing one shared plan over agents chatting with each other.
