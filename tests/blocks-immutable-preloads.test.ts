import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareImmutablePreloads,verifyImmutablePreloads} from '../eda/blocks/immutable-preloads.js';
import {nativeReplayInputSha256 as hash} from '../eda/blocks/native-replay.js';

const fixture=JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/immutable-preloads-fixture.json',import.meta.url),'utf8'));
const prep=()=>prepareImmutablePreloads(structuredClone(fixture.input),structuredClone(fixture.fixedTraces));
const solver=(traces:any[],mutated:any[]=[])=>({getUpdatedPreloadedTraces:()=>structuredClone(traces),getMutatedPreloadedTraces:()=>structuredClone(mutated)});

test('actual five clock CJ records become literal cloned preloads without removing 111 existing clock rectangles',()=>{
  const before=structuredClone(fixture),p=prep();
  assert.deepEqual(fixture,before);assert.deepEqual(p.input.obstacles,fixture.input.obstacles);
  const clockNames=new Set(['source_net_5','source_net_6','source_net_17']);
  assert.equal(p.input.obstacles.filter((o:any)=>!o.componentId&&!o.circuitJsonMetadata&&o.connectedTo?.some((n:string)=>clockNames.has(n))).length,111);
  assert.deepEqual(p.input.traces,fixture.fixedTraces);assert.equal(p.input.connections.length,27);
  assert.deepEqual(p.input.connections,fixture.input.connections);assert.equal(p.expected.traces.length,5);
  assert.equal(p.audit.clockPreloadedTraceCount,5);assert.equal(p.audit.fixedConnectionNames.length,3);
  p.input.traces[0].route[0].x+=1;
  assert.deepEqual(p.expected.traces,fixture.fixedTraces,'solver input cannot alter frozen verification expectation');
  assert.ok(Object.isFrozen(p.expected));assert.ok(Object.isFrozen(p.expected.traces[0].route[0]));
});

test('exact public getter records permit output without clocks or strip only exact duplicate fixed IDs',()=>{
  const p=prep(),newTrace={type:'pcb_trace',pcb_trace_id:'new_route',connection_name:'source_net_0',route:[{route_type:'wire',x:1,y:2,width:.3,layer:'top'},{route_type:'wire',x:2,y:3,width:.3,layer:'top'}],customNewMetadata:{preserve:['everything']}};
  const output={...structuredClone(fixture.input),traces:[...structuredClone(fixture.fixedTraces),newTrace],newNativeMetadata:{preserve:true}},before=structuredClone(output);
  const r=verifyImmutablePreloads(solver(fixture.fixedTraces),output,p.expected);
  assert.deepEqual(output,before);assert.deepEqual(r.outputWithFixedTracesRemoved,{...before,traces:[newTrace]});
  assert.equal(r.audit.removedReturnedFixedTraceIds.length,5);assert.equal(r.audit.fixedTracesUnchanged,true);
  assert.deepEqual(verifyImmutablePreloads(solver(fixture.fixedTraces),[newTrace],p.expected).outputWithFixedTracesRemoved,[newTrace]);
});

test('any canonical geometry, width, source, alias, via, ID or route-order mutation fails before output',()=>{
  const p=prep();
  const mutations=[
    (t:any)=>t.route[0].x+=1e-9,
    (t:any)=>t.route[0].width=.149999999,
    (t:any)=>t.route[0].layer='bottom',
    (t:any)=>t.route.reverse(),
    (t:any)=>t.source_trace_id='foreign-source',
    (t:any)=>t.subcircuit_id='foreign-subcircuit',
    (t:any)=>t.connection_name='source_net_0',
    (t:any)=>t.connectsTo.reverse(),
    (t:any)=>t.pcb_trace_id='new-clock-id',
    (t:any)=>t.route.splice(1,0,{route_type:'via',x:t.route[0].x,y:t.route[0].y,from_layer:'top',to_layer:'bottom',via_diameter:.6,via_hole_diameter:.3}),
    (t:any)=>t.__rootConnectionNames=['foreign-net'],
  ];
  for(const mutate of mutations){const updated=structuredClone(fixture.fixedTraces);mutate(updated[0]);assert.throws(()=>verifyImmutablePreloads(solver(updated),[],p.expected),/Immutable preload/);}
  const changed=structuredClone(fixture.fixedTraces);changed[0].route[0].x+=.001;
  assert.throws(()=>verifyImmutablePreloads(solver(fixture.fixedTraces),changed,p.expected),/returned fixed copper changed/);
});

test('getter omission, duplicate, unknown, mutation-list entries and replacement claims fail closed',()=>{
  const p=prep();
  for(const updated of [[],fixture.fixedTraces.slice(1),[...fixture.fixedTraces,fixture.fixedTraces[0]],[...fixture.fixedTraces,{...fixture.fixedTraces[0],pcb_trace_id:'unknown'}]])assert.throws(()=>verifyImmutablePreloads(solver(updated),[],p.expected),/Immutable preload/);
  for(const mutated of [[fixture.fixedTraces[0]],[{pcb_trace_id:'unknown-mutation'}]])assert.throws(()=>verifyImmutablePreloads(solver(fixture.fixedTraces,mutated),[],p.expected),/mutation/);
  assert.throws(()=>verifyImmutablePreloads({},[],p.expected),/getters/);
  assert.throws(()=>verifyImmutablePreloads(solver(fixture.fixedTraces),[{type:'pcb_trace',pcb_trace_id:'new_replacement',__replaces_pcb_trace_id:fixture.fixedTraces[0].pcb_trace_id}],p.expected),/replaces/);
  assert.throws(()=>verifyImmutablePreloads(solver(fixture.fixedTraces),[{type:'pcb_trace',pcb_trace_id:'bad_replacement',__replaces_pcb_trace_id:[fixture.fixedTraces[0].pcb_trace_id]}],p.expected),/malformed replacement/);
  assert.throws(()=>verifyImmutablePreloads(solver(fixture.fixedTraces),[fixture.fixedTraces[0],fixture.fixedTraces[0]],p.expected),/duplicate/);
});

