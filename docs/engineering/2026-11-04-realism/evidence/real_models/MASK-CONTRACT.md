# real_stage integration

Read raw node names (`userData.name` in three) `<ref>:<moduleId>` and `<ref>:socket`; mesh extras contain `moki: { role: 'module' | 'socket', part: '<ref>', module: '<catalog id>', estimated: true }`. Assembly will preserve these exact nodes. Legacy fallback nodes remain `modules-<ref>`.

Mask picker values: `green`, `black`, `blue`, `white` (client-side material swap, no job input). For a loaded GLTF `gltf`, read `gltf.parser.json.asset.extras.moki.maskMaterials`, a map from colour to `[topMaterialIndex, bottomMaterialIndex]`. `await gltf.parser.getDependency('material', index)` returns the material. On the board mesh (Box0), replace only materials named `TopMaterial_*`, `BottomMaterial_*` or `moki-mask-<colour>-top` / `-bottom` with the corresponding loaded variant. Keep side material as authored. Do not dispose shared parser materials on each toggle. Variant images include mask, routed copper, silkscreen and gold pads; white uses dark silkscreen for legibility. Full replacement preserves these colours, unlike multiplying the material colour.

No Herdr control attempted: this tool environment has no HERDR_ENV. Final jobs: focus-timer `24fd29e6-28d4-4ff7-abc8-bad1abfa2365`, light-lamp `9ec90ad8-0f55-459e-b32e-cc4afb2a1893`, temp-monitor `b59461c0-8c5b-4fcc-a34b-a4e0e9c9c4b2`.
