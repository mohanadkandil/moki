import { mkdirSync,writeFileSync } from 'node:fs';
import { buildDesign } from '../../src/circuit/templates';
import { generateBoardSource } from '../../src/board/codegen';
import type { TemplateId } from '../../src/circuit/model';
const root=process.argv[2]!;
for(const template of ['focus-timer','light-lamp','temp-monitor'] as TemplateId[]) {
 const design=buildDesign({template,chosenBy:'user',recognized:[],notes:[],options:{buzzer:true,display:true,sensor:'ds18b20',pins:{}}});
 const dir=`${root}/${template}`;mkdirSync(dir,{recursive:true});
 writeFileSync(`${dir}/design.json`,JSON.stringify(design,null,2));writeFileSync(`${dir}/board.tsx`,generateBoardSource(design));
}
