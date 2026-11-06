// Bounded diagnostic replay only; partial plans are never accepted PCB output.
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require=createRequire(resolve('eda/package.json'));
const {SOLVERS}=await import(pathToFileURL(require.resolve('tscircuit')).href);
const source='var/board-jobs-test-chip/164dced4-c6f5-4d77-a3ec-42383e1bc51e/native-routing.json';
const events=JSON.parse(await readFile(source,'utf8'));
const event=events.find(e=>e.solver==='FanoutSolver');
if(!event)throw Error('Exact retained FanoutSolver event required');
const solver=new SOLVERS.FanoutSolver(structuredClone(event.input),structuredClone(event.options));
const start=performance.now();let steps=0,last=0;
while(!solver.solved&&!solver.failed&&performance.now()-start<45000){
  if(typeof solver.stepAsync==='function')await solver.stepAsync();else solver.step();steps++;
  if(performance.now()-start-last>10000){last=performance.now()-start;console.log(JSON.stringify({elapsedMs:last,steps,solved:solver.solved,failed:solver.failed}));}
}
const safe=(value)=>{const seen=new WeakSet();return JSON.parse(JSON.stringify(value,(_k,v)=>{if(typeof v==='function')return undefined;if(v instanceof Map)return Object.fromEntries(v);if(v instanceof Set)return [...v];if(v&&typeof v==='object'){if(seen.has(v))return '[shared-or-circular]';seen.add(v);}return v;}));};
const result={purpose:'bounded native solver diagnostic; NOT accepted PCB/nativeDRC output',source,constructor:'public tscircuit.SOLVERS.FanoutSolver',durationMs:performance.now()-start,steps,solved:solver.solved,failed:solver.failed,error:solver.error,solverKeys:Object.keys(solver),config:safe(solver.config),bestAttempt:safe(solver.bestAttempt),attempts:safe(solver.attempts),preparedBuses:safe(solver.preparedBuses),endpointCompletion:safe(solver.endpointCompletion)};
await writeFile('docs/engineering/2026-11-05-chip-level/evidence/chip_eda/ground-fanout-failed.native.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({durationMs:result.durationMs,steps,solved:result.solved,failed:result.failed,error:result.error,bestAttemptKeys:Object.keys(solver.bestAttempt??{}),attempts:solver.attempts.length}));
