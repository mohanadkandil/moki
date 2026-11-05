import * as React from 'react'
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["GND1"],
  pin2: ["3V3"],
  pin3: ["EN"],
  pin4: ["IO4"],
  pin5: ["IO5"],
  pin6: ["IO6"],
  pin7: ["IO7"],
  pin8: ["IO15"],
  pin9: ["IO16"],
  pin10: ["IO17"],
  pin11: ["IO18"],
  pin12: ["IO8"],
  pin13: ["IO19"],
  pin14: ["IO20"],
  pin15: ["IO3"],
  pin16: ["IO46"],
  pin17: ["IO9"],
  pin18: ["IO10"],
  pin19: ["IO11"],
  pin20: ["IO12"],
  pin21: ["IO13"],
  pin22: ["IO14"],
  pin23: ["IO21"],
  pin24: ["IO47"],
  pin25: ["IO48"],
  pin26: ["IO45"],
  pin27: ["IO0"],
  pin28: ["IO35"],
  pin29: ["IO36"],
  pin30: ["IO37"],
  pin31: ["IO38"],
  pin32: ["IO39"],
  pin33: ["IO40"],
  pin34: ["IO41"],
  pin35: ["IO42"],
  pin36: ["RXD0"],
  pin37: ["TXD0"],
  pin38: ["IO2"],
  pin39: ["IO1"],
  pin40: ["GND2"],
  pin41: ["EP"]
} as const

const pinAttributes = {
  pin1: {requiresGround: true},
  pin40: {requiresGround: true}
} as const

