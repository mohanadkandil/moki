import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {prepareImmutablePreloads} from '../eda/blocks/immutable-preloads.js';
import {verifyRefinedClockPreloads} from '../eda/blocks/refined-clock-preloads.js';
const fixture=JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/refined-clock-preloads-fixture.json',import.meta.url),'utf8'));
function fresh(){const f=structuredClone(fixture);return{...f,expected:prepareImmutablePreloads(f.inputWithoutPreloads,f.fixedTraces).expected,output:{traces:structuredClone(f.updatedPreloadedTraces)}};}
const solver=(f:any)=>({getUpdatedPreloadedTraces:()=>structuredClone(f.updatedPreloadedTraces),getMutatedPreloadedTraces:()=>structuredClone(f.mutatedPreloadedTraces)});
const run=(f:any)=>verifyRefinedClockPreloads(solver(f),f.output,f.expected);
function synchronize(f:any,change:(t:any)=>void){const t=f.updatedPreloadedTraces[0];change(t);f.mutatedPreloadedTraces=[structuredClone(t)];f.output.traces=structuredClone(f.updatedPreloadedTraces);}

test('actual0de7 native single-XIN refinement forwards literal replacement and all five accepted getter records',()=>{
  const f=fresh(),before=structuredClone(f),r=run(f);
  assert.deepEqual(f,before);assert.equal(r.acceptedClockTraces.length,5);
  assert.deepEqual(r.acceptedClockTraces,f.updatedPreloadedTraces);
  assert.deepEqual(r.outputWithFixedTracesRemoved,{traces:f.mutatedPreloadedTraces});
  assert.deepEqual(r.audit.changedClockTraceIds,['saved_phase_null_0_0']);
  assert.equal(r.audit.removedReturnedFixedTraceIds.length,4);
  assert.equal(r.audit.changes[0]!.geometryChanged,true);
  assert.ok(Object.values(r.audit.lengthByNetMm).every(n=>n<=10));
  assert.equal(r.audit.viaCount,0);assert.equal(r.audit.sourceMetadataChanged,false);
  r.acceptedClockTraces[0].route[2].x+=1;assert.deepEqual(f,before,'return values do not alias captured evidence');
});

test('official Core accumulated-stage replacement consumes the parent ID and literal native replacement without duplicate clock Cu',()=>{
  const source=readFileSync(new URL('../eda/node_modules/@tscircuit/core/dist/index.js',import.meta.url),'utf8'),tree=ts.createSourceFile('core.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let declaration:ts.FunctionDeclaration|undefined;
  function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='getAccumulatedPcbTracesWithStageOutputReplacements'){assert.equal(declaration,undefined);declaration=n;}ts.forEachChild(n,visit);}
  visit(tree);assert.ok(declaration);const replace=new Function('return '+declaration.getText(tree))();
  const f=fresh(),r=run(f),actual=replace({accumulatedPcbTraces:f.fixedTraces,stageOutputPcbTraces:r.outputWithFixedTracesRemoved.traces});
  assert.equal(actual.length,5);assert.equal(new Set(actual.map((t:any)=>t.pcb_trace_id)).size,5);
  assert.deepEqual(actual.find((t:any)=>t.pcb_trace_id===r.audit.changedClockTraceIds[0]),f.mutatedPreloadedTraces[0]);
});

test('synchronized foreign source/net/subcircuit/alias/trace identity and endpoint mutations fail physical/source constraints',()=>{
  for(const change of [
    (t:any)=>t.source_trace_id='foreign-source',
    (t:any)=>t.subcircuit_id='foreign-subcircuit',
    (t:any)=>t.connection_name='foreign-net',
    (t:any)=>t.connectsTo.reverse(),
    (t:any)=>t.__rootConnectionNames=['foreign-root'],
    (t:any)=>t.pcb_trace_id='new-trace-id',
    (t:any)=>t.route[0].x+=1e-9,
    (t:any)=>t.route.at(-1).y+=1e-9,
    (t:any)=>t.route[2].start_pcb_port_id='foreign-port',
  ]){const f=fresh();synchronize(f,change);assert.throws(()=>run(f),/Refined clock/);}
});

