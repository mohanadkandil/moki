# Optional fine-pitch contained handoff implementation proof

Authored by /root/final_review; pending independent review by rp_clock.

The optional fifth argument `allowFinePitchPads:true` adds only a last-resort registeredRP2040/knownflash endpoint choice. Registered two-pin passives retain first preference and default behavior is unchanged. The actual native pad long axis determines a0.20mm,two-wire handoff. Both complete wire caps are strictly inside a finite rectangular/cardinal-rotated own SMTland,so no copper outside the pre-existing land or via is added. Source/catalog/import/physical/net/width proofs remain; optional candidates additionally pass both native overlap and near-hole-clearance checks. The latter intentionally omits overlaps,which the complementary checker catches.

Ten tests and targeted strict TypeScript pass. Six actualQSPI nets fit across2/4layers and allcardinal rotations,while malformed/unsupported identity,geometry,width and drillvoid cases reject. Input/source/physical data stay immutable. A prefix alone remains an unrouted board; private native build/final gates are outside this author proof.


Independent review identified an own-net plated-drill exemption missed by the native overlap/near-clearance combination. The fix independently bounds every TOP-reaching physical drill void without source/net labels. Circle/slot/rect/square dimensions and offsets can only enlarge the conservative bound; unknown or malformed geometry rejects. Any full wire-capsule intersection rejects. Existing pre-routing via rejection stays unchanged. The original reviewer reproduction now rejects; thirteen tests and strict TypeScript pass. Independent re-review of the final hash remains pending.
