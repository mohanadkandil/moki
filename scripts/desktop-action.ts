import { mkdir, writeFile } from 'node:fs/promises';
import { MokiDesktop } from '../src/runtime/desktop.js';
import { createSetupDaytonaClient, safeError } from './lib/daytona-client.js';

try {
  const [role, action = 'screenshot', ...args] = process.argv.slice(2).filter(arg => arg !== '--use-cli-profile');
  if (role !== 'mechanical' && role !== 'electrical') throw new Error('Choose mechanical or electrical');
  const client = await createSetupDaytonaClient(process.argv.includes('--use-cli-profile'));
  const sandbox = await client.get(`moki-${role}`);
  const desktop = new MokiDesktop(sandbox);
  if (action === 'click') await desktop.click(Number(args[0]), Number(args[1]));
  else if (action === 'hotkey') {
    if (!args[0]) throw new Error('Supply a key combination');
    await desktop.hotkey(args[0]);
  } else if (action !== 'screenshot') throw new Error('Choose screenshot, click or hotkey');
  const shot = await desktop.screenshot();
  await mkdir('var/screenshots', { recursive: true });
  const path = `var/screenshots/moki-${role}.png`;
  await writeFile(path, Buffer.from(shot.base64, 'base64'));
  const windows = await sandbox.computerUse.display.getWindows();
  console.log(JSON.stringify({ screenshot: path, windows: windows.windows?.map(w => w.title) }));
} catch (error) { console.error(safeError(error)); process.exitCode = 1; }