test('overlength, width change, lower layer, nonfinite coordinates, added via and unknown wire data reject even when getters/output agree',()=>{
  for(const change of [
    (t:any)=>t.route[2].x=100,
    (t:any)=>t.route[2].width=.149999,
    (t:any)=>t.route[2].width=.16,
    (t:any)=>t.route[2].layer='bottom',
    (t:any)=>t.route[2].x=Infinity,
    (t:any)=>t.route[2].route_type='via',
    (t:any)=>t.route[2].shader='unknown-semantic-data',
    (t:any)=>t.route=[t.route[0]],
  ]){const f=fresh();synchronize(f,change);assert.throws(()=>run(f),/Refined clock|Native replay/);}
  const f=fresh();synchronize(f,(t:any)=>{t.route[2].x+=.2;delete t.__replaces_pcb_trace_id;});assert.throws(()=>run(f),/replacement claim/);
});

test('all three native disclosures must uniquely cover identical changed records, with replacement present in returned output',()=>{
  for(const change of [
    (f:any)=>f.updatedPreloadedTraces.pop(),
    (f:any)=>f.updatedPreloadedTraces.push(structuredClone(f.updatedPreloadedTraces[0])),
    (f:any)=>f.mutatedPreloadedTraces=[],
    (f:any)=>f.mutatedPreloadedTraces.push(structuredClone(f.mutatedPreloadedTraces[0])),
    (f:any)=>f.mutatedPreloadedTraces[0].route[2].x+=.001,
    (f:any)=>f.output.traces=f.output.traces.slice(1),
    (f:any)=>delete f.output.traces[0].__replaces_pcb_trace_id,
    (f:any)=>f.output.traces[0].route[2].x+=.001,
    (f:any)=>f.output.traces.push(structuredClone(f.output.traces[0])),
    (f:any)=>f.output.traces[0].__replaces_pcb_trace_id=f.fixedTraces[1].pcb_trace_id,
    (f:any)=>f.output.traces.push({...structuredClone(f.output.traces[0]),pcb_trace_id:'foreign-replacer'}),
  ]){const f=fresh();change(f);assert.throws(()=>run(f),/Refined clock/);}
  assert.throws(()=>verifyRefinedClockPreloads({},[],fresh().expected),/getters/);
});

test('unchanged five clock records strip as before and compiler-renumbered owners keep the same bounded refinement',()=>{
  const plain=fresh();plain.updatedPreloadedTraces=structuredClone(plain.fixedTraces);plain.mutatedPreloadedTraces=[];plain.output.traces=structuredClone(plain.fixedTraces);
  assert.deepEqual(run(plain).outputWithFixedTracesRemoved,{traces:[]});assert.deepEqual(run(plain).audit.changedClockTraceIds,[]);
  const f=fresh();for(const list of [f.fixedTraces,f.updatedPreloadedTraces,f.mutatedPreloadedTraces])for(const t of list){t.connection_name='renumbered-'+t.connection_name;t.source_trace_id='different-'+t.source_trace_id;t.subcircuit_id='different-subcircuit';t.__rootConnectionNames=['root-'+t.connection_name];}
  f.expected=prepareImmutablePreloads(f.inputWithoutPreloads,f.fixedTraces).expected;f.output.traces=structuredClone(f.updatedPreloadedTraces);
  assert.equal(run(f).acceptedClockTraces.length,5);
});

