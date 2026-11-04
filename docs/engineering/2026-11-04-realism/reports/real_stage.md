# real_stage: the whole right panel of /studio

4 November 2026. Scope grew during the round, from the 3D stage to the full canvas side. No commits, pushes, stashes or resets. I never rebuilt or restarted production. `dist/web/index.html` is now dated 20:41, which is before the tab-row change and not my build, and it doesn't contain the new tab row. `moki.service` is active.

## Result

The right panel now reads as the same product as the chat. The 3D tab shows real parts on a lit stage, thanks to real_models' models and board textures.

**Start here:**
- `evidence/real_stage/contact-before-after-1440.png`: all six tabs plus empty, loading, failed and in-flight
- `evidence/real_stage/temp-monitor-before-after-owner-angle.png`: the owner's screenshot against the same board now
- `evidence/real_stage/side-by-side-target.png`: against the target reference

## The design: paper on the bench

**The rule.** The chat is a sheet of paper lying on a warm graphite workbench. Anything you read on the bench is that same paper. Anything you look at sits on graphite. This extends a split the CSS already named ("where you read", "where you look"), so the canvas stayed dark as the brief asked.

**How the two halves meet:**
| Device | What it does |
|---|---|
| Shadow at the seam | The chat casts a soft shadow on the bench |
| Tool dock | The composer's sibling: same raised paper, on the same baseline at the foot of its side |
| Tokens | The dark scale moved from cool to warm graphite. Same Instrument Sans and type sizes as the chat's step rows. |

**By area:**
- **Top bar:** plain tabs lead (see "Tab row, after owner feedback" below). The proof line is quiet text with no pill. History and re-run are ghost icons. Download is the only filled control, cut from the chat's paper.
- **Dock:** replaces the separate floating view switcher and rail on Schematic, PCB, 3D and Case. Its place never changes.
- **Status strip:** label and value cells, as a readout. DRC is green only with zero errors **and** zero warnings, matching the rule in `facts.ts`. My first pass painted 19 warnings green; that's fixed.
- **Schematic:** a sheet at the drawing's own proportions, with a drawing frame, a title block (title, board, build, date, sheet) and a zoom readout.
- **PCB:** tscircuit's viewer on our ground, with a Top copper / Bottom choice in the dock and its toolbar in our tokens. This also fixes an existing bug: the layer buttons did nothing, because the viewer's hotkeys only listen while the pointer is over it, and here the pointer is on the button. The layer is now set by remounting the viewer, so **switching layer resets PCB zoom and pan**.
- **3D:** see below.
- **Case:** a paper spec sheet beside the model, with a true-proportion size plan, openings and printing. The model is framed in the space the sheet leaves.
- **Firmware:** a code pane with a file header, line count and compile badge, plus a paper compile receipt.
- **Code:** the same file header, with a Rendered or Edited badge.
- **States:** each tab has its own faint line art. A live trace runs in copper while waiting or loading, and in the error colour on failure ("The build stopped before the PCB. The error is in the chat.").

## Tab row, after owner feedback

The owner disliked the copper line with a dot under every tab ("this bar of checkpoints"), so it's gone, along with the via at the seam. The chat's own trace stays. The contact sheets above still show the old rail; `evidence/real_stage/tabs/` shows the current row.

| State | What the tabs do |
|---|---|
| Idle or finished | No status at all. The active tab is white with a 2px copper underline on the bar's bottom border; the others are muted. |
| Building | A tab whose output isn't ready is dimmed with a slow shimmer, and turns normal when the output lands. The active tab stays white, because the pane below already shows it's loading. |
| Failed | A small red dot on the failed stage's tab only. If the worker died without reporting, it's the first stage with no report. |
| Any job running | A 2px copper line moves along the top edge of the right panel, then disappears. |

