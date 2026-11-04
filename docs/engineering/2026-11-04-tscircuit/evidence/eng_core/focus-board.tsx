// Generated module carrier: verify actual module dimensions before fabrication.
// @jsxRuntime automatic
// @jsxImportSource react
export const boardMetadata = {"widthMm":90,"heightMm":100,"layers":2,"dimensionsVerified":false,"mountingHoles":[{"x":-41,"y":-46,"diameterMm":3.2},{"x":-41,"y":46,"diameterMm":3.2},{"x":41,"y":-46,"diameterMm":3.2},{"x":41,"y":46,"diameterMm":3.2}],"parts":[{"id":"BZ1","module":"piezo-passive-12mm","x":20,"y":-1.3,"widthMm":12,"heightMm":13,"pins":[{"id":"+","x":17.5,"y":-7.8},{"id":"-","x":22.5,"y":-7.8}]},{"id":"SW1","module":"ky040-rotary-encoder","x":20,"y":-25.3,"widthMm":32,"heightMm":19,"pins":[{"id":"GND","x":34.6,"y":-20.2},{"id":"VCC","x":34.6,"y":-22.74},{"id":"SW","x":34.6,"y":-25.28},{"id":"DT","x":34.6,"y":-27.82},{"id":"CLK","x":34.6,"y":-30.36}]},{"id":"U1","module":"esp32-devkitc-v4","x":-22.05,"y":-22.8,"widthMm":27.9,"heightMm":54.4,"pins":[{"id":"3V3","x":-34.75,"y":-2.5},{"id":"EN","x":-34.75,"y":-5.04},{"id":"GPIO36","x":-34.75,"y":-7.58},{"id":"GPIO39","x":-34.75,"y":-10.12},{"id":"GPIO34","x":-34.75,"y":-12.66},{"id":"GPIO35","x":-34.75,"y":-15.2},{"id":"GPIO32","x":-34.75,"y":-17.74},{"id":"GPIO33","x":-34.75,"y":-20.28},{"id":"GPIO25","x":-34.75,"y":-22.82},{"id":"GPIO26","x":-34.75,"y":-25.36},{"id":"GPIO27","x":-34.75,"y":-27.9},{"id":"GPIO14","x":-34.75,"y":-30.44},{"id":"GPIO12","x":-34.75,"y":-32.98},{"id":"GND","x":-34.75,"y":-35.52},{"id":"GPIO13","x":-34.75,"y":-38.06},{"id":"GPIO9","x":-34.75,"y":-40.6},{"id":"GPIO10","x":-34.75,"y":-43.14},{"id":"GPIO11","x":-34.75,"y":-45.68},{"id":"5V","x":-34.75,"y":-48.22},{"id":"GND2","x":-9.35,"y":-2.5},{"id":"GPIO23","x":-9.35,"y":-5.04},{"id":"GPIO22","x":-9.35,"y":-7.58},{"id":"GPIO1","x":-9.35,"y":-10.12},{"id":"GPIO3","x":-9.35,"y":-12.66},{"id":"GPIO21","x":-9.35,"y":-15.2},{"id":"GND3","x":-9.35,"y":-17.74},{"id":"GPIO19","x":-9.35,"y":-20.28},{"id":"GPIO18","x":-9.35,"y":-22.82},{"id":"GPIO5","x":-9.35,"y":-25.36},{"id":"GPIO17","x":-9.35,"y":-27.9},{"id":"GPIO16","x":-9.35,"y":-30.44},{"id":"GPIO4","x":-9.35,"y":-32.98},{"id":"GPIO0","x":-9.35,"y":-35.52},{"id":"GPIO2","x":-9.35,"y":-38.06},{"id":"GPIO15","x":-9.35,"y":-40.6},{"id":"GPIO8","x":-9.35,"y":-43.14},{"id":"GPIO7","x":-9.35,"y":-45.68},{"id":"GPIO6","x":-9.35,"y":-48.22}]},{"id":"U2","module":"ssd1306-oled-128x64-i2c","x":20,"y":27.1,"widthMm":27.3,"heightMm":27.8,"pins":[{"id":"GND","x":16.19,"y":39.4},{"id":"VCC","x":18.73,"y":39.4},{"id":"SCL","x":21.27,"y":39.4},{"id":"SDA","x":23.81,"y":39.4}]}]};
export default function Board() {
  return <board width={90} height={100} layers={2} schAutoLayoutEnabled autorouter="auto">
    <chip name={"BZ1"} manufacturerPartNumber={"Passive piezo transducer, 12 mm (through-hole)"} pinLabels={{"pin1":"PLUS","pin2":"MINUS"}} cadModel={{"jscad":{"type":"union","shapes":[{"type":"colorize","color":[0.03,0.03,0.04],"shape":{"type":"cylinder","radius":6,"height":9.5,"center":[0,-6.5,4.75],"segments":28}}]},"modelOriginPosition":{"x":0,"y":0,"z":0}}} pcbX={20} pcbY={-1.3} schX={3.5} schY={3} footprint={<footprint>
      <platedhole portHints={["pin1"]} pcbX={-2.5} pcbY={-6.5} holeDiameter={0.8} outerDiameter={1.6} shape="circle" />
      <platedhole portHints={["pin2"]} pcbX={2.5} pcbY={-6.5} holeDiameter={0.8} outerDiameter={1.6} shape="circle" />
      <silkscreenrect pcbX={0} pcbY={0} width={12} height={13} strokeWidth={0.15} />
    </footprint>} />
    <silkscreentext text={"BZ1 Chimes when a session ends."} pcbX={20} pcbY={6.7} fontSize={0.8} />
    <chip name={"SW1"} manufacturerPartNumber={"KY-040 rotary encoder (female-header)"} pinLabels={{"pin1":"GND","pin2":"VCC","pin3":"SW","pin4":"DT","pin5":"CLK"}} cadModel={{"jscad":{"type":"union","shapes":[{"type":"colorize","color":[0.05,0.05,0.06],"shape":{"type":"cuboid","size":[2.54,12.7,8.5],"center":[14.600000000000001,0.019999999999999574,4.25]}},{"type":"colorize","color":[0.1,0.1,0.11],"shape":{"type":"cuboid","size":[2.54,12.7,2.539999999999999],"center":[14.600000000000001,0.019999999999999574,9.77]}},{"type":"colorize","color":[0.08,0.14,0.1],"shape":{"type":"cuboid","size":[32,19,1.5999999999999996],"center":[0,0,11.84]}},{"type":"colorize","color":[0.72,0.73,0.75],"shape":{"type":"cuboid","size":[12.4,12.4,6.6],"center":[-6.800000000000001,0,15.939999999999998]}},{"type":"colorize","color":[0.72,0.73,0.75],"shape":{"type":"cylinder","radius":3.5,"height":5.400000000000002,"center":[-6.800000000000001,0,21.939999999999998],"segments":28}},{"type":"colorize","color":[0.72,0.73,0.75],"shape":{"type":"cylinder","radius":3,"height":8,"center":[-6.800000000000001,0,28.64],"segments":28}}]},"modelOriginPosition":{"x":0,"y":0,"z":0}}} pcbX={20} pcbY={-25.3} schX={3.5} schY={0} footprint={<footprint>
      <platedhole portHints={["pin1"]} pcbX={14.6} pcbY={5.1} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin2"]} pcbX={14.6} pcbY={2.56} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin3"]} pcbX={14.6} pcbY={0.02} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin4"]} pcbX={14.6} pcbY={-2.52} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin5"]} pcbX={14.6} pcbY={-5.06} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <silkscreenrect pcbX={0} pcbY={0} width={32} height={19} strokeWidth={0.15} />
    </footprint>} />
    <silkscreentext text={"SW1 Turn to set the time; press to start o"} pcbX={20} pcbY={-14.3} fontSize={0.8} />
    <chip name={"U1"} manufacturerPartNumber={"ESP32-DevKitC V4 (female-header)"} pinLabels={{"pin1":"3V3","pin2":"EN","pin3":"GPIO36","pin4":"GPIO39","pin5":"GPIO34","pin6":"GPIO35","pin7":"GPIO32","pin8":"GPIO33","pin9":"GPIO25","pin10":"GPIO26","pin11":"GPIO27","pin12":"GPIO14","pin13":"GPIO12","pin14":"GND","pin15":"GPIO13","pin16":"GPIO9","pin17":"GPIO10","pin18":"GPIO11","pin19":"5V","pin20":"GND2","pin21":"GPIO23","pin22":"GPIO22","pin23":"GPIO1","pin24":"GPIO3","pin25":"GPIO21","pin26":"GND3","pin27":"GPIO19","pin28":"GPIO18","pin29":"GPIO5","pin30":"GPIO17","pin31":"GPIO16","pin32":"GPIO4","pin33":"GPIO0","pin34":"GPIO2","pin35":"GPIO15","pin36":"GPIO8","pin37":"GPIO7","pin38":"GPIO6"}} cadModel={{"jscad":{"type":"union","shapes":[{"type":"colorize","color":[0.05,0.05,0.06],"shape":{"type":"cuboid","size":[2.54,48.26,8.5],"center":[-12.7,-2.5600000000000023,4.25]}},{"type":"colorize","color":[0.05,0.05,0.06],"shape":{"type":"cuboid","size":[2.54,48.26,8.5],"center":[12.7,-2.5600000000000023,4.25]}},{"type":"colorize","color":[0.1,0.1,0.11],"shape":{"type":"cuboid","size":[2.54,48.26,2.539999999999999],"center":[-12.7,-2.5600000000000023,9.77]}},{"type":"colorize","color":[0.1,0.1,0.11],"shape":{"type":"cuboid","size":[2.54,48.26,2.539999999999999],"center":[12.7,-2.5600000000000023,9.77]}},{"type":"colorize","color":[0.06,0.07,0.08],"shape":{"type":"cuboid","size":[27.9,54.4,1.5999999999999996],"center":[0,0,11.84]}},{"type":"colorize","color":[0.72,0.73,0.75],"shape":{"type":"cuboid","size":[16.1,17.6,3.200000000000001],"center":[0,10.8,14.239999999999998]}},{"type":"colorize","color":[0.08,0.14,0.1],"shape":{"type":"cuboid","size":[18,6.6,0.8000000000000007],"center":[0,23,13.04]}},{"type":"colorize","color":[0.72,0.73,0.75],"shape":{"type":"cuboid","size":[7.6,6.2,3],"center":[0,-25.599999999999998,14.139999999999999]}},{"type":"colorize","color":[0.1,0.1,0.11],"shape":{"type":"cuboid","size":[2.6,2.6,3.5000000000000018],"center":[-7.249999999999999,-24.3,14.39]}},{"type":"colorize","color":[0.1,0.1,0.11],"shape":{"type":"cuboid","size":[2.6,2.6,3.5000000000000018],"center":[7.25,-24.3,14.39]}}]},"modelOriginPosition":{"x":0,"y":0,"z":0}}} pcbX={-22.05} pcbY={-22.8} schX={-3.5} schY={0} footprint={<footprint>
      <platedhole portHints={["pin1"]} pcbX={-12.7} pcbY={20.3} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin2"]} pcbX={-12.7} pcbY={17.76} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin3"]} pcbX={-12.7} pcbY={15.22} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin4"]} pcbX={-12.7} pcbY={12.68} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin5"]} pcbX={-12.7} pcbY={10.14} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin6"]} pcbX={-12.7} pcbY={7.6} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin7"]} pcbX={-12.7} pcbY={5.06} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin8"]} pcbX={-12.7} pcbY={2.52} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin9"]} pcbX={-12.7} pcbY={-0.02} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin10"]} pcbX={-12.7} pcbY={-2.56} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin11"]} pcbX={-12.7} pcbY={-5.1} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin12"]} pcbX={-12.7} pcbY={-7.64} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin13"]} pcbX={-12.7} pcbY={-10.18} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin14"]} pcbX={-12.7} pcbY={-12.72} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin15"]} pcbX={-12.7} pcbY={-15.26} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin16"]} pcbX={-12.7} pcbY={-17.8} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin17"]} pcbX={-12.7} pcbY={-20.34} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin18"]} pcbX={-12.7} pcbY={-22.88} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin19"]} pcbX={-12.7} pcbY={-25.42} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin20"]} pcbX={12.7} pcbY={20.3} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin21"]} pcbX={12.7} pcbY={17.76} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin22"]} pcbX={12.7} pcbY={15.22} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin23"]} pcbX={12.7} pcbY={12.68} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin24"]} pcbX={12.7} pcbY={10.14} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin25"]} pcbX={12.7} pcbY={7.6} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin26"]} pcbX={12.7} pcbY={5.06} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin27"]} pcbX={12.7} pcbY={2.52} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin28"]} pcbX={12.7} pcbY={-0.02} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin29"]} pcbX={12.7} pcbY={-2.56} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin30"]} pcbX={12.7} pcbY={-5.1} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin31"]} pcbX={12.7} pcbY={-7.64} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin32"]} pcbX={12.7} pcbY={-10.18} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin33"]} pcbX={12.7} pcbY={-12.72} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin34"]} pcbX={12.7} pcbY={-15.26} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin35"]} pcbX={12.7} pcbY={-17.8} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin36"]} pcbX={12.7} pcbY={-20.34} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin37"]} pcbX={12.7} pcbY={-22.88} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin38"]} pcbX={12.7} pcbY={-25.42} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <silkscreenrect pcbX={0} pcbY={0} width={27.9} height={54.4} strokeWidth={0.15} />
    </footprint>} />
    <silkscreentext text={"U1 Runs the firmware and supplies 3.3 V f"} pcbX={-22.05} pcbY={5.9} fontSize={0.8} />
    <chip name={"U2"} manufacturerPartNumber={"0.96″ OLED, SSD1306, I²C (female-header)"} pinLabels={{"pin1":"GND","pin2":"VCC","pin3":"SCL","pin4":"SDA"}} cadModel={{"jscad":{"type":"union","shapes":[{"type":"colorize","color":[0.05,0.05,0.06],"shape":{"type":"cuboid","size":[10.16,2.54,8.5],"center":[0,12.3,4.25]}},{"type":"colorize","color":[0.1,0.1,0.11],"shape":{"type":"cuboid","size":[10.16,2.54,2.539999999999999],"center":[0,12.3,9.77]}},{"type":"colorize","color":[0.08,0.2,0.55],"shape":{"type":"cuboid","size":[27.3,27.8,1.1999999999999993],"center":[0,0,11.639999999999999]}},{"type":"colorize","color":[0.03,0.03,0.04],"shape":{"type":"cuboid","size":[26,18.6,2.880000000000001],"center":[0,-0.6999999999999993,13.68]}},{"type":"colorize","color":[0.2,0.75,1],"shape":{"type":"cuboid","size":[21.744,10.864,0.019999999999999574],"center":[0,1.3000000000000007,15.129999999999999]}}]},"modelOriginPosition":{"x":0,"y":0,"z":0}}} pcbX={20} pcbY={27.1} schX={3.5} schY={-3} footprint={<footprint>
      <platedhole portHints={["pin1"]} pcbX={-3.81} pcbY={12.3} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin2"]} pcbX={-1.27} pcbY={12.3} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin3"]} pcbX={1.27} pcbY={12.3} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <platedhole portHints={["pin4"]} pcbX={3.81} pcbY={12.3} holeDiameter={1} outerDiameter={1.8} shape="circle" />
      <silkscreenrect pcbX={0} pcbY={0} width={27.3} height={27.8} strokeWidth={0.15} />
    </footprint>} />
    <silkscreentext text={"U2 Shows the time left in the session."} pcbX={20} pcbY={42.5} fontSize={0.8} />
    <net name={"PLUS_3V3"} />
    <trace from={".SW1 > .pin2"} to={"net.PLUS_3V3"} />
    <trace from={".U1 > .pin1"} to={"net.PLUS_3V3"} />
    <trace from={".U2 > .pin2"} to={"net.PLUS_3V3"} />
    <net name={"BUZZER"} />
    <trace from={".BZ1 > .pin1"} to={"net.BUZZER"} />
    <trace from={".U1 > .pin21"} to={"net.BUZZER"} />
    <net name={"ENC_A"} />
    <trace from={".SW1 > .pin5"} to={"net.ENC_A"} />
    <trace from={".U1 > .pin7"} to={"net.ENC_A"} />
    <net name={"ENC_B"} />
    <trace from={".SW1 > .pin4"} to={"net.ENC_B"} />
    <trace from={".U1 > .pin8"} to={"net.ENC_B"} />
    <net name={"ENC_SW"} />
    <trace from={".SW1 > .pin3"} to={"net.ENC_SW"} />
    <trace from={".U1 > .pin11"} to={"net.ENC_SW"} />
    <net name={"GND"} />
    <trace from={".BZ1 > .pin2"} to={"net.GND"} />
    <trace from={".SW1 > .pin1"} to={"net.GND"} />
    <trace from={".U1 > .pin14"} to={"net.GND"} />
    <trace from={".U2 > .pin1"} to={"net.GND"} />
    <net name={"I2C_SCL"} />
    <trace from={".U1 > .pin22"} to={"net.I2C_SCL"} />
    <trace from={".U2 > .pin3"} to={"net.I2C_SCL"} />
    <net name={"I2C_SDA"} />
    <trace from={".U1 > .pin25"} to={"net.I2C_SDA"} />
    <trace from={".U2 > .pin4"} to={"net.I2C_SDA"} />
    <hole pcbX={-41} pcbY={-46} diameter={3.2} />
    <hole pcbX={-41} pcbY={46} diameter={3.2} />
    <hole pcbX={41} pcbY={-46} diameter={3.2} />
    <hole pcbX={41} pcbY={46} diameter={3.2} />
    <silkscreentext text={"moki 51277b548fda193f"} pcbX={0} pcbY={47} fontSize={1} />
  </board>;
}
