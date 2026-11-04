// Verify receipt parsing against real incremental builds, preserving clean-build measurements.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compileFirmware } from '../../../../../src/firmware/index.js';
const root = resolve('docs/engineering/2026-11-04-tscircuit/evidence/eng_fw');
const summary = JSON.parse(await readFile(join(root, 'compile-summary.json'), 'utf8'));
for (const result of summary.results) {
 const dir = join(root, result.template);
 await copyFile(join(dir, 'firmware-build.json'), join(dir, 'warm-build.json'));
 await copyFile(join(dir, 'firmware-compile.log'), join(dir, 'warm-compile.log'));
 result.receiptVerification = await compileFirmware(dir);
 const receipt = JSON.parse(await readFile(join(dir, 'firmware-build.json'), 'utf8'));
 result.toolVersions = receipt.toolVersions;
 if (!receipt.toolVersions['toolchain-xtensa-esp32']) throw new Error('Actual toolchain version missing from receipt');
 console.log(`${result.template}: ${result.receiptVerification.status}, ${result.receiptVerification.ms} ms; toolchain ${receipt.toolVersions['toolchain-xtensa-esp32']}`);
}
await writeFile(join(root, 'compile-summary.json'), JSON.stringify(summary,null,2)+'\n');
