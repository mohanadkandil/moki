# Bounded endpoint inference owner counterfactual

Pure research only: no installed SDK patch, solver construction, native routing, fabrication geometry edit or service operation. The probe loads the full pinned native converter and all original helper bodies from the installed source map. It applies the previously reviewed owner predicate in memory, then imports a complete temporary copy of the actual installed `@tscircuit/checks` bundle. Only the `addStartAndEndPortIdsIfMissing` loop receives a counterfactual early continue; the original installed bundles remain untouched and the temporary module is removed.

The proposed restriction skips missing-marker autofill when a PCB trace references exactly one declared `source_trace` with nonempty arrays of nonempty string port/net references. It preserves preexisting markers. Native converter diagnostics contain alias declarations in those arrays, including PCB port IDs, and **no source_port/source_net table records**. Thus actual source-table existence is unavailable within this diagnostic checker; this is a unique structurally declared-source guard, not independent compiler-canonical ownership validation. Removing inferred aliases strengthens the check; it adds no electrical ownership or connectivity unions.

Measured seven complete-checker cases:

- Both actual-derived foreign GND contacts, with bound and unbound terminals: current checker reports0 errors after adding a foreign `pcb_port_56` endpoint. Restricted checker adds no marker and reports1 native accidental pad overlap for each.
- Legitimate own-pad route:0 errors; an existing legitimate start marker is preserved.
- Same-net free-copper T-junction:0 errors; both branches retain absent free-space markers and same declared source ownership.
- Unknown legacy trace and empty owner-reference arrays: unchanged native autofill and0 errors, explicitly preserving legacy behavior.
- A preexisting foreign marker is preserved and still hides the bad contact. This is an explicit limitation, so the restriction must apply before the first native geometric inference; it cannot clean an already contaminated route or replace source/all-net physical checks.

All trace coordinates, widths, layers, route types, IDs and source metadata remain byte-equivalent after stripping marker fields. No native error record is dropped or waived. The reported accidental contact comes from the unchanged full native overlap checker and its normal geometry/clearance paths. See the executable `.mts` and `.json` receipt for pinned bundle hashes, exact guard text and complete before/after markers/errors.

This probe supports a bounded native checker strengthening experiment. It does not prove all existing designs can omit autofill, validate arbitrary declared source aliases, fix preexisting forged markers or establish whole-board acceptance.
