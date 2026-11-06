import * as React from 'react'
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["CS"],
  pin2: ["DO","IO1"],
  pin3: ["IO2"],
  pin4: ["GND"],
  pin5: ["DI","IO0"],
  pin6: ["CLK"],
  pin7: ["IO3"],
  pin8: ["VCC"]
} as const

const pinAttributes = {
  pin4: {requiresGround: true},
  pin8: {requiresPower: true}
} as const

export const W25Q16JVSSIQ = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C82317"
  ]
}}
      manufacturerPartNumber="W25Q16JVSSIQ"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-1.905mm" pcbY="-3.530092mm" width="0.6299962mm" height="2.2500082mm" radius="0.3149981mm" shape="pill" />
<smtpad portHints={["pin2"]} pcbX="-0.635mm" pcbY="-3.530092mm" width="0.6299962mm" height="2.2500082mm" radius="0.3149981mm" shape="pill" />
<smtpad portHints={["pin3"]} pcbX="0.635mm" pcbY="-3.530092mm" width="0.6299962mm" height="2.2500082mm" radius="0.3149981mm" shape="pill" />
<smtpad portHints={["pin4"]} pcbX="1.905mm" pcbY="-3.530092mm" width="0.6299962mm" height="2.2500082mm" radius="0.3149981mm" shape="pill" />
<smtpad portHints={["pin8"]} pcbX="-1.905mm" pcbY="3.530092mm" width="0.6299962mm" height="2.2500082mm" radius="0.3149981mm" shape="pill" />
<smtpad portHints={["pin7"]} pcbX="-0.635mm" pcbY="3.530092mm" width="0.6299962mm" height="2.2500082mm" radius="0.3149981mm" shape="pill" />
<smtpad portHints={["pin6"]} pcbX="0.635mm" pcbY="3.530092mm" width="0.6299962mm" height="2.2500082mm" radius="0.3149981mm" shape="pill" />
<smtpad portHints={["pin5"]} pcbX="1.905mm" pcbY="3.530092mm" width="0.6299962mm" height="2.2500082mm" radius="0.3149981mm" shape="pill" />
<silkscreenpath route={[{"x":-2.6387044000000515,"y":-2.1763989999999467},{"x":-2.6387044000000515,"y":2.1763990000000604},{"x":2.6387044000000515,"y":2.1763990000000604},{"x":2.6387044000000515,"y":-2.1763989999999467},{"x":-2.6387044000000515,"y":-2.1763989999999467}]} />
<silkscreencircle pcbX="-1.905mm" pcbY="-1.423924mm" radius="0.150114mm" />
<silkscreencircle pcbX="-2.672334mm" pcbY="-3.530092mm" radius="0.150114mm" />
<silkscreentext text="{NAME}" pcbX="-0.0889mm" pcbY="5.3434mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-2.9000074000000495,"y":4.905096100000037},{"x":2.8999820000000227,"y":4.905096100000037},{"x":2.8999820000000227,"y":-4.905096100000037},{"x":-2.9000074000000495,"y":-4.905096100000037},{"x":-2.9000074000000495,"y":4.905096100000037}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C82317.obj?uuid=4652e19b90fa4dbb8662aa4cba61a532",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C82317.step?uuid=4652e19b90fa4dbb8662aa4cba61a532",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0.000012700000070253736, y: -0.000012699999956566899, z: -0.069425 },
      }}
      {...props}
    />
  )
}