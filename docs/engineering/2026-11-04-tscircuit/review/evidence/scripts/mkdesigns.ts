import { submitBrief, EMPTY_SESSION } from '/home/sogo/design-skill-research/repos/moki/src/circuit/session.ts';
import { writeFileSync } from 'node:fs';
const briefs: Record<string,string> = { 'focus-timer': 'a focus timer with a knob and a beep', 'light-lamp': 'a lamp that turns on when it gets dark', 'temp-monitor': 'a temperature monitor with a display and an alarm above 30 C', 'temp-bme': 'a temperature monitor with a bme280 and a display' };
for (const [k,b] of Object.entries(briefs)) {
  const r = submitBrief(EMPTY_SESSION, b);
  if (r.outcome.kind !== 'created') { console.log(k, r.outcome); continue; }
  writeFileSync(`${process.argv[2]}/${k}.design.json`, JSON.stringify(r.outcome.revision.design, null, 1));
  console.log(k, r.outcome.revision.design.parts.map((p:any)=>p.id+':'+p.module).join(' '));
}
