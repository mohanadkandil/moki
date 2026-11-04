import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runBoardProcess } from '../../../../../server/board-api.ts';
const out=resolve('docs/engineering/2026-11-04-realism/review/evidence');
const pidFile=resolve(out,'escaped.pid');const at=performance.now();let error='';
try {await runBoardProcess('/bin/sh',['-c','setsid sh -c \'echo $$ > "$1"; exec sleep 30\' sh "$1" & wait','sh',pidFile],process.cwd(),250);}catch(e){error=String(e);}
const elapsed=performance.now()-at;
let escaped=0;try{escaped=Number(await readFile(pidFile,'utf8'));process.kill(-escaped,'SIGKILL');}catch{}
const next=await runBoardProcess(process.execPath,['-e','console.log("NEXT_WORKER_OK")'],process.cwd());
await writeFile(resolve(out,'process-check.json'),JSON.stringify({elapsedMs:elapsed,error,escapedChildActuallyStarted:escaped>0,nextCode:next.code,nextStdout:next.stdout},null,2));
