import { RootCircuit } from "tscircuit"
import { convertCircuitJsonToSchematicSvg, convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertCircuitJsonToGltf } from "circuit-json-to-gltf"
import { writeFileSync } from "node:fs"
const t0 = performance.now()
const S3 = ["3V3","3V3_2","RST","GPIO4","GPIO5","GPIO6","GPIO7","GPIO15","GPIO16","GPIO17","GPIO18","GPIO8","GPIO3","GPIO46","GPIO9","GPIO10","GPIO11","GPIO12","GPIO13","GPIO14","5V","GND"]
const S3R = ["GND_2","TX","RX","GPIO1","GPIO2","GPIO42","GPIO41","GPIO40","GPIO39","GPIO38","GPIO37","GPIO36","GPIO35","GPIO0","GPIO45","GPIO48","GPIO47","GPIO21","GPIO20","GPIO19","GND_3","GND_4"]
const pinLabels: Record<string,string> = {}
;[...S3, ...S3R].forEach((n,i)=>{ pinLabels[`pin${i+1}`] = n })
const circuit = new RootCircuit()
circuit.add(
  <board width="80mm" height="70mm">
    <chip name="U1" footprint="dip44_w22.86mm" pinLabels={pinLabels} pcbX={-12} />
    <chip name="DISP" footprint="pinrow8" pinLabels={{pin1:"VCC",pin2:"GND",pin3:"DIN",pin4:"CLK",pin5:"CS",pin6:"DC",pin7:"RST",pin8:"BL"}} pcbX={20} pcbY={12} />
    <chip name="ENC" footprint="pinrow5" pinLabels={{pin1:"GND",pin2:"VCC",pin3:"SW",pin4:"DT",pin5:"CLK"}} pcbX={20} pcbY={-12} />
    <trace from=".DISP > .VCC" to=".U1 > .3V3" />
    <trace from=".DISP > .GND" to="net.GND" />
    <trace from=".U1 > .GND" to="net.GND" />
    <trace from=".DISP > .DIN" to=".U1 > .GPIO11" />
    <trace from=".DISP > .CLK" to=".U1 > .GPIO12" />
    <trace from=".DISP > .CS" to=".U1 > .GPIO10" />
    <trace from=".DISP > .DC" to=".U1 > .GPIO9" />
    <trace from=".DISP > .RST" to=".U1 > .GPIO14" />
    <trace from=".DISP > .BL" to=".U1 > .GPIO13" />
    <trace from=".ENC > .GND" to="net.GND" />
    <trace from=".ENC > .VCC" to=".U1 > .3V3_2" />
    <trace from=".ENC > .SW" to=".U1 > .GPIO4" />
    <trace from=".ENC > .DT" to=".U1 > .GPIO5" />
    <trace from=".ENC > .CLK" to=".U1 > .GPIO6" />
  </board>
)
await circuit.renderUntilSettled()
const cj = circuit.getCircuitJson()
const t1 = performance.now()
writeFileSync("out.circuit.json", JSON.stringify(cj))
writeFileSync("sch.svg", convertCircuitJsonToSchematicSvg(cj))
writeFileSync("pcb.svg", convertCircuitJsonToPcbSvg(cj))
const t2 = performance.now()
const glb = await convertCircuitJsonToGltf(cj, { format: "glb" }) as ArrayBuffer
writeFileSync("board.glb", Buffer.from(glb))
const t3 = performance.now()
const errs = cj.filter((e:any)=> String(e.type).includes("error"))
console.log(JSON.stringify({render_ms:Math.round(t1-t0), svg_ms:Math.round(t2-t1), glb_ms:Math.round(t3-t2), elements:cj.length, traces:cj.filter((e:any)=>e.type==="pcb_trace").length, errors:errs.map((e:any)=>e.type+': '+(e.message||'').slice(0,120))},null,1))
