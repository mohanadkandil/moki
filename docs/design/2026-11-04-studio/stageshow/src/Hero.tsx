import {type ReactNode} from 'react'
import {RotateCcw,ArrowUp,Minus,Maximize} from 'lucide-react'
import {Stage,Window,Text,Draft,Button,Badge,Tabs,Collapse,Icon,type Act} from './kit'
import {Assembly} from './Assembly'
import {BuildTrace} from './BuildTrace'
import './workshop.css'

const Q='a focus timer with a knob and a beep'
type S={draft:string;sent:boolean;completed:number;tab:number;casePhase:number;done:boolean;reset:boolean}
const initial:S={draft:'',sent:false,completed:-1,tab:0,casePhase:0,done:false,reset:false}
const poster:S={draft:Q,sent:true,completed:9,tab:2,casePhase:2,done:true,reset:false}
async function script(a:Act<S>){
  await a.wait(600);a.mark('brief')
  await a.move('brief');await a.click();await a.type('draft',Q,{interval:30});await a.wait(200)
  await a.move('generate');await a.click();await a.set({sent:true,completed:0});a.mark('schematic')
  await a.move('rest',{duration:350})
  for(let i=1;i<=2;i++){await a.wait(200);await a.set({completed:i})}
  await a.wait(900);await a.set({completed:3})
  await a.move('pcb');await a.click();await a.set({tab:1});a.mark('pcb')
  for(let i=4;i<=6;i++){await a.wait(260);await a.set({completed:i})}
  await a.move('rest');await a.wait(750)
  await a.move('three');await a.click();await a.set({tab:2});a.mark('board')
  await a.move('rest');await a.wait(850)
  await a.set({completed:7,casePhase:1});a.mark('enclosure');await a.wait(1100)
  await a.set({casePhase:2,completed:8});a.mark('close');await a.wait(1000)
  await a.set({completed:9,done:true});a.mark('compiled');await a.wait(2200)
  await a.move('replay');await a.click();await a.set({reset:true});a.mark('replay');await a.wait(750)
  await a.snap({...initial,reset:true});a.place('rest');await a.wait(120);await a.set({reset:false});await a.wait(750)
}
function Frame({compact,children}:{compact:boolean;children:ReactNode}){
 const replay=<Button size="small" variant="ghost" data-target="replay" data-cursor="hand" icon={<RotateCcw size={14} strokeWidth={1.5} className="ss-icon"/>}>Replay</Button>
 return compact?<div className="ws-mobile-shell"><div className="ws-mobile-heading"><Text>Workshop / Focus timer</Text>{replay}</div>{children}</div>:<Window title="Workshop / Focus timer" className="ws-window" lights="grey" toolbar={replay}>{children}</Window>
}
export default function Hero({still=false}:{still?:boolean}){return <Stage width={1040} height={700} compact={{below:760,width:358,height:800}} initial={still?poster:initial} poster={poster} script={still?undefined:script} play="loop" className="workshop-hero" fidelity="realistic" greys="cool" cursor={{at:'rest',style:'real',idle:650}}>
  {(s,_rect,layout)=><>
    <Frame compact={layout==='compact'}>
      <div className="ws-workspace">
        <section className="ws-chat">
          <div className="ws-project"><Text className="ws-title">Let’s make a focus timer.</Text><Text className="ws-muted">ESP32 · Rotary encoder · OLED</Text></div>
          <div className="ws-brief">
            <Text className="ws-label">Your brief</Text>
            <Draft value={s.draft} full={Q} editing className={s.sent?'ws-posted':undefined} placeholder="What would you like to make?" data-target="brief" data-cursor="ibeam"/>
            <Collapse open={!s.sent}><div className="ws-generate"><Button data-target="generate" data-cursor="hand" variant="primary" icon={<ArrowUp size={14} strokeWidth={1.5} className="ss-icon"/>}>Generate</Button></div></Collapse>
          </div>
          <BuildTrace completed={s.completed} compact={layout==='compact'}/>
          <Collapse open={s.done} reveal="drop"><div className="ws-summary">Board, enclosure and firmware generated.<br/><span>Fit and device behavior need bench testing.</span></div></Collapse>
          {layout==='wide'&&<div className="ws-disclosure-flow">Recorded build · Board + case geometry cached<br/>24.0 s total · Playback condensed</div>}
        </section>
        <main className="ws-canvas">
          <div className="ws-toolbar"><Tabs items={layout==='compact'?['Schematic','PCB','3D']:['Schematic','PCB','3D','Case','Firmware','Code']} value={s.tab} targets={['schematic','pcb','three']}/></div>
          <div className="ws-view">
            <div className="ws-art ws-schematic" data-visible={s.tab===0||undefined}><img src={`${import.meta.env.BASE_URL}assets/focus-schematic.svg`} alt="Real generated ESP32 focus timer schematic"/></div>
            <div className="ws-art ws-pcb" data-visible={s.tab===1||undefined}><img src={`${import.meta.env.BASE_URL}assets/focus-pcb.svg`} alt="Real generated two-layer PCB with routed traces"/></div>
            <div className="ws-art ws-three" data-visible={s.tab===2||undefined}><Assembly phase={s.casePhase} active={s.tab===2}/></div>
            <div className="ws-tools"><Button size="small" variant="secondary" aria-label="Fit canvas" icon={<Maximize size={14} strokeWidth={1.5} className="ss-icon"/>}/><Button size="small" variant="secondary" aria-label="Zoom in" icon={<Icon name="plus" size={14}/>}/><Button size="small" variant="secondary" aria-label="Zoom out" icon={<Minus size={14} strokeWidth={1.5} className="ss-icon"/>}/></div>
            <div className="ws-template" data-visible={s.completed<2||undefined}><Badge>Template preview · Focus timer</Badge></div>
            <div className="ws-proof" data-visible={s.done||undefined}><Badge tone="success" icon={<span className="ws-proof-mark"><Icon name="check" size={14}/></span>}>Compiled · 24 s</Badge><div>Board + case cached · Not printed or flashed</div></div>
            <span className="ws-rest" data-target="rest"/>
          </div>
          <div className="ws-status"><Text>mm</Text><Text>11 traces · 7 vias</Text><Text>0 DRC errors · Warnings retained</Text></div>
        </main>
      </div>
      <div className="ws-reset" data-on={s.reset||undefined}><img src={`${import.meta.env.BASE_URL}assets/focus-timer-assembly-lid-solid.png`} alt="Generated focus timer enclosure"/><div className="ws-replay-caption"><RotateCcw size={18} strokeWidth={1.5} className="ss-icon"/><Text>Replay demo</Text></div></div>
    </Frame>
    {layout==='compact'&&<div className="ws-disclosure">Recorded build · Board + case geometry cached<br/>24.0 s total · Playback condensed</div>}
  </>}
</Stage>}
