import * as React from 'react'
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["nSleep"],
  pin2: ["AOUT1"],
  pin3: ["AISEN"],
  pin4: ["AOUT2"],
  pin5: ["BOUT2"],
  pin6: ["BISEN"],
  pin7: ["BOUT1"],
  pin8: ["nFault"],
  pin9: ["BIN1"],
  pin10: ["BIN2"],
  pin11: ["VCP"],
  pin12: ["VM"],
  pin13: ["GND1"],
  pin14: ["VINT"],
  pin15: ["AIN2"],
  pin16: ["AIN1"],
  pin17: ["GND2"]
} as const

const pinAttributes = {
  pin13: {requiresGround: true},
  pin17: {requiresGround: true}
} as const

export const DRV8833PWPR = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C50506"
  ]
}}
      manufacturerPartNumber="DRV8833PWPR"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-2.275078mm" pcbY="-2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin2"]} pcbX="-1.625092mm" pcbY="-2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin3"]} pcbX="-0.975106mm" pcbY="-2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin4"]} pcbX="-0.324866mm" pcbY="-2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin5"]} pcbX="0.32512mm" pcbY="-2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin6"]} pcbX="0.975106mm" pcbY="-2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin7"]} pcbX="1.625092mm" pcbY="-2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin8"]} pcbX="2.275078mm" pcbY="-2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin16"]} pcbX="-2.275078mm" pcbY="2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin15"]} pcbX="-1.625092mm" pcbY="2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin14"]} pcbX="-0.975106mm" pcbY="2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin13"]} pcbX="-0.324866mm" pcbY="2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin12"]} pcbX="0.32512mm" pcbY="2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin11"]} pcbX="0.975106mm" pcbY="2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin10"]} pcbX="1.625092mm" pcbY="2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin9"]} pcbX="2.275078mm" pcbY="2.850007mm" width="0.350012mm" height="1.2999974mm" radius="0.175006mm" shape="pill" />
<smtpad portHints={["pin17"]} pcbX="0mm" pcbY="0mm" width="2.7399996mm" height="2.7399996mm" shape="rect" />
<via pcbX="0.500126mm" pcbY="0.499872mm" outerDiameter="0.6096mm" holeDiameter="0.3048mm" layers={["top","bottom"]} />
<via pcbX="-0.499872mm" pcbY="0.499872mm" outerDiameter="0.6096mm" holeDiameter="0.3048mm" layers={["top","bottom"]} />
<via pcbX="-0.499872mm" pcbY="-0.500126mm" outerDiameter="0.6096mm" holeDiameter="0.3048mm" layers={["top","bottom"]} />
<via pcbX="0.500126mm" pcbY="-0.500126mm" outerDiameter="0.6096mm" holeDiameter="0.3048mm" layers={["top","bottom"]} />
<silkscreenpath route={[{"x":2.499994999999899,"y":2.100910200000044},{"x":2.499994999999899,"y":-2.1009101999999302}]} />
<silkscreenpath route={[{"x":-2.5400000000000773,"y":-2.1397722000000385},{"x":-2.5400000000000773,"y":-0.3810000000000855}]} />
<silkscreenpath route={[{"x":-2.5400000000000773,"y":2.1397722000000385},{"x":-2.5400000000000773,"y":0.3809999999999718}]} />
<silkscreenpath route={[{"x":1.9337273999999525,"y":-2.1999955999999656},{"x":1.9664425999999366,"y":-2.1999955999999656}]} />
<silkscreenpath route={[{"x":1.2837413999998262,"y":-2.1999955999999656},{"x":1.3164565999998104,"y":-2.1999955999999656}]} />
<silkscreenpath route={[{"x":0.6337554000000409,"y":-2.1999955999999656},{"x":0.6664706000000251,"y":-2.1999955999999656}]} />
<silkscreenpath route={[{"x":-0.01623060000008536,"y":-2.1999955999999656},{"x":0.01648459999989882,"y":-2.1999955999999656}]} />
<silkscreenpath route={[{"x":-0.6664706000000251,"y":-2.1999955999999656},{"x":-0.6335014000000001,"y":-2.1999955999999656}]} />
<silkscreenpath route={[{"x":-1.316456599999924,"y":-2.1999955999999656},{"x":-1.2837413999999399,"y":-2.1999955999999656}]} />
<silkscreenpath route={[{"x":-1.9664426000000503,"y":-2.1999955999999656},{"x":-1.9337274000000662,"y":-2.1999955999999656}]} />
<silkscreenpath route={[{"x":1.9337273999999525,"y":2.1999955999999656},{"x":1.9664425999999366,"y":2.1999955999999656}]} />
<silkscreenpath route={[{"x":1.2837413999998262,"y":2.1999955999999656},{"x":1.3164565999998104,"y":2.1999955999999656}]} />
<silkscreenpath route={[{"x":0.6337554000000409,"y":2.1999955999999656},{"x":0.6664706000000251,"y":2.1999955999999656}]} />
<silkscreenpath route={[{"x":-0.01623060000008536,"y":2.1999955999999656},{"x":0.01648459999989882,"y":2.1999955999999656}]} />
<silkscreenpath route={[{"x":-0.6664706000000251,"y":2.1999955999999656},{"x":-0.6335014000000001,"y":2.1999955999999656}]} />
<silkscreenpath route={[{"x":-1.316456599999924,"y":2.1999955999999656},{"x":-1.2837413999999399,"y":2.1999955999999656}]} />
<silkscreenpath route={[{"x":-1.9664426000000503,"y":2.1999955999999656},{"x":-1.9337274000000662,"y":2.1999955999999656}]} />
<silkscreenpath route={[{"x":-2.5400000000000773,"y":-0.3810000000000855},{"x":-2.3495000000000346,"y":-0.32995567884188404},{"x":-2.2100443211581933,"y":-0.19049999999992906},{"x":-2.1590000000001055,"y":0},{"x":-2.2100443211581933,"y":0.19050000000004275},{"x":-2.3495000000000346,"y":0.32995567884177035},{"x":-2.5400000000000773,"y":0.3809999999999718}]} />
<silkscreencircle pcbX="-2.032mm" pcbY="-1.651mm" radius="0.150114mm" />
<silkscreencircle pcbX="-2.898902mm" pcbY="-2.859532mm" radius="0.150114mm" />
<silkscreentext text="{NAME}" pcbX="-0.2794mm" pcbY="4.3274mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-2.7499950000001263,"y":3.7500056999999742},{"x":2.749994999999899,"y":3.7500056999999742},{"x":2.749994999999899,"y":-3.7500056999998606},{"x":-2.7499950000001263,"y":-3.7500056999998606},{"x":-2.7499950000001263,"y":3.7500056999999742}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C50506.obj?uuid=534f03d8fe164fbab551f91e5a792e30",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C50506.step?uuid=534f03d8fe164fbab551f91e5a792e30",
        pcbRotationOffset: 90,
        modelOriginPosition: { x: 0, y: 0, z: -0.019205 },
      }}
      {...props}
    />
  )
}