import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"],
  pin3: ["pin3"],
  pin4: ["pin4"]
} as const

export const SM02B_SRSS_TB_LF__SN_ = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C160402"
  ]
}}
      manufacturerPartNumber="SM02B-SRSS-TB(LF)(SN)"
      footprint={<footprint>
        <smtpad portHints={["pin4"]} pcbX="-1.799971mm" pcbY="-1.8750153mm" width="1.1999976mm" height="1.7999964mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="1.799971mm" pcbY="-1.8750153mm" width="1.1999976mm" height="1.7999964mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="0.499999mm" pcbY="2.0000087mm" width="0.5999988mm" height="1.5500096mm" shape="rect" />
<smtpad portHints={["pin1"]} pcbX="-0.499999mm" pcbY="2.0000087mm" width="0.5999988mm" height="1.5500096mm" shape="rect" />
<silkscreenpath route={[{"x":-0.9688575999997511,"y":-2.587510699999939},{"x":0.9688576000002058,"y":-2.587510699999939}]} />
<silkscreenpath route={[{"x":-1.9999959999997827,"y":-0.13750289999995857},{"x":-1.9999959999997827,"y":-0.7438517000000502}]} />
<silkscreenpath route={[{"x":1.0311384000000317,"y":1.7125061000001551},{"x":1.9999960000001238,"y":1.7125061000001551},{"x":1.9999960000001238,"y":-0.7438517000000502}]} />
<silkscreenpath route={[{"x":-1.9999959999997827,"y":-0.13750289999995857},{"x":-1.9999959999997827,"y":1.7125061000001551},{"x":-1.031138399999918,"y":1.7125061000001551}]} />
<silkscreentext text="{NAME}" pcbX="-0.009271mm" pcbY="3.7731847mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-2.6499697999998943,"y":3.0250135},{"x":2.649969800000008,"y":3.0250135},{"x":2.649969800000008,"y":-3.0250135},{"x":-2.6499697999998943,"y":-3.0250135},{"x":-2.6499697999998943,"y":3.0250135}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C160402.obj?uuid=b15083895b61401296a20b79cbc50a55",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C160402.step?uuid=b15083895b61401296a20b79cbc50a55",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0.4999999999997726, y: 0.5135125000000245, z: -0.01 },
      }}
      {...props}
    />
  )
}