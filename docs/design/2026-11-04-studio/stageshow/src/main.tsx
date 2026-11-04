import React,{useState,lazy,Suspense} from 'react'
import {createRoot} from 'react-dom/client'
const HeroGold=lazy(()=>import('../examples/hero-demo'))
const StillGold=lazy(()=>import('../examples/static-card'))
import Hero from './Hero'
import Comparison from './Comparison'

import './host.css'
const capture=new URLSearchParams(location.search).get('capture')
function App(){const [run,setRun]=useState(0);const [still,setStill]=useState(false)
 if(capture)return <div className={`capture capture-${capture}`}>{capture==='gold'?<Suspense fallback={null}><HeroGold/></Suspense>:capture==='gold-still'?<Suspense fallback={null}><StillGold/></Suspense>:capture==='comparison'?<Comparison/>:<Hero key={run} still={still}/>}</div>
 return <main className="demo-host"><header><div><h1>Workshop product demos</h1><p>Authored playback using real generated design files.</p></div><div className="host-controls"><button onClick={()=>{setRun(n=>n+1);setStill(false)}}>Replay hero</button><button onClick={()=>{setStill(v=>!v);setRun(n=>n+1)}}>{still?'Play demo':'Show still'}</button></div></header><figure><Hero key={run} still={still}/><figcaption>Recorded 24 s build · Board + case geometry cached. Median: 31.2 s cold, 19.0 s EDA cached.</figcaption></figure><figure className="comparison-host"><Comparison/><figcaption>Reported reference path compared with locally measured medians.</figcaption></figure><footer>Concept demos · CAD previews are not manufactured-device evidence. <a href="?capture=hero">Hero only</a><a href="?capture=comparison">Comparison only</a></footer></main>
}
createRoot(document.getElementById('root')!).render(<App/> )