- **Shimmer, not spinner:** a spinner would add width, so the tabs would shift as outputs landed. Measured movement when an output landed: 0 px. The row also still fits at 390 with no scrolling.
- **Until the first output lands,** the canvas keeps showing the previous build (existing behaviour), so the tabs stay plain and only the top line says a build is running.
- **Lost runs:** if polling is lost, the shimmer stops, so tabs don't claim outputs are still coming.
- **Reduced motion:** driven and checked here. The shimmer becomes a static dim and the top line a static 60% line.
- **Chat steps switch tabs: this is new.** The brief said "still", but step rows only expanded their details. Stage rows and folded chapter heads now do both, and a step from an older build also brings that build onto the canvas. Fabrication and the Board chapter go to PCB. Chapter heads aren't clickable while a build runs, but their rows are. On a phone, a tap selects the tab without leaving the chat; "View the board" then opens it.
- **Evidence limits:** mid-build and the Case failure are simulated by rewriting job JSON in the test browser. The Schematic failure is a real failed job (`4d1f69f5`).

## Review fixes: P2-3 and P2-4

- **P2-3, failed source labelled Rendered:** the Code badge now comes from the job's own result: Rendered, Rendering, Render failed, Not rendered or Source saved. Real failed job `4d1f69f5` now shows a red Render failed badge in the browser (`evidence/real_stage/code-failed-source-1440.png`). Clean text from another job can't borrow a badge, because the editor shows loading until it has this job's source. Revert now goes to the source of the job on screen, and edits carried over from another build say so.
- **P2-4, Re-run could submit another revision:** a re-run now finds the session revision whose content ID matches the job. In the browser with job creation mocked, I built 25 then 45 minutes, showed the 25 minute run and re-ran it: the request carried `484fd6e8aeec4d7f`, the 25 minute design. A history job this session doesn't hold falls back to its source, and the label says firmware is skipped. A failed source fetch now reports an error instead of submitting the error page as source.
- **Still inaccurate:** a source re-run of an unedited design is still titled "Edited board" and "Edited TSX" in the chat header and history. The job doesn't record why it's a source job. I changed the step and summary text to "TSX source", but `Chat.tsx` and those names need a job-level fact to be right.
- **Test limit:** there's no DOM test runner here, so the regression renders the badge alone with `renderToStaticMarkup`; the whole Code tab was only checked in the browser.

## The 3D stage

- **Lighting:** `RoomEnvironment` through PMREM with no network HDRIs, ACES tone mapping, and a soft spot key with shadows.
- **Key light position:** my first placement hid the shadows at some orbit angles, and my second washed the mask to grey because it sat 11° off the mirror angle. It now sits about 45° off.
- **Contact shadows:** two baked ones, on the floor and on the board. The board one does the job of ambient occlusion for one small render, instead of a screen-space pass.
- **Backdrop:** a lit floor that fades into the backdrop, with no horizon line.
- **Framing:** a ¾ hero from the board's front edge, so silkscreen reads the right way up. Fit projects the object's corners to fill 70% of the canvas on load, on view change and on resize (until you orbit).
- **Grid:** appears only while orbiting, at low contrast. It can be pinned from the dock.
- **Hover:** `U1 · ESP32-DevKitC V4` in copper with a faint tint, and tap on touch. A closed lid blocks it. Part names come from `userData.name`, because GLTFLoader strips `:` from `node.name`.
- **Case material:** matte PLA with a slight sheen. The lid can be solid, see-through or off.
- **Mask picker:** green, black, blue and white, using real_models' contract. Variants load on first use, so the green board costs nothing extra.
- **Performance measures:** the shadow map redraws only when the model moves, never on orbit. Hover tests boxes, not triangles. Pixel ratio is capped and drops once if orbit runs slow. The grid shader compiles at load.

## Against the owner's live screenshot (temp-monitor)

| Owner's item | Now | Whose |
|---|---|---|
| Flat black void | Warm graphite lit stage | real_stage |
| Small object | Fills about 70% of the canvas | real_stage |
| Bright grid | Hidden at rest, faint while orbiting | real_stage |
| Floating piezo | Seated on the board | real_models |
| DS18B20 with no model | Modelled | real_models |
| Grey blocks | Real parts | real_models |
| Oversized board | 75 × 75 mm, was 90 × 95 | real_models |

The final tests for the real_models rows are in `reports/real_models.md`. I only confirmed them by eye on job `b59461c0`.

## How close to the target reference

**Close:** the lighting, the finish, and each part reading as the real object.

