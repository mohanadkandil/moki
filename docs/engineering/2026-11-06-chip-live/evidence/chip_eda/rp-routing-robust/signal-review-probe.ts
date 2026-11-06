/** Independent read-only pure review: actual phase union + explicit derived GPIO net. */
import{readFileSync,writeFileSync}from'node:fs';
import{createRpSignalEscapeProposals}from'../../../../../../eda/blocks/rp-signal-escape.js';
import{createDrv8833EscapeProposals}from'../../../../../../eda/blocks/drv8833-escape.js';
import{checkEachPcbTraceNonOverlapping,checkPadTraceClearance,checkViaTraceClearance,checkHoleTraceClearance}from'../../../../../../eda/node_modules/@tscircuit/checks/dist/index.js';
import{selectRpCriticalSignalNets}from'../../../../../../eda/blocks/rp-phase-order.js';
const root=new URL('./',import.meta.url),fixture=()=>JSON.parse(readFileSync(new URL('rp-signal-escape-fixture.json',root),'utf8'));
const run=(f:any)=>{const driver=createDrv8833EscapeProposals(f.circuit,f.graph,f.mapping),signals=createRpSignalEscapeProposals(f.circuit,f.graph,f.mapping,f.clock,f.power,new Set(driver.netNames));const touched=new Set([...driver.netNames,...signals.netNames,...f.power.netNames]);return{driver,signals,remaining:[...selectRpCriticalSignalNets(f.graph,touched,new Set(f.clock.netNames))]};};
const actual=fixture(),base=run(actual),f=fixture(),mcu=f.graph.parts.find((p:any)=>p.part.lcsc==='C2040'),owner=f.circuit.find((e:any)=>e.type==='source_component'&&e.name===mcu.ref);
// DERIVED extra application wire on real, previously-unused physical RP pins3/4.
// Only electrical records change: no invented part, supplier or geometric data.
const netId='source_net_review_gpio',key='review_gpio_connectivity_key',ports=[3,4].map(pad=>f.circuit.find((e:any)=>e.type==='source_port'&&e.source_component_id===owner.source_component_id&&e.pin_number===pad));
f.graph.nets.push({name:'REVIEW_GPIO',pins:[3,4].map(pad=>({ref:mcu.ref,pad:String(pad),logical:String(pad)}))});
f.circuit.push({type:'source_net',source_net_id:netId,name:'REVIEW_GPIO',subcircuit_id:ports[0].subcircuit_id,subcircuit_connectivity_map_key:key});
for(const[ i,p]of ports.entries()){p.subcircuit_connectivity_map_key=key;f.circuit.push({type:'source_trace',source_trace_id:'source_trace_review_gpio_'+i,connected_source_port_ids:[p.source_port_id],connected_source_net_ids:[netId],min_trace_thickness:.15,subcircuit_id:p.subcircuit_id,subcircuit_connectivity_map_key:key,display_name:`.${mcu.ref} > .pin${p.pin_number} to net.REVIEW_GPIO`});}
let derived:any;try{const r=run(f);derived={signalPads:r.signals.proposals.map((p:any)=>p.pad),remaining:r.remaining};}catch(error){derived={error:String(error)};}
const combined=structuredClone(actual.circuit);
const trace=(id:string,route:any[],sourceId:string)=>{const source=combined.find((e:any)=>e.type==='source_trace'&&e.source_trace_id===sourceId);combined.push({type:'pcb_trace',pcb_trace_id:id,source_trace_id:sourceId,subcircuit_id:source.subcircuit_id,route:structuredClone(route)});for(const p of route)if(p.route_type==='via')combined.push({type:'pcb_via',pcb_via_id:id+'_via',pcb_trace_id:id,x:p.x,y:p.y,outer_diameter:.6,hole_diameter:.3,layers:['top','inner1','inner2','bottom'],from_layer:'top',to_layer:'bottom',subcircuit_id:source.subcircuit_id,subcircuit_connectivity_map_key:source.subcircuit_connectivity_map_key});};
for(const p of actual.clock.audit){const n=combined.find((e:any)=>e.type==='source_net'&&e.name===p.net),t=combined.find((e:any)=>e.type==='source_trace'&&e.connected_source_net_ids?.includes(n.source_net_id)&&e.display_name?.startsWith(p.from+' to '));trace('REVIEW_CLOCK_'+combined.length,p.route,t.source_trace_id);}
for(const p of actual.power.audit)trace('REVIEW_POWER_'+combined.length,p.route,p.diagnosticSourceTraceId);
for(const p of base.signals.audit)trace('REVIEW_SIGNAL_'+combined.length,p.route,p.diagnosticSourceTraceId);
for(const p of base.driver.audit){const proposal=base.driver.proposals.find((q:any)=>q.ref===p.ref&&q.pad===p.pad)!;trace('REVIEW_DRV_'+combined.length,proposal.route,p.sourceTraceId);}
const combinedErrors=[...checkEachPcbTraceNonOverlapping(combined,{minClearance:.127}),...checkPadTraceClearance(combined,{minClearance:.127}),...checkViaTraceClearance(combined,{minClearance:.127}),...checkHoleTraceClearance(combined,{minClearance:.2})];
const evidence={combinedNativeErrors:combinedErrors.map((e:any)=>({type:e.type,message:e.message})),actual:{driverPaths:base.driver.proposals.length,driverControls:base.driver.audit.filter((a:any)=>['IN1','IN2'].includes(a.net)),signalPaths:base.signals.proposals.length,signalNetNames:base.signals.netNames,powerPaths:actual.power.audit.length,remaining:base.remaining},derivedGpio:derived};
writeFileSync(new URL('signal-review-probe.json',root),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
