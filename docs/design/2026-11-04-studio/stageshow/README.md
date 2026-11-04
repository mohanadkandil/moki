# Workshop Stageshow demos

Standalone React + Vite illustrations for the landing page. These do not change or call the real app. Brand tokens and type match the 4 November `/studio` direction; “Workshop” remains a working wordmark.

```sh
npm ci
npm run typecheck
npm run build
npm run dev                         # 127.0.0.1:5187
npm run preview -- --port 5188       # production build
```

- `/`: review host with Replay and Show still controls.
- `/?capture=hero`: animated 1040 × 700 hero; 358 × 800 compact composition.
- `/?capture=comparison`: 720 × 490 still; 358 × 740 compact composition.
- `/?capture=gold` and `/?capture=gold-still`: copied Stageshow starting examples, loaded separately.

Import `src/Hero.tsx` or `src/Comparison.tsx` into a future landing integration with their styles, curated `src/kit.ts`, kit dependencies, and `public/assets`. The host is only a local review surface. Prefer a lazy-loaded hero in a landing page because Three.js is substantial. `Hero` accepts `still` to show its completed poster. The Stage also honors reduced motion and visibility; the renderer avoids re-rendering unchanged poses.

The illustration has a 16–17 second loop, **not** a live build. The nine stages replay the recorded **24.03 s** focus-timer job: board and case geometry cached, firmware compiled fresh. Reused exports say Cached; other stage durations are rounded from that receipt. The **24 s** success pill carries the cache condition beside it. The comparison headlines the measured **~31 s uncached median**, with **19 s cached** beside it, precise benchmark medians below, the cache condition on the 24 s example, and separately labeled Studio cold runs of 32–40 s. The hero follows Studio’s routed copper trace and chapter pads, using Instrument Sans, Geist Mono for measured values, and copper #b84c15 / #f0813f on paper / dark. Source, scope and SHA-256 asset hashes are in `data-provenance.json`. Generated 3D models are CAD previews with approximate module bodies, not manufacturer CAD or physical proof.

## Rehearsal

The copied Stageshow kit and scripts retain their MIT license. Start the production preview, then:

```sh
export CHROME_PATH="$PWD/scripts/chrome-software"
node scripts/film.mjs 'http://127.0.0.1:5188/?capture=hero' --gate --sheet-scale 1 --count 7 --every 3000 --out ../evidence/design_stage/hero-loop-wide.png
node scripts/film.mjs 'http://127.0.0.1:5188/?capture=hero' --width 390 --gate --sheet-scale 1 --count 7 --every 3000 --out ../evidence/design_stage/hero-loop-mobile.png
node scripts/film.mjs 'http://127.0.0.1:5188/?capture=comparison' --still --gate --out ../evidence/design_stage/comparison-wide.png
node scripts/rehearse-fixed.mjs 1280
node scripts/rehearse-fixed.mjs 390
node scripts/smoke.mjs
```

`CHROME_BINARY` overrides the ARM headless binary used by `chrome-software`. The wrapper explicitly opts trusted local WebGL into SwiftShader. It is a capture environment setting, not a deployment flag.

Three narrow adaptations to the copied tooling are documented rather than hidden:

1. `film.mjs` releases the captured WebGL page before assembling its sheet and permits 120 seconds for sheet composition. `--sheet-scale 1` optionally writes a 1× contact sheet; original frame capture and checks retain their resolution and rules. This avoids software-GPU timeouts and memory pressure on the shared host.
2. `film-checks.mjs` recognizes the kit's own named `@layer stageshow` when bundled CSS loses its `/kit/` filename. Unlayered application overrides are still checked. `smoke.json` proves a deliberate geometry override remains detected.
3. `rehearse-fixed.mjs` supplements the live recorder with the kit's own virtual clock, recorder and geometry analyser at 60 fps. This covers the full loop plus the next start with no time gaps. It does not establish physical-device frame rate.

See `REHEARSAL.md` and `../reports/design_stage.md` for measured evidence, manual inspection, reviewer findings and remaining flags. No publishing or app integration is part of this delivery.