export const ESP32_S3_WROOM_1_N8 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      symbol={
        <symbol>
          <schematicrect schX={-0.05} schY={0.1} width={3.1} height={4.6} strokeWidth={0.02} color="#880000" />
          <schematiccircle center={{ x: -1.5, y: 1.1 }} radius={0.03} strokeWidth={0.02} color="#880000" isFilled fillColor="#880000" />
          <port name="pin1" pinNumber={1} aliases={["GND1"]} direction="left" schX={-1.8} schY={1} schStemLength={0.2} />
          <port name="pin2" pinNumber={2} aliases={["3V3"]} direction="left" schX={-1.8} schY={0.8} schStemLength={0.2} />
          <port name="pin3" pinNumber={3} aliases={["EN"]} direction="left" schX={-1.8} schY={0.6} schStemLength={0.2} />
          <port name="pin4" pinNumber={4} aliases={["IO4"]} direction="left" schX={-1.8} schY={0.4} schStemLength={0.2} />
          <port name="pin5" pinNumber={5} aliases={["IO5"]} direction="left" schX={-1.8} schY={0.2} schStemLength={0.2} />
          <port name="pin6" pinNumber={6} aliases={["IO6"]} direction="left" schX={-1.8} schY={0} schStemLength={0.2} />
          <port name="pin7" pinNumber={7} aliases={["IO7"]} direction="left" schX={-1.8} schY={-0.2} schStemLength={0.2} />
          <port name="pin8" pinNumber={8} aliases={["IO15"]} direction="left" schX={-1.8} schY={-0.4} schStemLength={0.2} />
          <port name="pin9" pinNumber={9} aliases={["IO16"]} direction="left" schX={-1.8} schY={-0.6} schStemLength={0.2} />
          <port name="pin10" pinNumber={10} aliases={["IO17"]} direction="left" schX={-1.8} schY={-0.8} schStemLength={0.2} />
          <port name="pin11" pinNumber={11} aliases={["IO18"]} direction="left" schX={-1.8} schY={-1} schStemLength={0.2} />
          <port name="pin12" pinNumber={12} aliases={["IO8"]} direction="left" schX={-1.8} schY={-1.2} schStemLength={0.2} />
          <port name="pin13" pinNumber={13} aliases={["IO19"]} direction="left" schX={-1.8} schY={-1.4} schStemLength={0.2} />
          <port name="pin14" pinNumber={14} aliases={["IO20"]} direction="left" schX={-1.8} schY={-1.6} schStemLength={0.2} />
          <port name="pin15" pinNumber={15} aliases={["IO3"]} direction="down" schX={-1.1} schY={-2.4} schStemLength={0.2} />
          <port name="pin16" pinNumber={16} aliases={["IO46"]} direction="down" schX={-0.9} schY={-2.4} schStemLength={0.2} />
          <port name="pin17" pinNumber={17} aliases={["IO9"]} direction="down" schX={-0.7} schY={-2.4} schStemLength={0.2} />
          <port name="pin18" pinNumber={18} aliases={["IO10"]} direction="down" schX={-0.5} schY={-2.4} schStemLength={0.2} />
          <port name="pin19" pinNumber={19} aliases={["IO11"]} direction="down" schX={-0.3} schY={-2.4} schStemLength={0.2} />
          <port name="pin20" pinNumber={20} aliases={["IO12"]} direction="down" schX={-0.1} schY={-2.4} schStemLength={0.2} />
          <port name="pin21" pinNumber={21} aliases={["IO13"]} direction="down" schX={0.1} schY={-2.4} schStemLength={0.2} />
          <port name="pin22" pinNumber={22} aliases={["IO14"]} direction="down" schX={0.3} schY={-2.4} schStemLength={0.2} />
          <port name="pin23" pinNumber={23} aliases={["IO21"]} direction="down" schX={0.5} schY={-2.4} schStemLength={0.2} />
          <port name="pin24" pinNumber={24} aliases={["IO47"]} direction="down" schX={0.7} schY={-2.4} schStemLength={0.2} />
          <port name="pin25" pinNumber={25} aliases={["IO48"]} direction="down" schX={0.9} schY={-2.4} schStemLength={0.2} />
          <port name="pin26" pinNumber={26} aliases={["IO45"]} direction="down" schX={1.1} schY={-2.4} schStemLength={0.2} />
          <port name="pin27" pinNumber={27} aliases={["IO0"]} direction="right" schX={1.7} schY={-1.5} schStemLength={0.2} />
          <port name="pin28" pinNumber={28} aliases={["IO35"]} direction="right" schX={1.7} schY={-1.3} schStemLength={0.2} />
          <port name="pin29" pinNumber={29} aliases={["IO36"]} direction="right" schX={1.7} schY={-1.1} schStemLength={0.2} />
          <port name="pin30" pinNumber={30} aliases={["IO37"]} direction="right" schX={1.7} schY={-0.9} schStemLength={0.2} />
          <port name="pin31" pinNumber={31} aliases={["IO38"]} direction="right" schX={1.7} schY={-0.7} schStemLength={0.2} />
          <port name="pin32" pinNumber={32} aliases={["IO39"]} direction="right" schX={1.7} schY={-0.5} schStemLength={0.2} />
          <port name="pin33" pinNumber={33} aliases={["IO40"]} direction="right" schX={1.7} schY={-0.3} schStemLength={0.2} />
          <port name="pin34" pinNumber={34} aliases={["IO41"]} direction="right" schX={1.7} schY={-0.1} schStemLength={0.2} />
          <port name="pin35" pinNumber={35} aliases={["IO42"]} direction="right" schX={1.7} schY={0.1} schStemLength={0.2} />
          <port name="pin36" pinNumber={36} aliases={["RXD0"]} direction="right" schX={1.7} schY={0.3} schStemLength={0.2} />
          <port name="pin37" pinNumber={37} aliases={["TXD0"]} direction="right" schX={1.7} schY={0.5} schStemLength={0.2} />
          <port name="pin38" pinNumber={38} aliases={["IO2"]} direction="right" schX={1.7} schY={0.7} schStemLength={0.2} />
          <port name="pin39" pinNumber={39} aliases={["IO1"]} direction="right" schX={1.7} schY={0.9} schStemLength={0.2} />
          <port name="pin40" pinNumber={40} aliases={["GND2"]} direction="right" schX={1.7} schY={1.1} schStemLength={0.2} />
          <schematicpath points={[{"x":-1.6,"y":1.2},{"x":1.5,"y":1.2}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-1.3,"y":1.2},{"x":-1.3,"y":2.2},{"x":-0.7,"y":2.2},{"x":-0.7,"y":1.6},{"x":-0.3,"y":1.6},{"x":-0.3,"y":2.2},{"x":0,"y":2.2},{"x":0,"y":1.6},{"x":0.3,"y":1.6},{"x":0.3,"y":2.2},{"x":1,"y":2.2}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-1,"y":1.4},{"x":-1,"y":2.2}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-1,"y":1.4},{"x":-1,"y":1.2}]} strokeColor="#880000" />
          <port name="pin41" pinNumber={41} aliases={["EP"]} direction="right" schX={1.7} schY={-1.9} schStemLength={0.2} />
          <schematictext schX={-0.051} schY={2.6} text="{NAME}" fontSize={0.2} anchor="bottom_center" />
        </symbol>
      }
      supplierPartNumbers={{
  "jlcpcb": [
    "C2913198"
  ]
}}
      manufacturerPartNumber="ESP32-S3-WROOM-1-N8"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-8.899779mm" pcbY="9.1046427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-8.899779mm" pcbY="7.8346427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-8.899779mm" pcbY="6.5646427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="-8.899779mm" pcbY="5.2946427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="-8.899779mm" pcbY="4.0246427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="-8.899779mm" pcbY="2.7546427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="-8.899779mm" pcbY="1.4846427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="-8.899779mm" pcbY="0.2146427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="-8.899779mm" pcbY="-1.0553573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin10"]} pcbX="-8.899779mm" pcbY="-2.3253573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin11"]} pcbX="-8.899779mm" pcbY="-3.5953573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin12"]} pcbX="-8.899779mm" pcbY="-4.8653573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin13"]} pcbX="-8.899779mm" pcbY="-6.1353573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin14"]} pcbX="-8.899779mm" pcbY="-7.4053573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin15"]} pcbX="-6.984873mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin16"]} pcbX="-5.714873mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin17"]} pcbX="-4.444873mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin18"]} pcbX="-3.174873mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin19"]} pcbX="-1.904873mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin20"]} pcbX="-0.634873mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin21"]} pcbX="0.635127mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin22"]} pcbX="1.905127mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin23"]} pcbX="3.175127mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin24"]} pcbX="4.445127mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin25"]} pcbX="5.715127mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin26"]} pcbX="6.985127mm" pcbY="-8.8046433mm" width="0.8999982mm" height="1.499997mm" shape="rect" />
