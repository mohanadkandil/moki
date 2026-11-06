# Blue landing, projects and /studio/<id>, 6 Nov 2026

**Status: ready to restart. Nothing is committed.** The blue landing is back at the root, and it starts studio projects. The chat restores per project, there's no loading screen, and the Verifier writes to the maker. Typecheck passes, and the only failing test is chip_eda's (see Tests).

## What to restart

1. **Moki:** in `/home/sogo/design-skill-research/repos/moki`, run `npm run build`, then `systemctl --user restart moki.service`.
2. **Gateway:** run `systemctl --user restart sogo-apps.service`. `dist/server.mjs` is already rebuilt.

No unit file changes are needed. With `NODE_ENV=production`, projects go to `var/projects-app/`. Restart both: until the gateway restarts, it still redirects `/app/moki` to `/studio` and refuses the project API and the landing's images.

## What works

Measured in Chromium through the real built app, agent API, pipeline and live model, on an isolated preview. Gateway routes were checked with the real gateway code. Evidence: `evidence/flow.json`, `evidence/flow-tail.json`, `evidence/gateway.json`, `evidence/ui/`.

| Check | Result |
|---|---|
| Root shows the blue landing | Compared with `docs/media/landing.png` at 1440, 390 and the reference's size. Only the changes listed below differ |
| Composer submit | The studio frame appears at once with the brief as the first message, then `/studio/<id>` |
| Gallery "Make it your own" | Starts a studio project the same way |
| Your workshops list | Shows studio projects in the existing cards, and opens them with no loading screen |
| Verifier | Written message and "Looks right". No labels or "I can't check these" list |
| Reload with the question waiting | The message stays and "Looks right" still works |
| Reload mid-build | Keeps following, and says the agent stopped |
| Reload after a build | Same turns, title and job |
| Rename, then reload | Kept |
| Browser back | Returns to the blue landing |
| Plain `/studio` | Goes to the landing. `?mock=` and `?job=` links still open |
| Unknown id | Designed "Project not found" |
| Gateway: landing, project page, create, list, rename, 1 MB save, image, asset | Pass |
| Gateway: `DELETE`, `/workshop`, foreign Origin | Refused with 404, 404 and 403 |

The checks spent about $0.20 in live model calls this round. The headless browser sometimes lost the page on the phone's not-found step, so I reran that step on its own and it passed. Nothing suggests an app fault, but I didn't find the exact cause.

## What changed on the blue landing

Everything visual is as it was, apart from:
- **Effort picker:** "Your little invention workshop" is replaced by the picker in the same small type, beside the Ink mark. It fits at both widths.
- **Nav:** "Circuit preview" and "Studio", which aren't in the approved image, are gone. `/lab` still opens by URL.

Behaviour changes:
- **Reference image:** the "+" button stays, but the studio can't use an image yet, so choosing one says that plainly.
- **Old workshop flow:** it no longer starts from the landing. `/workshop/<id>` links still open on the dev server. The live link has never allowed them.
- **Path collision:** I kept `/api/projects`. On the dev server, requests from this app carry a header, and the old workshop keeps the same paths. Only the new API exists on the live link.

## Agent voice

- **Written by the Verifier,** and code still holds it to the data: every number a check holds must appear in the message, or it's sent back. Requirements stay stored as structured data underneath.
- **What can't be checked** stays stored with the turn and is never counted as a pass. A confirmed requirement that can't be checked still ends in one sentence: "Built, but not done", with the reason, because otherwise a device would read as done when it isn't.
- **Not in the job report yet:** the brief also asks for those wishes in the job's details, and that isn't built, so for now they appear nowhere a maker reads.
- **Clarifying questions:** the Verifier doesn't ask any today, so there was nothing to convert.
- **Before and after:** `evidence/ui/before/` and `evidence/ui/verifier-message-*.png`.

## Decisions to review

- **Chat is saved by the browser.** `PATCH /api/projects/:id` also accepts `{ state, baseRev }`, because cards are drawn in the browser and rule-based turns never reach the server. No new route.
- **Jobs carry no `projectId`.** That would mean changing `server/board-api.ts`, which chip_eda is editing. The agent API adds the builds its turns start, and saves add the rest.
- **Dev store path:** `var/studio-projects/`, because `/workshop` already uses `var/projects/`.
- **Titles** come from the brief by code, with no model call.

## Independent review

One read-only review ran before the landing correction, traced by reading. It found no way out of the store, past the gate or to an off-site redirect, and it found real status and data problems. Fixed:
- false "Built" from failed compiles, cases or unchecked DRC
- late saves overruling an agent's verdict
- stale tabs overwriting newer work (they now stop saving and say so)
- rule builds dropping requirements
- the question being used up by a busy server
- a message saying one number while checking another
- a reload pinning the previous build
- hostile DNS answers on datasheet fetches
- raw JSON for a project link to a stopped Moki

These fixes, the landing correction and the agent voice work have not had a second review.

**Still open:**
1. **Malformed ids:** `/studio/not-a-uuid` gets a plain 404 on the live link, because the brief allows only `/studio/<uuid>`.
2. **Reloading stops the agent.** The server stops spending when nobody is reading, so a reload mid-turn ends that turn. The chat and status say so, and a queued build carries on, but no Fixer runs on it.
3. **First save:** if the very first save fails and the maker reloads, the project starts again and spends again. It's rare, and a small amount.
4. **Hostile PDFs:** parsing runs in-process with no deadline. Only reachable with `MOKI_CHIP=on`.
5. **Sign-in:** logging in drops a link's query, so a signed-out `/studio?job=` link ends on the landing.
6. **Saved state:** artifact URLs from a saved chat reach `href` and `fetch` unvalidated. Only the signed-in owner can write them.
7. **Page close:** saves over 60 KB may lose the last moments if the page is closing. Leaving for the landing saves properly.

## Tests

- **Moki `npm test`: 647 of 648 pass.** The failure is `tests/blocks-sht40.test.ts` ("second address-0x44 sensor…"), in chip_eda's code.
- **`npm run typecheck`:** passes.
- **Gateway `npm test`:** 45 of 45 pass, and typecheck passes.
- The default test paths use no network and no paid calls.

## Files

**Moki:** `server/project-api.ts`, `src/agents/project-title.ts`, `web/src/landing/{routes,projectsApi,startProject}.ts`, `web/src/landing/{ProjectPage,StudioShell}.tsx`, `web/src/landing/landing.css`, `web/src/ComposerEffort.tsx`, tests, and changes to `web/src/App.tsx`, `web/src/RecentProjects.tsx`, `web/src/studio/{Studio.tsx,Chat.tsx,agentChat.ts,agentCards.tsx,agentPicker.tsx,agent.css}`, `server/agent-api.ts`, `vite.config.ts`, `package.json`, `src/agents/{verifier,roles,turn,datasheet,protocol}.ts`. The rejected `web/src/landing/Landing.tsx` is deleted.

**Gateway:** `/home/sogo/projects/sogo-apps/src/{moki,app}.ts`, `tests/run.ts`, `README.md`. `PROJECT.md` and `.sogo/project.json` are left for you.
