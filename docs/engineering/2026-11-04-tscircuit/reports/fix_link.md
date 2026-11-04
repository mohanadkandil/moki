# fix_link — private Sogo Apps delivery

**4 November 2026. Implemented and verified; Moki registered but stopped.**

Private entry: **https://<private-tunnel>.trycloudflare.com/app/moki**

The current origin comes from `~/.local/share/sogo-apps/preview.json`. This temporary tunnel can change. The entry requires the existing Sogo Apps owner login. No new password or secret is required from the browser.

## Changes and review findings

- **P1-1, REVIEW link conditions 1–2:** Moki is registered in `/home/sogo/projects/sogo-apps` at fixed upstream `127.0.0.1:8847`. `vite.config.ts` defaults builds and previews to `/app/moki/`, while development stays at `/`. The production preview uses an exact hostname list; its explicit guard also rejects unknown Host headers for redirects. Prefixed board URLs are normalized before the existing board plugin's `configurePreviewServer` handler. Both app-root forms redirect to Studio; Lab HTML is allowed.
- **REVIEW condition 1, source/workshop exposure:** production preview and gateway allow only Studio/Lab HTML, favicon, built assets and board jobs/artifacts. `/@fs`, HMR, source paths, studies, architecture documents and workshop APIs are refused. The existing development server is unchanged and is never the app upstream.
- **P0-1 coordination / link condition 3:** gateway injects `X-Moki-Capability` from an owner-only file, overwriting any browser-supplied value. `fix_core` supplied the API-side `MOKI_BOARD_API_TOKEN` gate, which the actual-preview check exercised. Capability generation/staging uses 0600 files in owner-only directories; reads reject symlinks and unsafe permissions. The browser never receives the capability. Worker environment allowlisting remains `fix_core`'s scope.
- **P1-1, Origin:** gateway checks the original owner mutation Origin, then preserves validated Host and Origin upstream. Actual checks exposed that Node's global `fetch` drops explicit Host headers. The Moki proxy now uses a loopback-only `http.request` adapter, verified through the actual gateway/preview. The board API's same-origin check is unchanged.
- **REVIEW condition 4:** installed `/home/sogo/.config/systemd/user/moki.service`, with its versioned template in Apps `integration/moki.service`. It runs production `vite preview`, binds loopback8847, requires the private runtime env, and uses control-group shutdown. It is static, not enabled or started. Registration/reloading the controller did not stop Rigrove.
- **Independent review correction:** readiness initially checked HTML, which could mask the dev server's job-root lock. Readiness now checks `/app/moki/api/board/jobs` with the server-only capability. Failed board readiness stops Moki and restores Rigrove; a regression verifies that sequence.
- Binary CAD/board downloads stream with a128 MiB bound instead of inheriting Rigrove's3 MiB buffered response limit. Query strings, content types and artifact CSP headers are preserved.

## Measured acceptance

| Check | Result |
|---|---|
| Apps `npm run typecheck` | Pass |
| Apps `npm test` | **34/34** controlled checks pass |
| Apps `npm run build` | Pass; new controller loaded |
| Moki `npm run typecheck` | Pass |
| Moki `npm run build` | Pass; base `/app/moki/`; existing large-viewer chunk warning remains |
| Actual Vite production preview + actual Apps gateway | **9/9** checks pass with isolated jobs, fixture authentication and mocked units |
| Installed unit `systemd-analyze --user verify` | Pass |
| Actual controller registration | Moki stopped, Rigrove running/healthy |
| Actual public unauthenticated boundary | HTML redirects to login; board API and assets return401 |
| Independent scoped review | Readiness finding fixed; no material implementation findings remain |

The actual-preview test checks HTML, a real built JS asset, Lab, custom public Host/Origin, API auth, browser-token overwrite, route exclusions and raw path traversal. It does not render the browser UI, fabricate a board or execute a complete real build. UI screenshots and full board pipeline acceptance belong to the other workers.

Evidence: `../evidence/fix_link/{CONTRACT.md,controlled-checks.json,preview-check.mts,preview-check.json,registration-check.mts,registration-check.json,independent-review.md}`. All scoped diff-whitespace checks pass. No commits or pushes.

## Exact owner/coordinator steps

1. Coordinator completes the remaining workers' integration and rebuilds with `npm run build` from Moki. The production base now defaults correctly even without an env override.
2. **Coordinator must stop the existing dev Vite process on5173 before switching.** It currently owns `var/board-jobs/.queue.lock` (PID929790 at verification). Preserve its jobs; do not delete/bypass a live lock. If omitted, the controller fails Moki readiness and attempts to restore Rigrove.
3. Owner opens the private entry above and signs in, then clicks **Start and open Moki**. Equivalently, on the Apps homepage click **Start and open** on the Moki row. The controller stops Rigrove, writes the private capability/runtime files, starts Moki and opens `/app/moki/studio`.
4. Check software output only. No board, print, flash, physical fit or power-up has been verified. Submitted TSX remains trusted owner code without an OS sandbox.
5. After the bounded check, click **Stop** on the Moki row in Apps. Click Rigrove's **Start and open** to restore it. If the preview origin rotates while Moki runs, Stop then Start Moki to regenerate its exact allowed hostname.

**No live Moki switch was performed.** The existing dev root lock makes that unsuitable while teammates still use the live API. Instead, startup/switch/rollback were verified with controlled unit fixtures and the real preview/gateway used an isolated root. Actual registration only restarted `sogo-apps.service`; Rigrove remained active with unchanged PID2792830, Moki remained inactive with PID0, and8847 was released after testing.

`fix_link` work and its scoped review worker are finished; there is no persistent coding worker. Apps handoff files were updated; Moki's PROJECT.md/.sogo state remain coordinator-owned. Herdr messaging was unavailable (`HERDR_ENV` unset), so no Herdr session was inspected or controlled. The integration contract was recorded in shared evidence and confirmed directly with fix_ui's relayed message.

## Final UI bundle refresh

After fix_ui reported completion, ran `MOKI_BASE_PATH=/app/moki/ npm run build` successfully. Verified every generated HTML asset URL starts with `/app/moki/` and resolves to a built file. Receipt: `../evidence/fix_link/final-ui-build.json`. No app lifecycle change was performed.
