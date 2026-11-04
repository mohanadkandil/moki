import { writeFile } from 'node:fs/promises';
import { EMPTY_SESSION, submitBrief } from '../../../../../src/circuit/session.ts';
import { contentId } from '../../../../../src/circuit/graph.ts';
const first=submitBrief(EMPTY_SESSION,'a focus timer for 25 minutes with a buzzer');
const second=submitBrief(first.session,'a focus timer for 45 minutes with a buzzer');
if(first.outcome.kind!=='created'||second.outcome.kind!=='created')throw Error('fixture did not create two designs');
const shown=first.outcome.revision.design,current=second.outcome.revision.design;
await writeFile('docs/engineering/2026-11-04-realism/review/evidence/rerun-check.json',JSON.stringify({shown:{template:shown.template,id:contentId(shown),behavior:shown.behavior},current:{template:current.template,id:contentId(current),behavior:current.behavior},studioRerunBranchMatches:current.template===shown.template,actualSelectedDesign:'current revision.design',expectedSelectedDesign:'shown job design',idsDiffer:contentId(current)!==contentId(shown)},null,2));
