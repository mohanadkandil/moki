import * as React from 'react'
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["DIN"],
  pin2: ["GAIN_SLOT"],
  pin3: ["GND1"],
  pin4: ["N_SD_MODE"],
  pin5: ["N_C_1"],
  pin6: ["N_C_2"],
  pin7: ["VDD1"],
  pin8: ["VDD2"],
  pin9: ["OUTP"],
  pin10: ["OUTN"],
  pin11: ["GND2"],
  pin12: ["N_C_3"],
  pin13: ["N_C_4"],
  pin14: ["LRCLK"],
  pin15: ["GND3"],
  pin16: ["BCLK"],
  pin17: ["EP"]
} as const

const pinAttributes = {
  pin3: {requiresGround: true},
  pin11: {requiresGround: true},
  pin15: {requiresGround: true}
} as const

export const MAX98357AETE_T = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C910544"
  ]
}}
      manufacturerPartNumber="MAX98357AETE+T"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-0.748411mm" pcbY="-1.499997mm" width="0.2500122mm" height="0.5999988mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-0.248539mm" pcbY="-1.499997mm" width="0.2500122mm" height="0.5999988mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="0.251587mm" pcbY="-1.499997mm" width="0.2500122mm" height="0.5999988mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="0.751459mm" pcbY="-1.499997mm" width="0.2500122mm" height="0.5999988mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="1.499997mm" pcbY="-0.747903mm" width="0.5999988mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="1.499997mm" pcbY="-0.248031mm" width="0.5999988mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="1.499997mm" pcbY="0.252095mm" width="0.5999988mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="1.499997mm" pcbY="0.751967mm" width="0.5999988mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="0.749935mm" pcbY="1.499997mm" width="0.2500122mm" height="0.5999988mm" shape="rect" />
<smtpad portHints={["pin10"]} pcbX="0.250063mm" pcbY="1.499997mm" width="0.2500122mm" height="0.5999988mm" shape="rect" />
<smtpad portHints={["pin11"]} pcbX="-0.250063mm" pcbY="1.499997mm" width="0.2500122mm" height="0.5999988mm" shape="rect" />
<smtpad portHints={["pin12"]} pcbX="-0.748411mm" pcbY="1.499997mm" width="0.2500122mm" height="0.5999988mm" shape="rect" />
<smtpad portHints={["pin13"]} pcbX="-1.499997mm" pcbY="0.751967mm" width="0.5999988mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin14"]} pcbX="-1.499997mm" pcbY="0.252095mm" width="0.5999988mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin15"]} pcbX="-1.499997mm" pcbY="-0.248031mm" width="0.5999988mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin16"]} pcbX="-1.499997mm" pcbY="-0.747903mm" width="0.5999988mm" height="0.2500122mm" shape="rect" />
<smtpad portHints={["pin17"]} pcbX="0.000127mm" pcbY="-0.000127mm" width="1.499997mm" height="1.499997mm" shape="rect" />
<silkscreenpath route={[{"x":-1.4998954000001277,"y":1.5001494000000548},{"x":-1.4998954000001277,"y":1.1082020000001194}]} />
<silkscreenpath route={[{"x":-1.4998954000001277,"y":-1.1040617999998403},{"x":-1.4998954000001277,"y":-1.4998699999999872}]} />
<silkscreenpath route={[{"x":1.5001239999999143,"y":-1.4998699999999872},{"x":1.5001239999999143,"y":-1.1040617999998403}]} />
<silkscreenpath route={[{"x":1.5001239999999143,"y":1.1082020000001194},{"x":1.5001239999999143,"y":1.5001494000000548}]} />
<silkscreenpath route={[{"x":-1.4998954000001277,"y":1.5001494000000548},{"x":-1.1046206000000893,"y":1.5001494000000548}]} />
<silkscreenpath route={[{"x":1.1061191999998528,"y":1.5001494000000548},{"x":1.5001239999999143,"y":1.5001494000000548}]} />
<silkscreenpath route={[{"x":-1.4998954000001277,"y":-1.4998699999999872},{"x":-1.1046206000000893,"y":-1.4998699999999872}]} />
<silkscreenpath route={[{"x":1.1076431999997567,"y":-1.4998699999999872},{"x":1.5001239999999143,"y":-1.4998699999999872}]} />
<silkscreencircle pcbX="-1.288923mm" pcbY="-1.844675mm" radius="0.054356mm" />
<silkscreentext text="{NAME}" pcbX="0.011049mm" pcbY="2.792351mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-2.0499964000000546,"y":2.0499964000000546},{"x":2.0499964000000546,"y":2.0499964000000546},{"x":2.0499964000000546,"y":-2.0499964000000546},{"x":-2.0499964000000546,"y":-2.0499964000000546},{"x":-2.0499964000000546,"y":2.0499964000000546}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C910544.obj?uuid=edc2f28e721b49ee8c25b04b981b88c3",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C910544.step?uuid=edc2f28e721b49ee8c25b04b981b88c3",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: -0.000012699999842880061, y: 0, z: -0.01 },
      }}
      {...props}
    />
  )
}