**Not close, and it won't be:**
- **Density.** The target is a chip-level board. Ours is a module carrier with empty mask between parts. That's the framing in the brief, and it's the biggest visible difference.
- **Metal.** The target's USB shells and ENIG rings look more like real metal. Our mask is a single material, so gold pads and copper don't shine independently of it.
- **Part shape.** Some of our parts look more faceted, and the tall black sockets read as heavy blocks.
- **Backdrop.** The target is on white. Ours is deliberately graphite.

## Acceptance

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run build` equivalent | Pass, built to a scratch folder with `--outDir` so `dist/web` stayed untouched |
| Studio and board web tests | 38/38 pass, including new ones for part names, exploded lifts, the KiCad label and tab status |
| Full `npm test` | **Not run by me.** real_models runs it. My code changes are in the web UI only. |
| Screenshots | All six tabs at 1440, 1280 and 390, inspected. Empty at 1440 and 1280; failed, loading and in-flight at 1440 and 390. |
| Controls driven in a browser | Hover labels on four temp-monitor parts, mask picker, lid, exploded, PCB layer switch, PCB zoom (the picture changes), schematic zoom and fit, arrow keys on tabs, Tab through the dock. No page errors in the final control runs. |

## Not verified, and known limits

1. **"No frame hitches on orbit" is unproven.** This machine has only software GL (SwiftShader), and it's shared and low on memory. Orbit measured a median of 117 ms at 390 and 317 ms at 1440, with spikes up to 3.4 s (`evidence/real_stage/orbit-timing-swiftshader.txt`). That is not what a GPU would show, but I have no GPU reading. **The owner should orbit it on a phone and a laptop.** The board is about 19k triangles and the assembly about 38k.
2. **No physical device was used.** The 390 shots are simulated viewports.
3. **PCB colours are only partly themed.** tscircuit has no public colour setting. A CSS filter turns its red to copper, but the plated pads stay magenta. The filter and the toolbar restyle depend on the viewer's inline styles, so a viewer upgrade could break them.
4. **"Open in KiCad" downloads `kicad.zip`.** It doesn't launch KiCad. Whether KiCad opens the file is real_models' finding, so check their report before the label ships. `/studio` has no Files tab, so there it's an action at the top of Download. The `/lab` Files panel lists it too (`web/src/board/panels.tsx`, outside my listed paths, as you asked).
5. **Part labels can't be reached by keyboard.** Hover and tap work; the dock and tabs are keyboard reachable, but individual parts aren't. Screen readers get the label only once a part is picked.
6. **The black mask still reads dark olive, not black,** on job `b59461c0` (`after/after-3d-mask-black-1440.png`). real_models has since darkened the colour in `render-board.ts`; I can't tell from this job whether that's in it, so re-check on the next build. Blue and white look right.
7. **Reduced motion:** used for the owner-angle shot, but its effect on the grid and pad animations wasn't separately checked.
8. **Older jobs:** they still load, but their parts are the old grey blocks, and hover shows only the refdes on `board.glb`.

## How the before shots were made

The production API correctly requires the owner's capability, and I didn't look for it. I loaded the fixed production UI bundle in my test browser and redirected its API GETs to the dev server, using pre-realism jobs. So the UI is truly the old one, on older dev jobs. There's no before for the in-flight state. The owner's own screenshot is the before for temp-monitor at his angle.

The after shots use dev jobs `b59461c0` (3D and Case at all widths) and `80ec2a32` (the other tabs), both temp-monitor. Failed uses `4d1f69f5`. In-flight is simulated by rewriting one job's JSON in the test browser.

## For the coordinator

- **Files changed:** `web/src/studio/{ModelPane,Canvas,CaseTab,FirmwareTab,CodeTab,DrawingPane,PcbPane,PaneState,Rail,Studio}.tsx`, `Chat.tsx`, `facts.ts`, `studio.css`, `studio.test.ts`; new `parts.ts`, `stageScene.ts`, `PaneArt.tsx`; one line in `web/src/board/panels.tsx`.
- **Needs a production rebuild** after acceptance. I didn't do it.
- **Handoff:** the paper-on-the-bench rule above should go into `PROJECT.md`, which you own.
- **Taste profile:** not touched, since the coordinator is the preference writer. The owner hasn't seen this yet, so nothing here counts as approved.
