# Independent fix_link review — 4 November 2026

Reviewer: `/root/link_review`. Read-only review of the shared dirty tree; not an implementer. Baselines: Moki `8f08c3b`, Sogo Apps `0f4ad19`.

Read the engineering-review skill and pinned code-review procedure, the complete original REVIEW/FIXES, the Apps registry/runtime/gateway/token code and tests, the Moki Vite config and unit, and Apps preview-origin rotation script. No live services were changed, no heavyweight checks were run, and no product files were edited.

## Findings

1. **P1, confirmed by code: HTML readiness can report a broken board API as healthy.** At the initial review snapshot, `src/types.ts` gave Moki `healthPath: '/app/moki/studio'`. `Runtime.ready()` accepted its 200 HTML response. The existing development server owns the default board job-root lock, so production could serve HTML successfully while `/api/board/jobs` returns 503. Owner Start would stop Rigrove, mark Moki ready, and skip rollback even though Build and History cannot work. The fix is readiness against the authenticated board API, with a server-only per-app health header callback and a regression proving a failed board health check restores Rigrove. The parent accepted this finding and is implementing it; final disposition will be appended after reading the resulting code/evidence.

2. **P2, confirmed integration edge: preview-origin rotation requires restarting Moki.** `integration/preview.py` updates `APPS_PUBLIC_URL` and restarts Apps only. Moki's allowed public hostname comes from its process environment written in `MokiCapability.prepare()`. An already-running Moki retains its former hostname and rejects new-origin traffic, while localhost health can still pass. A Start request may return early before prepare. Stop then Start Moki regenerates the host environment and resolves this. The parent accepted an explicit deployment/handoff instruction for this bounded owner-only check; this is an operational limitation, not an authentication bypass.

## Boundaries inspected without further findings

- Owner session authentication precedes every allowed Moki HTML, asset and API path; unauthenticated board requests are refused.
- The proxy has a fixed loopback target/port and a narrow method/path allowlist. Workshop APIs, source/HMR, studies, arbitrary proxy targets and source maps are excluded.
- Browser-provided Moki capability headers are replaced by a server-read owner-only token. Tokens are not inserted in HTML or registry responses; token reads reject symlinks and unsafe ownership/mode.
- Original validated Host and Origin are forwarded. Mutations require the manager's matching origin before token injection. The Vite preview has an exact hostname list and an additional explicit hostname guard.
- API prefixes are normalized before the board handler; static assets retain the configured base path. App roots redirect to Studio, and Lab HTML is allowed.
- Board/CAD downloads stream with a size cap, rather than inheriting Rigrove's 3 MB buffered response limit.
- Registration does not start either project unit. The existing serialized lifecycle and prior-app restoration remain in use.

## Limits

The parent is running controlled HTTP and actual preview/gateway checks. This reviewer did not reproduce a real tunnel, launch the production unit, inspect a rendered browser, run physical hardware or repeat the full build/test suite. Moki must stay stopped until the development server releases the default job root; do not remove or bypass its lock. The token/proxy boundary is for one trusted owner only and does not sandbox submitted TSX.

## Final disposition — 14:31 UTC

- **P1 readiness closed.** Re-read `src/types.ts`, `src/runtime.ts`, `src/app.ts` and the new readiness-failure regression. Health now requests `/app/moki/api/board/jobs` using a server-only capability header in both list and ready checks. The regression asserts that working Studio HTML plus a failed board API stops Moki and restores Rigrove in the correct order. Inspected the resulting `sogo-apps/evidence/controlled-checks.json`: 34/34 controlled checks pass at 14:31 UTC. This is implementer-run evidence inspected by the reviewer, not an independently repeated suite.
- **Host preservation correction inspected.** The implementer's actual-preview check exposed Node global fetch dropping an explicitly supplied Host. Reviewed the resulting `fetchMoki` adapter using `node:http.request`: it permits loopback HTTP only, retains caller-supplied Host/Origin, accepts the bounded ArrayBuffer request body contract, returns a streamed Response, does not follow redirects and uses the caller abort signal. No further material defect found in that bounded use.
- Inspected `preview-check.json`: 9/9 checks pass against actual production Vite preview and actual gateway, with fixture owner authentication, mocked lifecycle units and an isolated job root. It verifies public Host/Origin, base paths, auth/token requirements and route exclusions. It does not constitute a live switch or external-tunnel test.
- The origin-rotation limitation remains accepted with the explicit Stop then Start instruction. The real development process still must release the production job root before owner startup; with the readiness fix, missing that prerequisite fails the switch instead of reporting false success.

**Review verdict:** no remaining material implementation finding within this fix_link scope, subject to the stated deployment prerequisites and owner-only trust boundary. Physical fabrication, public/multi-user execution, browser UI acceptance and a live external-tunnel switch are outside this review.