test('unrelated prior preloads remain immutable and unrelated new copper/metadata remain literal',()=>{
  const f=fresh(),extra={...structuredClone(f.fixedTraces[0]),pcb_trace_id:'unrelated-prior',connection_name:'inactive-other',source_trace_id:'unrelated-source',connectsTo:['unrelated-port-a','unrelated-port-b']};
  f.expected=prepareImmutablePreloads({...f.inputWithoutPreloads,traces:[extra]},f.fixedTraces).expected;
  f.updatedPreloadedTraces.unshift(extra);f.output.traces.unshift(structuredClone(extra));
  const newTrace={...structuredClone(extra),pcb_trace_id:'new-nonclock',connection_name:'new-net',specialNativeMetadata:{keep:true}};
  f.output.traces.push(newTrace);const result=run(f);
  assert.ok(result.outputWithFixedTracesRemoved.traces.some((t:any)=>t.pcb_trace_id==='unrelated-prior'));
  assert.deepEqual(result.outputWithFixedTracesRemoved.traces.at(-1),newTrace);
  f.output.traces[0].route[2].x+=1;assert.throws(()=>run(f),/differs/);
  const g=fresh();g.expected=f.expected;g.updatedPreloadedTraces.unshift(structuredClone(extra));g.updatedPreloadedTraces[0].route[2].x+=1;assert.throws(()=>run(g),/unrelated preload/);
});

test('unexpected new clock IDs cannot bypass per-net length or five-record coverage through any owner alias',()=>{
  for(const field of ['connection_name','source_trace_id','__netConnectionName','__rootConnectionNames','rootConnectionName','netConnectionName','mergedConnectionNames','connectsTo']){
    const f=fresh(),clock=f.fixedTraces[0];
    const extra={...structuredClone(clock),pcb_trace_id:'unexpected-clock-copy',connection_name:'unrelated-net',source_trace_id:'unrelated-source',connectsTo:['unrelated-port']};
    const owner=field==='source_trace_id'?clock.source_trace_id:field==='connectsTo'?clock.connectsTo[0]:clock.connection_name;
    (extra as any)[field]=['__rootConnectionNames','mergedConnectionNames','connectsTo'].includes(field)?[owner]:owner;
    f.output.traces.push(extra);assert.throws(()=>run(f),/additional clock copper/);
  }
  const alias=fresh();alias.fixedTraces[0].__rootConnectionNames=['clock-root-claim'];alias.updatedPreloadedTraces[0].__rootConnectionNames=['clock-root-claim'];alias.mutatedPreloadedTraces[0].__rootConnectionNames=['clock-root-claim'];alias.expected=prepareImmutablePreloads(alias.inputWithoutPreloads,alias.fixedTraces).expected;alias.output.traces=structuredClone(alias.updatedPreloadedTraces);
  alias.output.traces.push({...structuredClone(alias.fixedTraces[0]),pcb_trace_id:'alias-only-clock-copy',connection_name:'unrelated-net',source_trace_id:'unrelated-source',__rootConnectionNames:['clock-root-claim']});assert.throws(()=>run(alias),/additional clock copper/);
  const replacement=fresh();replacement.output.traces.push({...structuredClone(replacement.mutatedPreloadedTraces[0]),pcb_trace_id:'extra-native-clock-replacement'});assert.throws(()=>run(replacement),/additional clock copper|unproved preload replacement/);
  const traceIdAlias=fresh();traceIdAlias.output.traces.push({type:'pcb_trace',pcb_trace_id:'extra-clock-trace-id-alias',connection_name:'unrelated',connectsTo:[traceIdAlias.fixedTraces[0].pcb_trace_id],route:[{route_type:'wire',x:0,y:0,width:.15,layer:'top'},{route_type:'wire',x:20,y:0,width:.15,layer:'top'}]});assert.throws(()=>run(traceIdAlias),/additional clock copper/);
  const malformed=fresh();malformed.output.traces.push({type:'pcb_trace',pcb_trace_id:'bad-owner',connection_name:'unrelated',__rootConnectionNames:malformed.fixedTraces[0].connection_name});assert.throws(()=>run(malformed),/malformed root owner/);
});
