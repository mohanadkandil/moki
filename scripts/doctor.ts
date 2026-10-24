import 'dotenv/config';
import { cli } from './lib/cli.js';

console.log(`Node: ${process.version}`);
console.log(await cli(['--version']));
for (const name of ['OPENAI_API_KEY', 'DAYTONA_API_KEY', 'BFL_API_KEY']) {
  console.log(`${name}: ${process.env[name] ? 'configured' : 'not configured'}`);
}
try { await cli(['list', '--format', 'json']); console.log('Daytona CLI authentication: ready'); }
catch { console.log('Daytona CLI authentication: run daytona login'); process.exitCode = 1; }
