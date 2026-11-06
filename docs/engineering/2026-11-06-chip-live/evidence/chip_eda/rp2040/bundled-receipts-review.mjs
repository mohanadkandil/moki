// Independent review replay; run with node --import tsx from repository root.
import assert from 'node:assert/strict';
import { readFile,mkdtemp,readdir,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {loadCatalogReceipt}=await import(pathToFileURL(resolve('src/blocks/catalog.ts')).href);
const base=await mkdtemp(join(tmpdir(),'moki-bundled-receipt-review-'));
const envBefore=process.env.MOKI_BLOCK_PARTS_DIR;
let networkCalls=0,receiptCount=0;
const explicit=join(base,'explicit-missing'),implicit=join(base,'implicit-missing');
const options={cacheDir:explicit,fetch:async()=>{networkCalls++;throw Error('network forbidden');}};
try {
  const cases=[];
  for(const name of ['peripheral-drafts','motor-drafts','rp2040-drafts']) {
    const bundle=JSON.parse(await readFile(resolve(`src/blocks/data/${name}.json`),'utf8'));
    for(const receipt of bundle.receipts) {assert.deepEqual(await loadCatalogReceipt(receipt.id,options),receipt);receiptCount++;}
    cases.push({name,receipts:bundle.receipts.length});
  }
  assert.deepEqual(await readdir(base),[],'Fallback must not create even the requested cache directory');
  const bundle=JSON.parse(await readFile(resolve('src/blocks/data/rp2040-drafts.json'),'utf8'));
  const receipt=bundle.receipts[0];
  process.env.MOKI_BLOCK_PARTS_DIR=implicit;
  assert.deepEqual(await loadCatalogReceipt(receipt.id),receipt);
  assert.deepEqual(await readdir(base),[],'Default-path fallback also remains read-only');
  await mkdir(join(implicit,'receipts'),{recursive:true});
  const implicitFile=join(implicit,'receipts',receipt.id.slice(7)+'.json');
  await writeFile(implicitFile,'present malformed JSON');
  // An explicit path remains authoritative, even if the default has corrupt data.
  assert.deepEqual(await loadCatalogReceipt(receipt.id,options),receipt);
  await assert.rejects(loadCatalogReceipt(receipt.id),SyntaxError);
  assert.equal(await readFile(implicitFile,'utf8'),'present malformed JSON');
  await mkdir(join(explicit,'receipts'),{recursive:true});
  const explicitFile=join(explicit,'receipts',receipt.id.slice(7)+'.json');
  const corrupted=JSON.stringify({...receipt,rawBody:'tampered'});
  await writeFile(explicitFile,corrupted);
  await assert.rejects(loadCatalogReceipt(receipt.id,options),/integrity/);
  assert.equal(await readFile(explicitFile,'utf8'),corrupted);
  await writeFile(explicitFile,'not JSON');
  await assert.rejects(loadCatalogReceipt(receipt.id,options),SyntaxError);
  assert.equal(await readFile(explicitFile,'utf8'),'not JSON');
  await assert.rejects(loadCatalogReceipt(`sha256:${'0'.repeat(64)}`,options),e=>e.code==='ENOENT');
  assert.equal(networkCalls,0);
  console.log(JSON.stringify({ok:true,bundleCases:cases,receiptsChecked:receiptCount,networkCalls,explicitAndDefaultMissingCachesUnchanged:true,explicitOverridesDefault:true,presentCorruptRecordsNotHealed:true,unknownIdRetainsENOENT:true},null,2));
} finally {
  if(envBefore===undefined)delete process.env.MOKI_BLOCK_PARTS_DIR;else process.env.MOKI_BLOCK_PARTS_DIR=envBefore;
  await rm(base,{recursive:true,force:true});
}
