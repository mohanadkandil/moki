# Private native replay loader

`loadNativeReplay` validates an exact phase-input canonical SHA and six source/current artifact pairs,covering seven identity inputs. Output bytes are pinned separately. It requires the original failed-job/pre-pour capture,then accepts only unique named global native traces with finite supported wire/via geometry,unchanged board minimum width and0.6/0.3vias. It returns the original parsed records and ordering,without conversion,clamping,normalization or prior gate results.

Nine focused tests and strict TypeScript pass,including changed input/plan/import/placement/prefix,raw output mutation,unsupported geometry,duplicate/fixed IDs,unknown layer,via-dimension and original0.106066mm floor violations. A pure actual-file smoke validates all117native-width-refined records at0.15mm. The smoke intentionally compares the source directory to itself; it does not claim a fresh job or any native acceptance.

The author does not independently approve this loader. gnd_escape reviews it and the private caller integration. The receipt labels native output reuse and requires every fresh native/fabrication/compile gate. No routing solver,build,server or compile was run by this loader work.
