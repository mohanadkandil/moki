import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { environments } from './lib/cli.js';
import { createSetupDaytonaClient, safeError } from './lib/daytona-client.js';

async function main() {
const daytona = await createSetupDaytonaClient(process.argv.includes('--use-cli-profile'));
await mkdir('var/screenshots', { recursive: true });
for (const environment of environments) {
  const sandbox = await daytona.get(environment.name);
  await sandbox.computerUse.start();
  const info = await sandbox.computerUse.display.getInfo();
  const primary = info.displays?.[0];
  if (!primary || primary.width !== 1440 || primary.height !== 900) throw new Error(`${environment.name}: unexpected desktop resolution`);
  const launch = `import os, pathlib, shutil, subprocess\np=pathlib.Path.home()/'moki'\np.mkdir(exist_ok=True)\napp=shutil.which(${JSON.stringify(environment.role === 'mechanical' ? 'freecad' : 'kicad')})\nassert app, 'Design application missing'\ndisplays=sorted(pathlib.Path('/tmp/.X11-unix').glob('X*'))\nassert displays, 'No X display'\nenv=os.environ.copy()\nenv['DISPLAY']=':'+displays[0].name[1:]\nenv['LIBGL_ALWAYS_SOFTWARE']='1'\nenv['QT_X11_NO_MITSHM']='1'\nwith (p/'application.log').open('a') as log:\n subprocess.Popen([app],env=env,stdout=log,stderr=log,start_new_session=True)\nprint('Application launch requested')`;
  // Execute a fixed local launch program, not model-generated shell text.
  const launchResult = await sandbox.process.executeCommand(`/usr/bin/python3 -c '${launch.replaceAll("'", "'\\''")}'`, undefined, undefined, 30);
  if (launchResult.exitCode !== 0) throw new Error(`${environment.name}: ${launchResult.result}`);
  let windows = await sandbox.computerUse.display.getWindows();
  for (let attempt = 0; attempt < 20 && !windows.windows?.some(w => /freecad|kicad/i.test(w.title || '')); attempt++) {
    await setTimeout(1000);
    windows = await sandbox.computerUse.display.getWindows();
  }
  const screenshot = await sandbox.computerUse.screenshot.takeFullScreen();
  if (!screenshot.screenshot) throw new Error(`${environment.name}: screenshot is empty`);
  await writeFile(`var/screenshots/${environment.name}.png`, Buffer.from(screenshot.screenshot, 'base64'));
  if (!windows.windows?.some(w => /freecad|kicad/i.test(w.title || ''))) throw new Error(`${environment.name}: design application window did not appear; inspect saved screenshot and application.log`);
  console.log(JSON.stringify({ name: environment.name, state: sandbox.state, display: { width: primary.width, height: primary.height }, windows: windows.windows?.map(w => w.title), screenshot: `var/screenshots/${environment.name}.png` }));
}
}

try { await main(); }
catch (error) {
  // Avoid logging SDK request objects: they may contain authentication headers.
  console.error(safeError(error));
  process.exitCode = 1;
}
