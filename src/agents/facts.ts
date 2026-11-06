// What a build actually established, read from the job record and nothing else. Agents and closing
// messages speak from this, so neither can say more than the pipeline measured.
import { firstErrorLine, jobFailure } from '../board/failure.js';
import type { BoardJob } from '../board/model.js';
import type { BoardEdits } from './protocol.js';

export type AgentJob = BoardJob & { input: BoardJob['input'] & { baseJobId?: string; edits?: BoardEdits }; editSummary?: string[] };
export type CompileState = 'compiled' | 'failed' | 'not-compiled' | 'none';

export interface JobAssessment {
  ok: boolean;
  /** Worth a fixer attempt: something failed, as opposed to a tool that isn't installed. */
  problems: string[];
  drcErrors: number;
  drcChecked: boolean;
  compile: CompileState;
  caseOk: boolean;
  pipelineMs: number;
}

export function assessJob(job: AgentJob): JobAssessment {
  const stage = (name: string) => job.stages?.find(s => s.name === name);
  const errors = job.drc?.errors ?? [];
  const compileStage = stage('firmware-compile');
  const compile: CompileState = job.noFirmware ? 'none' : compileStage?.status === 'done' ? 'compiled' : compileStage?.status === 'failed' || stage('firmware')?.status === 'failed' ? 'failed' : 'not-compiled';
  const enclosure = stage('enclosure');
  const caseOk = enclosure?.status === 'done' && Boolean(job.artifacts?.['enclosure-base.stl']);
  const problems: string[] = [];
  if (job.status === 'failed') problems.push(jobFailure(job.error));
  for (const e of errors.slice(0, 8)) problems.push(`DRC ${e.type}: ${e.message.slice(0, 240)}`);
  if (errors.length > 8) problems.push(`…and ${errors.length - 8} more DRC errors.`);
  if (compile === 'failed') problems.push(`Firmware: ${firstErrorLine(compileStage?.note ?? stage('firmware')?.note ?? '') || 'failed'}`);
  if (enclosure?.status === 'failed') problems.push(`Case: ${firstErrorLine(enclosure.note ?? '') || 'failed'}`);
  const drcChecked = job.drc?.checked !== false && Boolean(stage('render') || stage('route'));
  return { ok: job.status === 'done' && drcChecked && errors.length === 0 && compile !== 'failed' && enclosure?.status !== 'failed', problems, drcErrors: errors.length, drcChecked, compile, caseOk, pipelineMs: Math.round(job.totalMs ?? 0) };
}

/** A job as the model reads it: facts only, trimmed, with no URL or path for it to act on. */
export function jobFacts(job: AgentJob, extras: { enclosure?: unknown; firmware?: unknown; layout?: unknown } = {}) {
  const assessment = assessJob(job);
  const firmware = extras.firmware as { logTail?: string; note?: string; compiled?: boolean; physicalFlash?: boolean } | undefined;
  const enclosure = extras.enclosure as { validation?: { failures?: unknown[] }; warnings?: unknown[]; dimensions?: unknown; physicalPrint?: unknown } | undefined;
  const layout = extras.layout as { board?: unknown; usbEdge?: unknown; parts?: Array<{ refdes?: unknown; module?: unknown; center?: unknown; rotation?: unknown }> } | undefined;
  return {
    jobId: job.jobId, status: job.status, ...(job.error ? { error: firstErrorLine(job.error) } : {}), cache: job.cache, input: { kind: job.input?.kind, template: job.input?.template, baseJobId: job.input?.baseJobId, edits: job.input?.edits },
    board: job.board, totalMs: Math.round(job.totalMs ?? 0),
    ...(job.editSummary?.length ? { editSummary: job.editSummary } : {}),
    drc: { checked: assessment.drcChecked, errors: (job.drc?.errors ?? []).slice(0, 12), warningCount: job.drc?.warnings?.length ?? 0 },
    stages: (job.stages ?? []).map(s => ({ name: s.name, status: s.status, ms: Math.round(s.ms), ...(s.note ? { note: s.note.slice(0, 500) } : {}) })),
    compile: assessment.compile, caseGenerated: assessment.caseOk,
    ...(firmware ? { firmware: { compiled: firmware.compiled ?? false, physicalFlash: false, note: firmware.note, ...(assessment.compile === 'failed' ? { logTail: firmware.logTail?.split('\n').slice(-40).join('\n').replace(/\/[^\s:'"]*\/(?=[^/\s:'"]+[:\s'"])/g, '') } : {}) } } : {}),
    ...(enclosure ? { enclosure: { failures: enclosure.validation?.failures ?? [], warnings: enclosure.warnings ?? [], dimensions: enclosure.dimensions, physicalPrint: enclosure.physicalPrint ?? false } } : {}),
    // Placement edits are absolute, so whoever proposes one has to be able to see where parts are now.
    ...(layout?.parts ? { layout: { board: layout.board, usbEdge: layout.usbEdge, parts: layout.parts.map(p => ({ refdes: p.refdes, module: p.module, center: p.center, rotation: p.rotation })) } } : {}),
    neverEstablishedBySoftware: 'Nothing has been printed, flashed, assembled or run on hardware. Compiled and DRC-clean are software checks.',
  };
}

