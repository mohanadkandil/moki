import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {withSmtViaExclusionColumns} from '/home/sogo/design-skill-research/repos/moki/eda/blocks/no-via-in-pad.ts';
const dir='/home/sogo/design-skill-research/repos/moki/docs/engineering/2026-11-06-chip-live/evidence/chip_eda/';
const source=JSON.parse(readFileSync(dir+'rp-routing-robust/router-input.json','utf8'));
const original=JSON.stringify(source),r=withSmtViaExclusionColumns(source),count=source.obstacles.length;
assert.equal(JSON.stringify(source),original);
assert.equal(r.input.obstacles.length,count+r.audit.length);
for(let i=0;i<count;i++){assert.equal(r.input.obstacles[i],source.obstacles[i]);assert.deepEqual(r.input.obstacles[i],source.obstacles[i]);}
for(const p of r.input.obstacles.slice(count))assert.ok(Object.keys(p).every(key=>['type','obstacleId','center','width','height','layers','connectedTo','shape','ccwRotationDegrees'].includes(key)));
const hostile=structuredClone(source.obstacles.find((o:any)=>o.circuitJsonMetadata?.pcb_smtpad_id));
Object.assign(hostile,{componentId:'SAME_NET_ALIAS',connectedTo:['GND'],offBoardConnectsTo:['GND'],netIsAssignable:true,isCopperPour:true,__zLayers:[0],zLayers:[0]});
const h=withSmtViaExclusionColumns({layerCount:4,obstacles:[hostile]});
assert.deepEqual(h.input.obstacles[1].connectedTo,[]);
for(const key of ['componentId','offBoardConnectsTo','netIsAssignable','isCopperPour','__zLayers','zLayers','circuitJsonMetadata'])assert.equal(h.input.obstacles[1][key],undefined,key);
for(const from of ['top','inner1','inner2','bottom'])for(const to of ['top','inner1','inner2','bottom'])if(from!==to)assert.ok(h.input.obstacles[1].layers.includes(from)||h.input.obstacles[1].layers.includes(to));
const result={scope:'Pure immutable input/ownership-mask proof, no native solve',originalObstacleCount:count,addedColumnCount:r.audit.length,allOriginalObstaclesExact:true,connectionsAndTracesSameReference:r.input.connections===source.connections&&r.input.traces===source.traces,hostileComponentNetAssignableAndLayerAliasesDropped:true,allDistinctFourLayerTransitionsCovered:true};
writeFileSync(dir+'smt-mask-independent-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
