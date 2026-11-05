import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"],
  pin3: ["pin3"],
  pin4: ["pin4"]
} as const

export const B2B_PH_SM4_TB_LF__SN_ = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C160352"
  ]
}}
      manufacturerPartNumber="B2B-PH-SM4-TB(LF)(SN)"
      footprint={<footprint>
        <smtpad portHints={["pin2"]} pcbX="-0.997966mm" pcbY="0.5064633mm" width="0.999998mm" height="5.999988mm" shape="rect" />
<smtpad portHints={["pin1"]} pcbX="1.00203mm" pcbY="0.5064633mm" width="0.999998mm" height="5.999988mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-3.350006mm" pcbY="-1.8064607mm" width="1.7999964mm" height="3.3999932mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="3.350006mm" pcbY="-1.8064607mm" width="1.7999964mm" height="3.3999932mm" shape="rect" />
<silkscreenpath route={[{"x":3.9999919999999065,"y":-3.737673500000028},{"x":3.9999919999999065,"y":-4.6930183000000625}]} />
<silkscreenpath route={[{"x":3.9999919999999065,"y":0.7069455000000744},{"x":3.9999919999999065,"y":0.12459969999997611}]} />
<silkscreenpath route={[{"x":-3.99999200000002,"y":-3.737673500000028},{"x":-3.99999200000002,"y":-4.6930183000000625}]} />
<silkscreenpath route={[{"x":-3.99999200000002,"y":0.7069455000000744},{"x":-3.99999200000002,"y":0.12459969999997611}]} />
<silkscreenpath route={[{"x":3.9999919999999065,"y":-4.6930183000000625},{"x":-3.99999200000002,"y":-4.6930183000000625}]} />
<silkscreenpath route={[{"x":1.9999959999998964,"y":0.7069455000000744},{"x":3.9999919999999065,"y":0.7069455000000744}]} />
<silkscreenpath route={[{"x":-3.99999200000002,"y":0.7069455000000744},{"x":-1.99999600000001,"y":0.7069455000000744}]} />
<silkscreentext text="{NAME}" pcbX="0.0127mm" pcbY="4.4955353mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-4.500004200000035,"y":3.7564572999999655},{"x":4.500004199999921,"y":3.7564572999999655},{"x":4.500004199999921,"y":-4.969002499999988},{"x":-4.500004200000035,"y":-4.969002499999988},{"x":-4.500004200000035,"y":3.7564572999999655}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C160352.obj?uuid=da579f7d56c247789310da6faac6a909",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C160352.step?uuid=da579f7d56c247789310da6faac6a909",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 2.0190099000000146, z: 0 },
      }}
      {...props}
    />
  )
}