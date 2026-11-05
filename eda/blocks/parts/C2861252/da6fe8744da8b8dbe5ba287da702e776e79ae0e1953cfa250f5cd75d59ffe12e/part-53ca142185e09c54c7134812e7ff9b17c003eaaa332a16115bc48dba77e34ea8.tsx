import * as React from 'react'
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["TS"],
  pin2: ["BAT2"],
  pin3: ["BAT1"],
  pin4: ["N_CE"],
  pin5: ["EN2"],
  pin6: ["EN1"],
  pin7: ["N_PGOOD"],
  pin8: ["VSS"],
  pin9: ["N_CHG"],
  pin10: ["OUT2"],
  pin11: ["OUT1"],
  pin12: ["ILIM"],
  pin13: ["IN"],
  pin14: ["TMR"],
  pin15: ["ITERM"],
  pin16: ["ISET"],
  pin17: ["EP"]
} as const

const pinAttributes = {
  pin8: {requiresGround: true}
} as const

export const BQ24074RGTT = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C2861252"
  ]
}}
      manufacturerPartNumber="BQ24074RGTT"
      footprint={<footprint>
        <smtpad portHints={["pin17"]} pcbX="0.000127mm" pcbY="-0.000127mm" width="1.6999966mm" height="1.6999966mm" shape="rect" />
<smtpad portHints={["pin16"]} pcbX="-0.7499858mm" pcbY="1.499997mm" width="0.2800096mm" height="0.7999984mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin15"]} pcbX="-0.2499868mm" pcbY="1.499997mm" width="0.2800096mm" height="0.7999984mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin14"]} pcbX="0.2500122mm" pcbY="1.499997mm" width="0.2800096mm" height="0.7999984mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin13"]} pcbX="0.7500112mm" pcbY="1.499997mm" width="0.2800096mm" height="0.7999984mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin12"]} pcbX="1.499997mm" pcbY="0.7499858mm" width="0.7999984mm" height="0.2800096mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin11"]} pcbX="1.499997mm" pcbY="0.2499868mm" width="0.7999984mm" height="0.2800096mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin10"]} pcbX="1.499997mm" pcbY="-0.2499868mm" width="0.7999984mm" height="0.2800096mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin9"]} pcbX="1.499997mm" pcbY="-0.7499858mm" width="0.7999984mm" height="0.2800096mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin8"]} pcbX="0.7500112mm" pcbY="-1.499997mm" width="0.2800096mm" height="0.7999984mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin7"]} pcbX="0.2500122mm" pcbY="-1.499997mm" width="0.2800096mm" height="0.7999984mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin6"]} pcbX="-0.2499868mm" pcbY="-1.499997mm" width="0.2800096mm" height="0.7999984mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin5"]} pcbX="-0.7499858mm" pcbY="-1.499997mm" width="0.2800096mm" height="0.7999984mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin4"]} pcbX="-1.499997mm" pcbY="-0.7499858mm" width="0.7999984mm" height="0.2800096mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin3"]} pcbX="-1.499997mm" pcbY="-0.2499868mm" width="0.7999984mm" height="0.2800096mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin2"]} pcbX="-1.499997mm" pcbY="0.2499868mm" width="0.7999984mm" height="0.2800096mm" radius="0.1400048mm" shape="pill" />
<smtpad portHints={["pin1"]} pcbX="-1.499997mm" pcbY="0.7499858mm" width="0.7999984mm" height="0.2800096mm" radius="0.1400048mm" shape="pill" />
<silkscreenpath route={[{"x":1.5000986000000012,"y":1.5000478000000044},{"x":1.5000986000000012,"y":1.0442956000000123}]} />
<silkscreenpath route={[{"x":1.5000986000000012,"y":-1.0441940000000045},{"x":1.5000986000000012,"y":-1.4999461999999966}]} />
<silkscreenpath route={[{"x":-1.4998953999999998,"y":1.5000478000000044},{"x":-1.4998953999999998,"y":1.0442956000000123}]} />
<silkscreenpath route={[{"x":-1.4998953999999998,"y":-1.0441940000000045},{"x":-1.4998953999999998,"y":-1.4999461999999966}]} />
<silkscreenpath route={[{"x":1.5000986000000012,"y":1.5000478000000044},{"x":1.044346400000002,"y":1.5000478000000044}]} />
<silkscreenpath route={[{"x":-1.0441432000000077,"y":1.5000478000000044},{"x":-1.4998953999999998,"y":1.5000478000000044}]} />
<silkscreenpath route={[{"x":-1.4998953999999998,"y":-1.4999461999999966},{"x":-1.0441432000000077,"y":-1.4999461999999966}]} />
<silkscreenpath route={[{"x":1.044346400000002,"y":-1.4999461999999966},{"x":1.5000986000000012,"y":-1.4999461999999966}]} />
<silkscreenpath route={[{"x":-1.7399507999999955,"y":1.2513056000000091},{"x":-1.7598850891640652,"y":1.250035600000004},{"x":-1.7399508000000026,"y":1.2487655999999987}]} />
<silkscreentext text="{NAME}" pcbX="-0.006985mm" pcbY="2.911985mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-2.149996199999997,"y":2.1499961999999897},{"x":2.149996199999997,"y":2.1499961999999897},{"x":2.149996199999997,"y":-2.1499961999999897},{"x":-2.149996199999997,"y":-2.1499961999999897},{"x":-2.149996199999997,"y":2.1499961999999897}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2861252.obj?uuid=3393915cc74240b786c7d7578739d4d7",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2861252.step?uuid=3393915cc74240b786c7d7578739d4d7",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: -0.000025399999991293498, y: 0.00002540000001260978, z: -0.02 },
      }}
      {...props}
    />
  )
}