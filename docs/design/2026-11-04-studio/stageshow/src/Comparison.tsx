import {Stage,Card,Text,Row,Icon} from './kit'
import './workshop.css'
export default function Comparison(){return <Stage width={720} height={490} compact={{below:680,width:358,height:740}} className="workshop-comparison" initial={{}} fidelity="realistic" greys="cool">
  {()=> <Card flush pad="small" gap={0} className="wc-card"><div><Text className="wc-title">From brief to build files</Text></div>
    <div className="wc-pair">
      <section className="wc-reported"><Text className="wc-label">Board-first path</Text><div className="wc-duration">5–6 <span>min</span></div><Text className="wc-source">Reported · Owner reference</Text><div className="wc-items"><Row pad={8} title={<Text className="wc-item-text">PCB design</Text>} lead={<Icon name="check" size={14}/>}/><Row pad={8} title={<Text className="wc-item-text">Case behind a paid plan</Text>} lead={<Icon name="lock" size={14}/>}/><Row pad={8} title={<Text className="wc-item-text">Firmware behind a paid plan</Text>} lead={<Icon name="lock" size={14}/>}/></div></section>
      <section className="wc-workshop"><Text className="wc-label">Workshop</Text><div className="wc-results"><div className="wc-duration">~31 <span>s</span></div><div className="wc-cached">19 s cached</div></div><Text className="wc-source">Uncached median · Measured locally</Text><div className="wc-items"><Row pad={8} title={<Text className="wc-item-text">Board · Case · Compiled firmware</Text>} lead={<Icon name="check" size={14}/>}/><Row pad={8} title={<Text className="wc-item-text">31.2 s cold median · 19.0 s EDA cached</Text>}/><Row pad={8} title={<Text className="wc-item-text">24 s example · Board + case cached</Text>}/></div></section>
    </div>
    <div className="wc-foot"><Text wrap>Bench: 5 cold / 3 cached runs, 4 Nov 2026; toolchains warm, queue excluded. Studio cold runs: 32–40 s. CAD/compile only; not printed, flashed or bench-tested.</Text></div>

    <div className="wc-bleed" aria-hidden="true"/>
  </Card>}
</Stage>}
