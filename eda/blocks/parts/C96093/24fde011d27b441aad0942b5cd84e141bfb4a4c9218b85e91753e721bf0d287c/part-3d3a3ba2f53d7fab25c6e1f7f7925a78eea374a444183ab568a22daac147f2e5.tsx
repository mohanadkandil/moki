import * as React from 'react'
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["_POS"],
  pin2: ["pin2"]
} as const

export const TMB12A05 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      symbol={
        <symbol>
          <port name="pin1" pinNumber={1} aliases={["_POS"]} direction="left" schX={-0.3} schY={0.1} schStemLength={0.2} />
          <port name="pin2" pinNumber={2} aliases={["2"]} direction="left" schX={-0.3} schY={-0.1} schStemLength={0.2} />
          <schematicpath points={[{"x":0.28,"y":0.3},{"x":0.1,"y":0.14}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.1,"y":-0.14},{"x":0.28,"y":-0.3}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.28,"y":0.3},{"x":0.28,"y":-0.3}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.1,"y":0.14},{"x":0.1,"y":-0.14}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.1,"y":0.14},{"x":-0.1,"y":-0.14}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.1,"y":-0.14},{"x":0.1,"y":-0.14}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.1,"y":0.14},{"x":0.1,"y":0.14}]} strokeColor="#880000" />
          <schematictext schX={-0.025} schY={0.5} text="{NAME}" fontSize={0.2} anchor="bottom_center" />
        </symbol>
      }
      supplierPartNumbers={{
  "jlcpcb": [
    "C96093"
  ]
}}
      manufacturerPartNumber="TMB12A05"
      footprint={<footprint>
        <platedhole  portHints={["pin2"]} pcbX="3.799967mm" pcbY="0mm" outerDiameter="1.7999964mm" holeDiameter="0.999998mm" shape="circle" />
<platedhole  portHints={["pin1"]} pcbX="-3.799967mm" pcbY="0mm" outerDiameter="1.7999964mm" holeDiameter="0.999998mm" shape="circle" />
<silkscreencircle pcbX="-0.000127mm" pcbY="0mm" radius="1.27mm" />
<silkscreencircle pcbX="-0.000127mm" pcbY="0mm" radius="5.999988mm" />
<silkscreentext text="+" pcbX="-4.444873mm" pcbY="1.7653mm" anchorAlignment="bottom_left" fontSize="1.524mm" />
<silkscreentext text="{NAME}" pcbX="0.000127mm" pcbY="6.9944mm" anchorAlignment="center" fontSize="1mm" />
<fabricationnotepath route={[{"x":-4.445000000000164,"y":1.9049999999999727},{"x":-3.3020000000001346,"y":1.9049999999999727},{"x":-3.3020000000001346,"y":1.6509999999999536},{"x":-4.572000000000116,"y":1.6509999999999536},{"x":-4.572000000000116,"y":1.9049999999999727},{"x":-4.445000000000164,"y":1.9049999999999727}]} strokeWidth="0mm" isFilled hasStroke={false} />
<fabricationnotepath route={[{"x":-4.064000000000192,"y":1.2699999999999818},{"x":-4.064000000000192,"y":2.413000000000011},{"x":-3.810000000000173,"y":2.413000000000011},{"x":-3.8099746000000323,"y":1.143000000000029},{"x":-4.064000000000192,"y":1.1429745999998886},{"x":-4.064000000000192,"y":1.2699999999999818}]} strokeWidth="0mm" isFilled hasStroke={false} />
<courtyardoutline outline={[{"x":-6.269977800000106,"y":6.24998800000003},{"x":6.2299981999999545,"y":6.24998800000003},{"x":6.2299981999999545,"y":-6.24998800000003},{"x":-6.269977800000106,"y":-6.24998800000003},{"x":-6.269977800000106,"y":6.24998800000003}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C96093.obj?uuid=659b7b30e5a340e8a7eddac89d8c69d7",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C96093.step?uuid=659b7b30e5a340e8a7eddac89d8c69d7",
        pcbRotationOffset: 90,
        modelOriginPosition: { x: 0, y: -0.019989800000075775, z: -0.000009000000000369823 },
      }}
      {...props}
    />
  )
}