test('unknown fixed data, duplicate IDs, nonfinite widths and active direct/root clock owners reject at preparation',()=>{
  for(const mutate of [
    (f:any[])=>f[0].pcb_trace_id=f[1].pcb_trace_id,
    (f:any[])=>f[0].connection_name='source_net_0',
    (f:any[])=>f[0].unknownSemanticConstraint=true,
    (f:any[])=>f[0].route[0].shader='unsupported',
    (f:any[])=>f[0].route[0].width=NaN,
    (f:any[])=>f[0].route[0].width=0,
    (f:any[])=>delete f[0].source_trace_id,
    (f:any[])=>f.pop(),
  ]){const fixed=structuredClone(fixture.fixedTraces);mutate(fixed);assert.throws(()=>prepareImmutablePreloads(fixture.input,fixed),/Immutable preload|Native replay/);}
  for(const alias of [{name:'source_net_5'},{name:'mst-clock',__rootConnectionNames:['source_net_5']},{name:'mst-clock',__netConnectionName:'source_net_17'},{name:fixture.fixedTraces[0].source_trace_id}])assert.throws(()=>prepareImmutablePreloads({...fixture.input,connections:[...fixture.input.connections,alias]},fixture.fixedTraces),/active routed/);
});

test('canonical optional undefined object fields match while alias and array ordering stays exact',()=>{
  const fixed=structuredClone(fixture.fixedTraces);fixed[0].__rootConnectionNames=['source_net_5','clock-alias'];fixed[0].__netConnectionName='source_net_5';
  const p=prepareImmutablePreloads(fixture.input,fixed),updated=structuredClone(fixed);updated[0].optionalUndefined=undefined;updated[0].route[0].undefinedProperty=undefined;
  assert.equal(hash(updated),hash(fixed));assert.doesNotThrow(()=>verifyImmutablePreloads(solver(updated),updated,p.expected));
  updated[0].__rootConnectionNames.reverse();assert.throws(()=>verifyImmutablePreloads(solver(updated),[],p.expected),/changed/);
});

test('preexisting unrelated preloads retain metadata and are also immutable but are never stripped',()=>{
  const extra={...structuredClone(fixture.fixedTraces[0]),pcb_trace_id:'prior-nonclock',connection_name:'inactive_aux_net',source_trace_id:'prior-source'};
  const p=prepareImmutablePreloads({...fixture.input,traces:[extra]},fixture.fixedTraces);
  assert.deepEqual(p.input.traces[0],extra);const output={traces:[extra,...fixture.fixedTraces]};
  const r=verifyImmutablePreloads(solver(p.input.traces),output,p.expected);assert.deepEqual(r.outputWithFixedTracesRemoved,{traces:[extra]});
  assert.throws(()=>verifyImmutablePreloads(solver(fixture.fixedTraces),output,p.expected),/omitted/);
  const changed=structuredClone(extra);changed.route[0].x+=.001;
  assert.throws(()=>verifyImmutablePreloads(solver(p.input.traces),{traces:[changed]},p.expected),/returned fixed copper changed/);
  const replacement={...structuredClone(extra),pcb_trace_id:'replacement-for-prior',__replaces_pcb_trace_id:extra.pcb_trace_id};
  assert.throws(()=>verifyImmutablePreloads(solver(p.input.traces),{traces:[replacement]},p.expected),/replaces fixed copper/);
});

test('caller-proven clock ownership survives arbitrary compiler net/trace/source/subcircuit renumbering',()=>{
  const fixed=structuredClone(fixture.fixedTraces),renumber=new Map([['source_net_5','source_net_53'],['source_net_6','source_net_108'],['source_net_17','source_net_612']]);
  fixed.forEach((t:any,i:number)=>{t.connection_name=renumber.get(t.connection_name);t.pcb_trace_id='saved_phase_other_instance_0_'+i;t.source_trace_id='source_trace_'+(900+i);t.subcircuit_id='subcircuit_other_instance';t.__rootConnectionNames=[t.connection_name,'clock-profile-owner-'+i];t.__netConnectionName=t.connection_name;});
  for(const layerCount of [2,4]){
    const p=prepareImmutablePreloads({...fixture.input,layerCount},fixed);
    assert.deepEqual(p.audit.fixedConnectionNames,['source_net_53','source_net_108','source_net_612']);
    assert.deepEqual(p.input.traces,fixed);
    assert.deepEqual(verifyImmutablePreloads(solver(fixed),fixed,p.expected).outputWithFixedTracesRemoved,[]);
    assert.throws(()=>prepareImmutablePreloads({...fixture.input,layerCount,connections:[...fixture.input.connections,{name:'arbitrary_mst',__rootConnectionNames:['clock-profile-owner-0']}]},fixed),/active routed/);
  }
});
