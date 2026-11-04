import { runBoardProcess } from '/home/sogo/design-skill-research/repos/moki/server/board-api.ts';
const t = performance.now();
try {
  await runBoardProcess(process.execPath, ['-e', "require('child_process').spawn('setsid',['sleep','12'],{stdio:'inherit',detached:true}); setTimeout(()=>{},60000)"], process.cwd(), 1000);
  console.log('resolved', performance.now() - t);
} catch (e) { console.log(`timeout=1000ms; promise settled after ${Math.round(performance.now() - t)} ms: ${(e as Error).message}`); }