export const NOT_PROVEN = 'Nothing has been printed, flashed or run on hardware; these are software checks only.';

/** The closing line a person reads after a build. Written from the record, never by a model. */
export function closingLine(job: AgentJob, attempts: number): string {
  const a = assessJob(job);
  const retried = attempts > 1 ? ` after ${attempts - 1} ${attempts === 2 ? 'retry' : 'retries'}` : '';
  if (a.ok && a.compile === 'none') return `Built${retried}: ${a.drcErrors} DRC errors, and no firmware, because this board has no code. ${NOT_PROVEN}`;
  if (a.ok && a.compile === 'compiled') return `Built${retried}: ${a.drcErrors} DRC errors, firmware compiled, case ${a.caseOk ? 'generated' : 'not generated'}. ${NOT_PROVEN}`;
  if (a.ok) return `Built${retried}: ${a.drcErrors} DRC errors, firmware not compiled on this server. ${NOT_PROVEN}`;
  // A job that threw is already one sentence and one message line.
  if (job.status === 'failed') return `${a.problems[0]} ${NOT_PROVEN}`;
  return `This build still has problems${retried}: ${a.problems.slice(0, 2).join(' ') || 'see the steps above.'} ${NOT_PROVEN}`;
}

/** Only words before a claim, in the same clause, can take it back: "you can download it" says nothing about "it works". */
const NEGATED = /\b(?:not|never|no|none|nothing|neither|without|unproven|untested|until|before|once|after|if|when|should|must|need|needs|could|can|may|might|would)\b|n['’]t\b/i;
const CLAIMS = [
  /\b(?:has|have|had|is|was|were|are|been|got|already|successfully)\s+(?:been\s+)?(?:printed|flashed|assembled|manufactured|fabricated|soldered|built and tested|bench[- ]tested)\b/i,
  /\b(?:tested|verified|validated|proven|confirmed)\s+(?:on|with|in|against)\s+(?:the\s+|a\s+|real\s+|actual\s+|physical\s+)*(?:hardware|device|board|bench|prototype|printer)\b/i,
  /\b(?:i|we)\s+(?:have\s+|already\s+)?(?:printed|flashed|assembled|soldered|manufactured|fabricated|bench[- ]tested)\b/i,
  /\b(?:it|this|(?:this|the|your)\s+(?:board|device|circuit|firmware|build|design|case|enclosure|lamp|timer|monitor|alarm))\s+(?:definitely\s+|now\s+|really\s+|actually\s+)?(?:works|is working|will work|runs correctly|functions correctly|is safe|is guaranteed)\b/i,
  /\b(?:guaranteed|proven)\s+to\s+(?:work|fit|run)\b/i,
  /\bsafe\s+to\s+(?:use|plug|power|leave)\b/i,
  /\b(?:ready to (?:ship|sell))\b/i,
];

/** True when a sentence claims a physical result. A sentence that negates or conditions the claim is fine. */
export function claimsPhysicalProof(sentence: string): boolean {
  return CLAIMS.some(claim => {
    const found = claim.exec(sentence);
    if (!found) return false;
    const clause = sentence.slice(0, found.index).split(/[,;:]/).at(-1) ?? '';
    return !NEGATED.test(`${clause}${found[0]}`);
  });
}

/** Removes any sentence that claims a physical result, and says what is actually known instead. */
export function guardClaims(text: string): { text: string; changed: boolean } {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const kept = sentences.filter(sentence => !claimsPhysicalProof(sentence));
  if (kept.length === sentences.length) return { text, changed: false };
  return { text: [...kept, NOT_PROVEN].join(' ').trim(), changed: true };
}
