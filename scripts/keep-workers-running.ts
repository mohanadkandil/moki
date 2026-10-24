import { createSetupDaytonaClient, safeError } from './lib/daytona-client.js';
import { environments } from './lib/cli.js';

try {
  const daytona = await createSetupDaytonaClient(process.argv.includes('--use-cli-profile'));
  for (const environment of environments) {
    const sandbox = await daytona.get(environment.name);
    await sandbox.setAutostopInterval(0);
    await sandbox.setAutoPauseInterval(0);
    await sandbox.setAutoArchiveInterval(0);
    await sandbox.setAutoDeleteInterval(-1);
    await sandbox.setTtl(0);
    await sandbox.refreshData();
    console.log(JSON.stringify({ name: sandbox.name, state: sandbox.state,
      autoStopInterval: sandbox.autoStopInterval, autoPauseInterval: sandbox.autoPauseInterval,
      autoArchiveInterval: sandbox.autoArchiveInterval, autoDeleteInterval: sandbox.autoDeleteInterval }));
  }
} catch (error) { console.error(safeError(error)); process.exitCode = 1; }
