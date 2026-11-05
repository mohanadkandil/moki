import createEngine from '@tscircuit/ngspice-spice-engine';
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createSpiceNetlist, type SpiceTask } from '../../src/blocks/spice.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('SPICE runner requires input/output JSON paths');
if ((await stat(input)).size > 32_768) throw new Error('SPICE worker input too large');
const bytes = await readFile(input, 'utf8'), data = JSON.parse(bytes);
if (data.schema !== 'moki.spice-input/1' || !Array.isArray(data.tasks) || !data.tasks.length || data.tasks.length > 32) throw new Error('Invalid SPICE worker input');
const netlists = data.tasks.map((task: SpiceTask) => createSpiceNetlist(task));
const enginePackage = JSON.parse(await readFile(new URL('../node_modules/@tscircuit/ngspice-spice-engine/package.json', import.meta.url), 'utf8'));
if (enginePackage.name !== '@tscircuit/ngspice-spice-engine' || enginePackage.version !== '0.0.20') throw new Error('Unexpected SPICE engine installation');
const started = performance.now(), engine = await createEngine(), results = [];
for (const netlist of netlists) results.push({ netlist, result: await engine.simulate(netlist) });
await writeFile(output, JSON.stringify({ schema: 'moki.spice-output/1', inputSha256: createHash('sha256').update(bytes).digest('hex'), engine: `${enginePackage.name}@${enginePackage.version}`, ms: performance.now() - started, results }), { mode: 0o600 });
