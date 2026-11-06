# Project gallery: "Your workshops" (report, schem_ui)

## What changed
The section under the landing now leads with the newest project that has a build to look at, shown as a real render of that build with its facts beside it. The other projects sit in a calm grid below.

| Project state | Picture | Under the title |
|---|---|---|
| A build worked | Render of that job's `assembly.glb` (lid off) or `board.glb`, on the studio's graphite stage | Board size, parts, compiled |
| Latest build failed, an earlier one worked | The earlier render, captioned "From an earlier build that worked" | Facts of the pictured build only |
| Design saved, no working build | The project's real schematic, from the same layout code as the Schematic tab | The agent's last sentence, else the brief |
| Nothing drawn yet | A blank drawing sheet with one wire that shows the state | The agent's last sentence, else the brief |

Status words are now Built, Needs your answer, Didn't build, Stopped, Building and Draft.

The wire on a blank sheet uses schematic symbols:
- Needs your answer: two open terminals.
- Stopped: an open switch.
- Didn't build: a no-connect.
- Building: a pulse travelling along the wire.
- Draft: a net just begun.

Other details:
- **Repeated titles:** they keep the title and add when each began, for example "RP2040 motor controller 6 Nov, 00:48".
- **Briefs:** paste gutters and hard wraps are cleaned for display. A brief that only repeats the title isn't shown.
- **"Built, not checked":** this is now plain "Built", with a fact row "Your brief: Not checked on this build yet". The caveat stays, because it is true and it matters.
- **Filter:** I left it out. Six projects don't need one.

## Direction
I rendered two stills with the real images and real text:
- `evidence/01-direction-a-lead-and-sheets.png`: a lead card and grid on warm paper.
- `evidence/02-direction-b-dark-bench.png`: the whole section on graphite, with captions over the pictures.

I picked A. It keeps the landing's paper, so the graphite photos are the one dark thing on the page. B makes the section a dark slab that breaks from the landing, and its captions sit on top of the hardware.

Both stills predate the coordinator's review. Their agent text on the sheets was removed in the build, so only the final shots show the agreed cards.

## Coordinator's review, applied
- Unbuilt cards no longer put the agent's message in large type on the picture.
- The picture area is now the schematic if parts exist, otherwise the wire state above.
- The agent's last line is one quiet sentence below the title, cut at the first sentence or semicolon.
- "Built, not checked" became "Built" plus the fact row.

## The picture
**Rendered once on the server, as you preferred.** `server/thumbnail.ts` is a small software renderer with no new dependency. The server has no GPU and no browser, and Playwright isn't a production dependency. It reads the GLB, draws with a z-buffer, shadow map, contact shadow and screen-space occlusion, and writes a 1280 × 800 PNG. It uses the studio's lens, tone mapping and stage colours. The camera sits a little higher than the 3D tab's ¾ view, so the case walls don't hide the board.

Measured on this ARM server:
- About 8 s per picture, in its own bun process.
- About 405 to 410 KB per PNG.

**When it runs:**
- When a build ends, in the background, so it doesn't delay the job.
- For older builds, on the first request for the picture.
- One at a time. A model that won't draw leaves `thumb.log` and isn't retried.

**How it's served:** `GET /api/board/jobs/<id>/files/thumb.png`.
- It is one fixed name, handled apart from `BOARD_ARTIFACT_NAMES`, so it stays out of Downloads, the zip, receipts and `job.json`.
- It has the same path checks and security headers as other artifacts, and is marked immutable because a job id never changes build.
- The gateway needs no change: its `/files/<name>` pattern already allows the route. I read that code; I did not run through the gateway.

**Files outside the brief's listed paths:**
- `server/thumbnail.ts` is new, because the renderer had to live somewhere and `src/board/**` belongs to agent_core.
- `/api/projects` summaries gained `jobIds` and `card`, computed in `server/project-api.ts`. That is more than the "one narrow artifact addition": the list needed the agent's last line, part count, cost, and the design for the schematic.

