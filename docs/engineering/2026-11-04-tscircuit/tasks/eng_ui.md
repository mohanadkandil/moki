# eng_ui: the Board studio inside /lab

Read first: ../BRIEF.md (the API contract). Then:
- /home/sogo/sogo/skills/product-design/SKILL.md and its references/taste.json. Reread them; the taste profile is current.
- web/src/circuit/CircuitLab.tsx, circuit-lab.css and Viewport.tsx (current lab language)
- web/src/App.tsx (how /lab mounts)

Brand/name selection is still pending with the owner. Stay inside the lab's existing visual language. Don't introduce a new identity.

## Allowed write paths
- web/src/board/**
- web/src/circuit/CircuitLab.tsx: only a minimal mount point/button "Build board" plus passing the current design. Keep the existing behavior.
- docs/engineering/2026-11-04-tscircuit/{evidence/eng_ui,reports/eng_ui.md}

Don't touch server/ or src/. Until eng_core's API is live, code against the BRIEF contract with a tiny local mock in web/src/board/mock.ts, used only when `?mock=board`.

## Deliver
- **Build board** in the lab. It posts the current design, polls the job, and shows a stage-by-stage progress list using the real stage names and ms as they arrive.
- **Board studio** tabs:
  - **Schematic**: the SVG with pan/zoom.
  - **PCB**: the SVG with pan/zoom; layer toggle if cheap.
  - **3D**: three.js GLTFLoader (three is already a dependency) for board.glb with orbit controls, plus an "In enclosure" toggle that loads assembly.glb.
  - **Enclosure**: dimensions and openings from enclosure.json, plus STL downloads.
  - **Firmware**: pins.h and main.cpp viewers, plus the compile status badge (compiled / not compiled + reason).
  - **Code**: board.tsx in an editable textarea or lightweight editor (no heavy new deps without a reason). "Re-render" posts `{source, baseJobId}`. Show DRC errors inline.
  - **Files**: every artifact with its size and download link.
- **Timing strip**: per-stage ms bars, the total and cache hit/miss. This is the visible proof for the coming ADR; make it legible, not decorative.
- **Honest states:**
  - DRC errors are shown, not hidden;
  - a failed job shows the error;
  - skipped stages show their reason;
  - labels distinguish "generated", "checked by DRC" and "not physically tested".
- **Responsive:** desktop and mobile (390 px) usable.

## Acceptance
- `npm run typecheck` and `npm run build` pass.
- Rendered screenshots (desktop 1440 and mobile 390) of each tab against the **real** API once eng_core has it running (`npm run dev` on 127.0.0.1:5173; check whether that port is already in use first). If it's not running yet, use the mock, clearly labeled.
- Put them in evidence/eng_ui/ and inspect them yourself.
- Report in reports/eng_ui.md.
