import {Text,Row,States} from './kit'
import type {CSSProperties} from 'react'

// Recorded cached run afecdc51: board + case geometry reused; compile fresh.
const stages=[['Codegen',4],['Render',13],['Route',0],['SVG',0],['GLTF',0],['Fab files',0],['Enclosure',1019],['Firmware',10],['Compile',22507]] as const
const chapters=[{label:'Board',start:0,end:6,x:6,from:6},{label:'Case',start:6,end:7,x:16,from:6},{label:'Firmware',start:7,end:9,x:6,from:16}] as const
const time=(i:number)=>i>=2&&i<=5?'Cached':`${stages[i][1].toLocaleString('en-US')} ms`
function Value({done,running,value,reused=false}:{done:boolean;running:boolean;value:string;reused?:boolean}){
 return <States value={done?'done':running?'running':'queued'} states={{done:<Text className="ws-ms">{value}</Text>,running:<Text className="ws-ms">{reused?'Reusing':'Running'}</Text>,queued:<Text className="ws-ms">Queued</Text>}}/>
}
export function BuildTrace({completed,compact}:{completed:number;compact:boolean}){
 return <section className="ws-steps" aria-label="Recorded build stages">
  {chapters.map((c,n)=>{
   const done=completed>=c.end,running=completed>=c.start&&completed<c.end
   const path=n===0?`M${c.x+1} 0V20`:`M${c.from+1} 0V2L${c.x+1} 12V20`
   return <section key={c.label} className="ws-chapter" style={{'--trace-x':`${c.x}px`} as CSSProperties}>
    <svg className="ws-jog" data-lit={completed>=c.start||undefined} width="26" height="20" viewBox="0 0 26 20" aria-hidden="true"><path d={path}/></svg>
    {compact?<div className="ws-trace-stage" data-done={done||undefined} data-running={running||undefined} data-end={n===2||undefined}>
      <span className="ws-pad" aria-hidden="true"/><Row pad={6} className="ws-trace-row" title={<Text className="ws-step-name">{c.label}</Text>} meta={<Value done={done} running={running} value={n===0?'Cached':n===1?'1,019 ms':'22,517 ms'} reused={n<2}/>}/>
    </div>:<>
     <div className="ws-chapter-label"><Text>{c.label}</Text></div>
     {stages.slice(c.start,c.end).map(([label],offset)=>{
       const i=c.start+offset
       return <div key={label} className="ws-trace-stage" data-done={completed>i||undefined} data-running={completed===i||undefined} data-end={i===8||undefined}>
        <span className="ws-pad" aria-hidden="true"/><Row pad={6} className="ws-trace-row" title={<Text className="ws-step-name">{label}</Text>} meta={<Value done={completed>i} running={completed===i} value={time(i)} reused={i>=2&&i<=6}/>}/>
       </div>
     })}
    </>}
   </section>
  })}
 </section>
}