## Evidence
Real projects, from a scratch copy of `var/projects-app` and their jobs, through `vite preview` on a spare port:
- `00-before-{1440,390}.png`: the before state.
- `10-after-{1440,1280,390}.png`: the section at each width.
- `11-landing-unchanged-1440.png`: the blue landing above it.
- `12-in-window-1440.png`, `15-in-window-390.png`: the section as it sits in the window.
- `13-lead-hover-1440.png`: hover lift and picture zoom.
- `14-card-keyboard-focus-1440.png`: keyboard focus ring. Enter opened that project's studio.

Measured in those runs:
- No horizontal scroll at any width.
- No card body overflows.
- Smallest text is 12 px.
- No console errors.
- Reduced motion removes the hover movement.

I used a copy because a second server can't claim the live jobs root, and it means nothing was written to real job folders.

States the real projects don't reach, from fixtures made by copying real designs and builds (their titles say FIXTURE):
- `20-FIXTURE-states-{1440,390}.png`: failed build with an earlier good one, design with no build, design with a failed build, and a draft.
- `21-FIXTURE-building-card.png`: the Building state. The job's response was stubbed as running, because the server marks an orphaned running job as failed.

I did not shoot a real project in the Building state, or any project with a chip-level build. Their wording and facts are covered by unit tests only.

A fresh real build through the service, on a scratch job root (`evidence/30-thumb-from-fresh-real-build.png`): the job finished in 29.0 s, and its picture was written 7.0 s after that, 416 KB. The job's artifact list stayed free of it.

## Checks
- `npm run typecheck`: clean.
- `vite build` with a scratch `--outDir`: passes.
- `npm test`: 1255 pass, 2 fail, 1 skipped, of 1258. Neither failure is in code this work touched:
  - `real maker edits reroute...` failed with "Another board service owns this job root": another agent's process held `var/board-jobs-test-maker`. It passed when I reran it alone, with the thumbnail hook in the build path.
  - `generated design centres match actual circuit centres` fails on `BZ1`, including when run alone. It tests `src/board/edits.ts` against `tests/agent-fixtures/`, which agent_core's area changed at 10:45 and 10:30 today. The test imports none of my files. I left it for agent_core.

## Bug found by the fixtures
The first design-without-build card crashed the whole landing into the app's error page, because the card's slim design lacks `notes`. It now passes empty notes, and a design that can't be drawn falls back to the blank sheet. Both have tests. Real projects would have hit this as soon as one had a design and no build.

## Hand-offs
- **Deploy:** rebuild and restart `moki.service`. I restarted nothing.
- **Build check:** I ran `vite build` with a scratch `--outDir`, not `npm run build`, because `npm run build` overwrites the `dist` that production is serving. It is the same command otherwise.
- **First view after deploy:** the two built projects show an empty graphite stage for about 8 s and 16 s while their pictures are drawn. To skip that, run `bun server/thumbnail.ts var/board-jobs-app/<jobId>` for `89939905-cc57-4239-bdc7-1c82fb38a1d2` and `4bfc2598-b96d-4725-b4b5-bfbde489b66f` first.
- **Backlog risk:** the gateway's proxy timeout is 30 s. If many old builds were first viewed at once, a queued picture could time out and that card would show its fallback until the next load. With today's two builds it can't happen.
- **Old wording in data:** `ea1f01b8`'s refusal says chip-level mode "isn't on here yet". That is the saved message, shown as written, up to the semicolon.
- **Worth a look:** the Tiny weather oracle's latest build is the schematic edit "U1.5V joins +3V3", which joins the ESP32's 5 V pin to the 3.3 V rail. It built and is now the lead card; nothing has checked it against the brief. I didn't change it.
- **Taste:** you are the preference writer. The review above would fit as a Moki project entry: unbuilt cards show a calm picture with the title and one quiet sentence, never agent prose on the image.
