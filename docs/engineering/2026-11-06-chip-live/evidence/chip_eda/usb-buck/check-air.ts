/** Pure ERC/power evidence, not a native routing or hardware acceptance run. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { contentHash, materializeDraft, listBlocks, resolvePlanBlocks } from '../../../../../../src/blocks/library.js';
import { checkPlan } from '../../../../../../src/blocks/erc.js';
import { usbBuckEvidence, type UsbBuckBundle } from '../../../../../../eda/blocks/generate-usb-buck.js';
import type { BoardPlan } from '../../../../../../src/blocks/contract.js';
const root=new URL('./',import.meta.url);
const bundle=JSON.parse(readFileSync(new URL('../../../../../../src/blocks/data/usb-buck-drafts.json',import.meta.url),'utf8')) as UsbBuckBundle;
const plan=JSON.parse(readFileSync(new URL('air-plan.json',root),'utf8')) as BoardPlan;
const block=materializeDraft(bundle.drafts[0]!);
const blocks=resolvePlanBlocks(plan,[...listBlocks().filter(b=>b.id!==block.id),block]);
const gates=checkPlan(plan,blocks);
const loads=blocks.filter(b=>b.id!==block.id && plan.blocks.some(i=>i.block===b.id && i.version===b.version)).flatMap(b=>b.power.sinks.map(s=>({block:b.id,...s})));
const evidence={kind:'pure-ERC-and-author-arithmetic-only',block:{id:block.id,version:block.version,hash:contentHash(bundle.drafts[0]!),status:block.status},planSha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),changesFromOwnerPlan:['ldo.block=tps63001-usb-5v-3v3@1','ldo.SYS -> ldo.VBUS; all other links and all placement/board fields unchanged'],gates,loads,authorArithmetic:usbBuckEvidence(),limitations:['No placement/routing render or firmware compile performed by this worker.','No independent review, measured DC-bias/efficiency/thermal/transient or hardware acceptance.']};
writeFileSync(new URL('air-erc.json',root),JSON.stringify(evidence,null,2)+'\n');
if(gates.some(g=>!g.ok))throw new Error(JSON.stringify(gates));
console.log(JSON.stringify({block:evidence.block,gates:gates.map(g=>({gate:g.gate,ok:g.ok})),loads},null,2));
