import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["VOUT"],
  pin2: ["L2"],
  pin3: ["PGND"],
  pin4: ["L1"],
  pin5: ["VIN"],
  pin6: ["EN"],
  pin7: ["PS","SYNC"],
  pin8: ["VINA"],
  pin9: ["GND"],
  pin10: ["FB"],
  pin11: ["PAD"]
} as const

const pinAttributes = {
  pin3: {requiresGround: true},
  pin5: {requiresPower: true},
  pin9: {requiresGround: true}
} as const

export const TPS63001DRCR = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C28060"
  ]
}}
      manufacturerPartNumber="TPS63001DRCR"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-1.4873986mm" pcbY="0.9999726mm" width="0.849884mm" height="0.2400046mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-1.4873986mm" pcbY="0.5001006mm" width="0.849884mm" height="0.2400046mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-1.4873986mm" pcbY="-0.0000254mm" width="0.849884mm" height="0.2400046mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="-1.4873986mm" pcbY="-0.4998974mm" width="0.849884mm" height="0.2400046mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="-1.4873986mm" pcbY="-1.0000234mm" width="0.849884mm" height="0.2400046mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="1.5123414mm" pcbY="-1.0000234mm" width="0.7999984mm" height="0.229997mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="1.5123414mm" pcbY="-0.4998974mm" width="0.7999984mm" height="0.229997mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="1.5123414mm" pcbY="-0.0000254mm" width="0.7999984mm" height="0.229997mm" shape="rect" />
<smtpad portHints={["pin11"]} points={[{x: "-0.747522mm", y: "0.890016mm"}, {x: "-0.4575556mm", y: "0.8899906mm"}, {x: "-0.4575556mm", y: "1.7100042mm"}, {x: "-0.1675638mm", y: "1.7100042mm"}, {x: "-0.1675638mm", y: "0.8800084mm"}, {x: "0.1924558mm", y: "0.8800084mm"}, {x: "0.1924558mm", y: "1.7100042mm"}, {x: "0.4824476mm", y: "1.7100042mm"}, {x: "0.4824476mm", y: "0.8800084mm"}, {x: "0.7724394mm", y: "0.8800084mm"}, {x: "0.7724394mm", y: "-0.8899906mm"}, {x: "0.4824476mm", y: "-0.8899906mm"}, {x: "0.4824476mm", y: "-1.7100042mm"}, {x: "0.1924558mm", y: "-1.7100042mm"}, {x: "0.1924558mm", y: "-0.8899906mm"}, {x: "-0.1675638mm", y: "-0.8899906mm"}, {x: "-0.1675638mm", y: "-1.7100042mm"}, {x: "-0.4575556mm", y: "-1.7100042mm"}, {x: "-0.4575556mm", y: "-0.8899906mm"}, {x: "-0.7475474mm", y: "-0.8899906mm"}, {x: "-0.7475474mm", y: "0.8899906mm"}, {x: "-0.747522mm", y: "0.890016mm"}, {x: "-0.747522mm", y: "0.890016mm"}, {x: "-0.747522mm", y: "0.890016mm"}]} shape="polygon" />
<smtpad portHints={["pin10"]} pcbX="1.5123414mm" pcbY="0.9999726mm" width="0.7999984mm" height="0.229997mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="1.5123414mm" pcbY="0.5001006mm" width="0.7999984mm" height="0.229997mm" shape="rect" />
<silkscreenpath route={[{"x":1.5124683999998751,"y":1.4999969999998939},{"x":1.5124683999998751,"y":1.2941299999999956}]} />
<silkscreenpath route={[{"x":1.5124683999998751,"y":-1.2941807999999355},{"x":1.5124683999998751,"y":-1.4999970000000076}]} />
<silkscreenpath route={[{"x":-1.4875509999999394,"y":1.4999969999998939},{"x":-1.4875509999999394,"y":1.349121000000082}]} />
<silkscreenpath route={[{"x":-1.4875509999999394,"y":-1.3491209999999683},{"x":-1.4875509999999394,"y":-1.4999970000000076}]} />
<silkscreenpath route={[{"x":-1.4875509999999394,"y":1.4999969999998939},{"x":-0.6366763999999421,"y":1.4999969999998939}]} />
<silkscreenpath route={[{"x":0.011582400000065718,"y":1.4999969999998939},{"x":0.013335000000097352,"y":1.4999969999998939}]} />
<silkscreenpath route={[{"x":0.6615938000001051,"y":1.4999969999998939},{"x":1.5364713999999822,"y":1.4999969999998939}]} />
<silkscreenpath route={[{"x":1.5124683999998751,"y":-1.4999970000000076},{"x":0.6615938000001051,"y":-1.4999970000000076}]} />
<silkscreenpath route={[{"x":0.013335000000097352,"y":-1.4999970000000076},{"x":0.011582400000065718,"y":-1.4999970000000076}]} />
<silkscreenpath route={[{"x":-0.6366763999999421,"y":-1.4999970000000076},{"x":-1.4875509999999394,"y":-1.4999970000000076}]} />
<silkscreencircle pcbX="-2.1465286mm" pcbY="1.3969746mm" radius="0.055372mm" />
<silkscreentext text="{NAME}" pcbX="-0.1569466mm" pcbY="2.6984726mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-2.162340600000107,"y":1.9600041999999576},{"x":2.162340600000107,"y":1.9600041999999576},{"x":2.162340600000107,"y":-1.9600041999999576},{"x":-2.162340600000107,"y":-1.9600041999999576},{"x":-2.162340600000107,"y":1.9600041999999576}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C28060.obj?uuid=8dabb9c4812942d9a9738a1b03d26cd4",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C28060.step?uuid=8dabb9c4812942d9a9738a1b03d26cd4",
        pcbRotationOffset: 270,
        modelOriginPosition: { x: 0, y: -0.012446000000068125, z: 0 },
      }}
      {...props}
    />
  )
}