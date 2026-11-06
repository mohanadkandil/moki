# Registered passive pad handoffs

The producer selects one actual registered two-pin passive rectangular SMT endpoint for each requested net,without guessing net names. Catalog receipt/MPN and native physical source/port/net/placement correspondence must agree. It retains the exact source trace width and creates one0.20mm cardinal normal handoff from the actual port. Both endpoint discs fit strictly inside the actual rectangle erosion,which proves the whole convex trace capsule remains inside existing land copper. No via or outside-land copper is added. Unsupported geometry fails clearly.

Actual BOOTSEL selectsR2pin2 at0.15mm width. Its0.8064754×0.8640064mm land leaves0.1282377mm normal margin around the complete capsule. Six focused tests and strict TypeScript pass. A derived prefix alone still fails the official physical connectivity check for remoteSW2,so it cannot fake a routed net.

This reviewer authored the producer and does not independently approve it. gnd_escape reports no blocker after independent producer/binder review,22tests and an actual source-completion probe. New whole-board native routing remains parent-owned.
