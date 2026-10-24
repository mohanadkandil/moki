# Coordination contract

The orchestrator is the only writer of shared product revisions. Workers own their source artifacts. Changes are proposed, committed as a new revision, and used to schedule dependent jobs.

An electrical worker saves the board. A measurement tool publishes its exact outline, thickness, holes, component geometry and connector keepouts, with units, coordinate frame, artifact URI and content hash. Unknown or missing component geometry blocks dependent clearance claims.

The mechanical worker consumes the published board revision and its geometry. Its result records the exact PCB hash used. A cross-domain validator loads the actual board and enclosure files and checks geometry, mounts and connector access. Electrical and firmware validators run their own rule checks and fixed execution tests.

Every validation result records checker version, input hashes, outcome, evidence and unresolved issues. The release gate rejects stale checks and mixed revisions. A failed check schedules repair; changing the acceptance criteria requires review.

User edits invalidate only affected artifacts and their dependents. A new PCB shape may invalidate the enclosure and fit checks; a changed enclosure invalidates its render and showcase. Marketing claims derive from the same current specification.

The initial agent definitions are a scaffold, not a functioning CAD generation pipeline. Runtime tool permissions and validators must be added and exercised before claiming autonomous engineering or manufacturing readiness.
