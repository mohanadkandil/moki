import * as React from 'react'
import type { InductorProps } from "@tscircuit/props"

export const LPS4012_222MRC = (props: Omit<InductorProps, "inductance">) => {
  return (
    <inductor
      inductance="2.2uH"
      supplierPartNumbers={{
  "jlcpcb": [
    "C20416998"
  ]
}}
      manufacturerPartNumber="LPS4012-222MRC"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-1.499997mm" pcbY="0mm" width="1.999996mm" height="3.8999922mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="1.499997mm" pcbY="0mm" width="1.999996mm" height="3.8999922mm" shape="rect" />
<silkscreenpath route={[{"x":-1.9051269999997658,"y":2.158999999999992},{"x":1.9048730000001797,"y":2.158999999999992}]} />
<silkscreenpath route={[{"x":-1.9051269999997658,"y":-2.158999999999992},{"x":1.9048730000001797,"y":-2.158999999999992}]} />
<silkscreentext text="{NAME}" pcbX="0.009779mm" pcbY="3.159mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-2.7499950000000126,"y":2.199996100000021},{"x":2.7499950000000126,"y":2.199996100000021},{"x":2.7499950000000126,"y":-2.199996100000021},{"x":-2.7499950000000126,"y":-2.199996100000021},{"x":-2.7499950000000126,"y":2.199996100000021}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C20416998.obj?uuid=58790cd46d7749a789c0aa1c8593624e",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C20416998.step?uuid=58790cd46d7749a789c0aa1c8593624e",
        pcbRotationOffset: 90,
        modelOriginPosition: { x: 0, y: -0.00012699999979304266, z: -0.1 },
      }}
      {...props}
    />
  )
}