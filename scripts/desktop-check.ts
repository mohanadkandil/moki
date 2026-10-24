import 'dotenv/config';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Daytona } from '@daytona/sdk';
import { environments } from './lib/cli.js';
import { createDaytonaClient } from '../src/runtime/providers.js';

async function client(): Promise<Daytona> {
  if (process.env.DAYTONA_API_KEY) return createDaytonaClient();
  if (!process.argv.includes('--use-cli-profile')) throw new Error('Set DAYTONA_API_KEY or explicitly pass --use-cli-profile');
  const configPath = process.platform === 'darwin'
    ? join(homedir(), 'Library/Application Support/daytona/config.json')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'daytona/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const profile = config.profiles?.find((p: { id: string; name: string }) => p.id === config.activeProfile || p.name === config.activeProfile);
  if (!profile || new URL(profile.api.url).origin !== 'https://app.daytona.io') throw new Error('Expected an authenticated official Daytona profile');
  // Credentials stay in memory, are sent only to the pinned official endpoint, and are never logged or copied to .env.
  return new Daytona({ apiUrl: 'https://app.daytona.io/api', apiKey: profile.api.key || undefined,
    jwtToken: profile.api.key ? undefined : profile.api.token?.accessToken,
    organizationId: profile.activeOrganizationId, target: 'eu' });
}

const daytona = await client();
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
