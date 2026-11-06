import * as React from 'react'
import type { PushButtonProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"],
  pin3: ["pin3"]
} as const

export const TL6340AF160Q = (props: PushButtonProps<typeof pinLabels>) => {
  const { name = "SW1", ...restProps } = props

  return (
    <pushbutton
      name={name}
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C4944967"
  ]
}}
      manufacturerPartNumber="TL6340AF160Q"
      footprint={<footprint>
        <platedhole  portHints={["pin3"]} pcbX="1.82499mm" pcbY="-1.13747545mm" holeWidth="0.7999984mm" holeHeight="0.839978mm" outerWidth="1.1999976mm" outerHeight="1.35001mm" pcbRotation="180deg" shape="pill" />
<platedhole  portHints={["pin3"]} pcbX="-1.82499mm" pcbY="-1.13747545mm" holeWidth="0.7999984mm" holeHeight="0.8400034mm" outerWidth="1.1999976mm" outerHeight="1.35001mm" pcbRotation="180deg" shape="pill" />
<smtpad portHints={["pin1"]} pcbX="1.394968mm" pcbY="0.48761655mm" width="0.6999986mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-1.445006mm" pcbY="0.48761655mm" width="0.6999986mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-0.025146mm" pcbY="0.63747655mm" width="1.4400022mm" height="1.0999978mm" shape="rect" />
<silkscreenpath route={[{"x":-2.0262596000001167,"y":0.2595499500000642},{"x":-2.0790408000001435,"y":0.2595499500000642}]} />
<silkscreenpath route={[{"x":-0.7000748000001522,"y":-2.722613249999995},{"x":-0.7000748000001522,"y":-1.6454500499999085}]} />
<silkscreenpath route={[{"x":0.7294117999999798,"y":-2.722613249999995},{"x":0.7294117999999798,"y":-1.6454500499999085}]} />
<silkscreenpath route={[{"x":0.7294117999999798,"y":-2.722613249999995},{"x":-0.7000748000001522,"y":-2.722613249999995}]} />
<silkscreenpath route={[{"x":-2.0790408000001435,"y":0.2595499500000642},{"x":-2.0790408000001435,"y":-0.27120845000001736}]} />
<silkscreenpath route={[{"x":-1.1160505999999941,"y":-1.6454500499999085},{"x":1.11592359999986,"y":-1.6454500499999085}]} />
<silkscreenpath route={[{"x":1.9849591999999348,"y":0.2595499500000642},{"x":1.9849591999999348,"y":-0.24690065000004324}]} />
<silkscreenpath route={[{"x":1.9849591999999348,"y":0.2595499500000642},{"x":1.9760183999998162,"y":0.2595499500000642}]} />
<silkscreentext text="{NAME}" pcbX="-0.003048mm" pcbY="2.18814855mm" anchorAlignment="center" fontSize="1mm" />
<fabricationnotepath route={[{"x":-0.635076200000185,"y":-1.646948650000013},{"x":0.6349237999999104,"y":-1.646948650000013},{"x":0.6349237999999104,"y":-2.6629486499999757},{"x":-0.635076200000185,"y":-2.6629486499999757},{"x":-0.635076200000185,"y":-1.646948650000013}]} strokeWidth="0mm" isFilled hasStroke={false} />
<courtyardoutline outline={[{"x":-2.6749887999999373,"y":1.4374754499999653},{"x":2.6749887999999373,"y":1.4374754499999653},{"x":2.6749887999999373,"y":-2.939999650000118},{"x":-2.6749887999999373,"y":-2.939999650000118},{"x":-2.6749887999999373,"y":1.4374754499999653}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C4944967.obj?uuid=3601cf77bf9b482b8936369aede51d3d",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C4944967.step?uuid=3601cf77bf9b482b8936369aede51d3d",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 1.2399987499999314, z: 0.04999899999999996 },
      }}
      {...restProps}
    />
  )
}