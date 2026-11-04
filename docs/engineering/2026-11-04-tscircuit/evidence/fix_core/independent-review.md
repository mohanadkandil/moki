# Independent read-only review of the fix_core change

Reviewer: native agent `/root/review_core`, completed 2026-11-04.
Method: `/home/sogo/sogo/skills/engineering-review/SKILL.md`.
Scope: board API and process runner, board code generation/BOM, renderer and version identity, firmware, and regression tests. The reviewer made no edits and ran no heavy checks. Main-agent acceptance logs are separate.

The reviewer found two issues during the fix round, both corrected before final validation:

1. Stale PID-lock takeover could unlink a new owner's lock under concurrent recovery. Inspection/removal now runs under a separate exclusive recovery file. Competing process coverage was added. An abandoned recovery file fails closed and needs operator inspection.
2. The PnP converter returns CRLF. Appending a field after splitting only on LF corrupted CSV records. The renderer now splits on CRLF or LF, and a Python csv.reader regression checks six fields in every row.

The reviewer also requested a nested-worker shutdown regression. The test now starts an ordinary grandchild in the renderer's group and verifies that service.close leaves it gone or dead. Compiler subprocesses inherit that same outer group.

Final reviewer result: “No unresolved findings after rereading the final fixes.”

Limits: TSX remains trusted-owner, unsandboxed execution. Physical behavior and gateway deployment were outside this review.