<smtpad portHints={["pin27"]} pcbX="8.899779mm" pcbY="-7.4053573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin28"]} pcbX="8.899779mm" pcbY="-6.1353573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin29"]} pcbX="8.899779mm" pcbY="-4.8653573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin30"]} pcbX="8.899779mm" pcbY="-3.5953573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin31"]} pcbX="8.899779mm" pcbY="-2.3253573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin32"]} pcbX="8.899779mm" pcbY="-1.0553573mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin33"]} pcbX="8.899779mm" pcbY="0.2146427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin34"]} pcbX="8.899779mm" pcbY="1.4846427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin35"]} pcbX="8.899779mm" pcbY="2.7546427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin36"]} pcbX="8.899779mm" pcbY="4.0246427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin37"]} pcbX="8.899779mm" pcbY="5.2946427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin38"]} pcbX="8.899779mm" pcbY="6.5646427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin39"]} pcbX="8.899779mm" pcbY="7.8346427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin40"]} pcbX="8.899779mm" pcbY="9.1046427mm" width="1.499997mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-1.499489mm" pcbY="1.3850747mm" width="0.8999982mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-2.899537mm" pcbY="1.3850747mm" width="0.8999982mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-0.099441mm" pcbY="1.3850747mm" width="0.8999982mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-0.099441mm" pcbY="2.7851227mm" width="0.8999982mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-1.499489mm" pcbY="2.7851227mm" width="0.8999982mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-2.899537mm" pcbY="2.7851227mm" width="0.8999982mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-2.899537mm" pcbY="-0.0149733mm" width="0.8999982mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-1.499489mm" pcbY="-0.0149733mm" width="0.8999982mm" height="0.8999982mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-0.099441mm" pcbY="-0.0149733mm" width="0.8999982mm" height="0.8999982mm" shape="rect" />
<via pcbX="-1.499743mm" pcbY="2.0850987mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-1.499743mm" pcbY="0.6850507mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-0.099695mm" pcbY="0.6850507mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-0.099695mm" pcbY="2.0850987mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-0.799719mm" pcbY="2.7851227mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-0.799719mm" pcbY="1.3850747mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-0.799719mm" pcbY="-0.0149733mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-2.899791mm" pcbY="0.6850507mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-2.899791mm" pcbY="2.0850987mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-2.199767mm" pcbY="2.7851227mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-2.199767mm" pcbY="1.3850747mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<via pcbX="-2.199767mm" pcbY="-0.0149733mm" outerDiameter="0.3999992mm" holeDiameter="0.2499868mm" layers={["top","bottom"]} />
<silkscreenpath route={[{"x":-8.99998200000016,"y":11.415001299999858},{"x":8.999981999999932,"y":11.415001299999858}]} />
<silkscreenpath route={[{"x":-8.99998200000016,"y":9.785743699999784},{"x":-8.99998200000016,"y":11.195240499999954}]} />
<silkscreenpath route={[{"x":-7.666151799999966,"y":-8.904719300000124},{"x":-8.99998200000016,"y":-8.904719300000124},{"x":-8.99998200000016,"y":-8.086534500000198}]} />
<silkscreenpath route={[{"x":8.999981999999932,"y":-8.086534500000198},{"x":8.999981999999932,"y":-8.904719300000124},{"x":7.666151799999966,"y":-8.904719300000124}]} />
<silkscreenpath route={[{"x":-8.99998200000016,"y":11.145253299999922},{"x":-8.99998200000016,"y":16.59522969999989},{"x":8.999981999999932,"y":16.59522969999989},{"x":8.999981999999932,"y":9.785743699999784}]} />
<silkscreentext text="{NAME}" pcbX="0.014097mm" pcbY="17.6271067mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-9.899777500000027,"y":16.849954099999877},{"x":9.899777500000027,"y":16.849954099999877},{"x":9.899777500000027,"y":-9.804641800000013},{"x":-9.899777500000027,"y":-9.804641800000013},{"x":-9.899777500000027,"y":16.849954099999877}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2913198.obj?uuid=2f67d4cc1ff84f7d9c05d11f6667143a",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2913198.step?uuid=2f67d4cc1ff84f7d9c05d11f6667143a",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: -3.8499795999998696, z: -0.01 },
      }}
      {...props}
    />
  )
}