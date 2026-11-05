import createEngine from '@tscircuit/ngspice-spice-engine';
import {writeFile}from'node:fs/promises';
const started=performance.now();const engine=await createEngine();
const netlist='Moki RC reset reference\nV1 vdd 0 DC 3.3\nR1 vdd en 10k\nC1 en 0 1u IC=0\n.tran 10u 50m UIC\n.save v(en)\n.end\n';
try{const result=await engine.simulate(netlist);await writeFile('docs/engineering/2026-11-05-chip-level/evidence/chip_eda/spice-spike.json',JSON.stringify({ms:performance.now()-started,netlist,result},null,2));console.log(JSON.stringify({ms:performance.now()-started,results:result.simulationResultCircuitJson.length}));}catch(error){console.error(error);process.exitCode=1;}
