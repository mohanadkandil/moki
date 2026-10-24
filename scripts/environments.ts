import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { cli, environments, listEnvironments } from './lib/cli.js';

const operation = process.argv[2] ?? 'status';
if (!['setup', 'status', 'stop'].includes(operation)) throw new Error('Use setup, status or stop');
const current = await listEnvironments();
const bootstraps: Array<() => Promise<void>> = [];

for (const environment of environments) {
  const existing = current.find((item) => item.name === environment.name);
  if (operation === 'status') {
    console.log(JSON.stringify(existing ? { name: existing.name, id: existing.id, state: existing.state } : { name: environment.name, state: 'missing' }));
    continue;
  }
  if (operation === 'stop') {
    if (existing && existing.state !== 'stopped' && existing.state !== 'archived') {
      await cli(['stop', existing.id]);
      console.log(`${environment.name}: stopped`);
    }
    continue;
  }
  if (!existing) {
    await cli(['create', '--snapshot', 'daytona-medium', '--name', environment.name,
      '--target', process.env.DAYTONA_TARGET || 'eu', '--auto-stop', '20', '--auto-archive', '60',
      '--auto-delete', '-1', '--label', 'app=moki', '--label', `role=${environment.role}`,
      '--env', 'VNC_RESOLUTION=1440x900'], 180_000);
  } else if (existing.state !== 'started') {
    await cli(['start', existing.id], 180_000);
  }
  bootstraps.push(async () => {
    console.log(`${environment.name}: installing/checking design tools`);
    const bootstrap = await readFile(new URL('./bootstrap-desktop.py', import.meta.url), 'utf8');
    const result = await cli(['exec', environment.name, '--timeout', '1200', '--', '/usr/bin/python3', '-c', bootstrap, environment.role], 1_230_000);
    console.log(`${environment.name}: ${result}`);
  });
}
const results = await Promise.allSettled(bootstraps.map(bootstrap => bootstrap()));
for (const result of results) if (result.status === 'rejected') { console.error(String(result.reason)); process.exitCode = 1; }
