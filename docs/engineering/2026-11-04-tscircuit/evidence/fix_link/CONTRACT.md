# fix_link integration contract

- Gateway app path `/app/moki`; app HTML redirects to `/app/moki/studio`.
- Vite production build/preview base defaults to `/app/moki/`; dev defaults to `/`. `MOKI_BASE_PATH` can explicitly select either. Gateway keeps that prefix upstream.
- API canonical path `/api/board/*`; preview normalizes `/app/moki/api/board/*` before invoking board API.
- Header `X-Moki-Capability`: gateway overwrites/injects owner-only server-side token. Browser never receives this token. `MOKI_BOARD_API_TOKEN` is set in the unit runtime environment.
- Gateway validates owner session on every path, validates original Origin on writes, preserves original validated Host/Origin upstream. Vite allows the exact configured preview hostname from `MOKI_PUBLIC_HOST`.
- Only Studio/Lab HTML, built `/assets/*`, and `/api/board/*` allowed. Workshop APIs, `/@fs`, HMR and studies excluded.
- Moki port 8847, loopback; registration does not start it or stop Rigrove.
- This fix_link process has no HERDR_ENV=1; Herdr control/messaging is unavailable under the Herdr skill. No Herdr session inspected.

- Controller readiness calls token-authenticated `/app/moki/api/board/jobs`, so a live dev job-root lock makes the switch fail and restores Rigrove. Coordinator must stop the existing dev Vite before the owner switches to Moki.
- If the public tunnel origin rotates while Moki is active, Stop then Start Moki from Apps to refresh its exact allowed hostname.
