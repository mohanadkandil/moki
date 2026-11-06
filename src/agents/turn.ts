// One chat turn, end to end: route it, let an agent decide, hand the decision to the pipeline, and
// fix a failed build at most twice. Models decide what to build. Everything else is plain code.
import { randomUUID } from 'node:crypto';
import { contentId } from '../circuit/graph.js';
import type { CircuitDesign } from '../circuit/model.js';
import { BoardServiceError, waitForJob, type BoardClient } from './board-client.js';
import { firmwareProject } from '../firmware/index.js';
import { chipTurn, type ChipLibrary, type ChipTurn, type SchematicPlan as ChipPlan } from './chip.js';
import { firstErrorLine, withoutSourceLines } from '../board/failure.js';
import { assessJob, closingLine, guardClaims, jobFacts, type AgentJob } from './facts.js';
import { MAX_COMPILE_TRIES, runFirmware, type CompileApp, type CompileOutcome } from './firmware.js';
import { CARRIER_INTERFACES, factsFromDesign } from './verify-facts.js';
import { catalogListing } from './tools.js';
import { runVerifier } from './verifier.js';
import { AgentStop, JobBudget, redact, type CallRecord, type ModelProvider } from './model.js';
import type { AgentEvent, AgentRole, BoardEdits, DeviceFacts, Requirement, RequirementMetricDef, TurnOutcome, TurnRequest, VerifyGate } from './protocol.js';
import { runDesigner, runEditor, runExplainer, runFixer, type DesignerResult, type RoleContext } from './roles.js';

export const MAX_FIX_RETRIES = 2;
const partIds = (design: CircuitDesign) => design.parts.map(p => `${p.id}:${p.module}`).sort().join();

const QUESTION = /^(?:why|what|how|when|where|which|who|explain|does|did|is|are|was|were|should|do)\b/i;
const REQUEST = /^(?:(?:can|could|would|will)\s+(?:you|we|it)\b|please\b|make|move|add|remove|change|use|set|swap|replace|put|shrink|enlarge|grow|rotate|turn|switch)\b/i;

/** Deterministic, so routing never costs a model call. A wrong guess is recoverable: the editor can hand over. */
export function routeTurn(request: Pick<TurnRequest, 'message' | 'design' | 'jobId'>): AgentRole {
  const text = request.message.trim();
  const isQuestion = !REQUEST.test(text) && (/\?\s*$/.test(text) || QUESTION.test(text));
  if (isQuestion && (request.jobId || request.design)) return 'explainer';
  return request.design ? 'editor' : 'designer';
}

/** The requirement engine. A server without one designs as before, with no confirm step. */
export interface VerifyEngine {
  metrics: readonly RequirementMetricDef[];
  evaluate(requirements: Requirement[], facts: DeviceFacts): VerifyGate;
}

export interface TurnDependencies {
  provider: ModelProvider;
  board: BoardClient;
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
  capUsd?: number;
  onCall?: (record: CallRecord) => void;
  pollMs?: number;
  /** Tests swap in a compiler. The default is the sandboxed PlatformIO. */
  compileApp?: CompileApp;
  compileProject?: (project: Record<string, string>, signal?: AbortSignal) => Promise<CompileOutcome>;
  /** The block library. A server without one answers chip-level requests honestly and stays in carrier mode. */
  chip?: ChipLibrary;
  verify?: VerifyEngine;
}

const friendlyStop: Record<AgentStop['reason'], string> = {
  budget: 'The agent reached its spending limit for this build.',
  refusal: 'The model declined this request.',
  'max-tokens': 'The agent ran out of output room.',
  'call-limit': 'The agent used up its model calls without finishing.',
  aborted: 'The chat closed.',
  provider: 'The model service failed.',
};

/** Everything a model wrote passes the claim guard before anyone can read it. */
function guardEvent(event: AgentEvent): AgentEvent {
  const clean = (text: string) => guardClaims(text).text;
  switch (event.type) {
    // A model that read a compile log can quote it. Source excerpts stay in the job's files.
    case 'message': return { ...event, text: clean(withoutSourceLines(event.text)) };
    case 'requirements': return { ...event, message: clean(event.message) };
    case 'tool': return { ...event, summary: clean(event.summary) };
    case 'job': return { ...event, label: clean(event.label) };
    case 'decline': return { ...event, message: clean(event.message), ...(event.closest ? { closest: clean(event.closest) } : {}) };
    case 'plan.partial': {
      // A draft isn't checked yet, and a model wrote its words. One that boasts stays off the canvas; the step still shows.
      if (!event.plan) return event;
      const words = [event.plan.title, ...(event.plan.sections ?? []).flatMap(section => [section.title, section.purpose, ...section.notes])];
      if (!words.some(text => guardClaims(text).changed)) return event;
      return { type: 'plan.partial', step: event.step };
    }
    default: return event;
  }
}

/** Runs a turn and always finishes with a `done` event. Never throws for an expected failure. */
export async function runTurn(request: TurnRequest, deps: TurnDependencies): Promise<TurnOutcome> {
  const { provider, board, signal } = deps;
  const emit = (event: AgentEvent) => deps.emit(guardEvent(event));
  const budget = new JobBudget(deps.capUsd, process.env, deps.onCall);
  const context: RoleContext = { provider, budget, emit, ...(signal ? { signal } : {}) };
  // Carrier when the module kit covers the brief, chip-level when it doesn't. A card's confirmation brings its mode back.
  let mode = request.mode;
  // The maker was told this idea needs no microcontroller, so the design has to agree.
  let noMcu = request.noMcu === true;
  const finish = (outcome: TurnOutcome) => { emit({ type: 'done', outcome, usage: budget.totals() }); return outcome; };
  const say = (role: AgentRole, text: string) => { if (text) emit({ type: 'message', role, text }); };

  /** Reads a job the way an agent should: facts only, always fresh. */
  const reader = (jobId: string | undefined, refusal?: string) => ({
    async read() {
      if (!jobId) return 'There is no build yet.';
      const job = await board.get(jobId, signal);
      const [enclosure, firmware, layout] = await Promise.all(['enclosure.json', 'firmware-build.json', 'layout.json'].map(name => board.artifact(job, name, signal)));
      return { ...jobFacts(job, { enclosure, firmware, layout }), ...(refusal ? { lastChangeRefusedByBuildService: refusal } : {}) };
    },
  });

  let unchecked: string[] = [];
  /** A finished build only counts as done if every confirmed requirement passed. */
  const finishBuilt = () => {
    if (!unchecked.length) return finish('built');
    say('verifier', `Built, but not done: ${unchecked.length} requirement${unchecked.length === 1 ? '' : 's'} couldn’t be checked. ${unchecked.join(' ')}`);
    return finish('built-unverified');
  };

  /** The requirement gate. Reports every result, and returns the failures. Unsupported is shown, and never a pass. */
  function checkRequirements(requirements: Requirement[] | undefined, facts: DeviceFacts): string[] {
    unchecked = [];
    if (!requirements?.length || !deps.verify) return [];
    const gate = deps.verify.evaluate(requirements, facts);
    const tidy = (text: string) => text.replace(/\d+\.\d{3,}/g, n => String(Number(Number(n).toPrecision(3))));
    const results = (gate.results ?? []).map(r => ({ ...r, evidence: tidy(r.evidence), plain: (requirements.find(q => q.id === r.id)?.plain ?? r.id).replace(/\.+$/, ''), ...(typeof r.measured === 'number' ? { measured: Number(r.measured.toPrecision(3)) } : {}) }));
    emit({ type: 'verify', ok: gate.ok, results });
    unchecked = results.filter(r => r.status === 'unsupported').map(r => `${r.plain}: ${r.evidence}`);
    return results.filter(r => r.status === 'fail').map(r => `Requirement failed: ${r.plain}. Measured ${JSON.stringify(r.measured ?? 'nothing')}${r.unit ? ` ${r.unit}` : ''}, needs ${JSON.stringify(r.target ?? 'more')}${r.unit ? ` ${r.unit}` : ''}. ${r.evidence}`);
  }

  /** Shows the checks and ends the turn. Nothing is designed until the maker confirms them. */
  async function askVerifier(brief: string, change?: { current: Requirement[]; request: string }): Promise<TurnOutcome> {
    emit({ type: 'role', role: 'verifier' });
    // Interfaces come from what this mode can really report, so a check can't fail on a synonym.
    const chipBlocks = mode === 'chip' && deps.chip ? await deps.chip.blocks() : null;
    const interfaces = chipBlocks ? [...new Set(['usb_c_sink', 'usb_power', ...chipBlocks.filter(b => !noMcu || (!b.mcu && !b.ports.some(p => p.kind === 'bus'))).flatMap(b => [b.id, b.class, ...b.ports.flatMap(p => (p.bus ? [p.bus.protocol] : []))])])].map(i => i.toLowerCase()) : CARRIER_INTERFACES;
    const onChip = Boolean(chipBlocks);
    const modules = catalogListing();
    const offerNoCode = Boolean(deps.chip) && !noMcu;
    const scope = noMcu
      ? { canBuild: 'A custom board with no microcontroller and no code, from real parts in the JLCPCB catalog. No mains voltage.', chipLevelNext: false }
      : onChip
      ? { canBuild: 'A custom chip-level board from any real part in the JLCPCB catalog, including any microcontroller and driver chip. No mains voltage.', chipLevelNext: false, offerNoCode }
      : { offerNoCode, canBuild: `Only these parts, on a carrier board, and nothing else: ${modules.modules.map(m => m.name).join('; ')}. The only controller is the ${modules.modules.find(m => m.category === 'controller')?.name}. ${modules.limits}`, chipLevelNext: !deps.chip };
    const { result, text } = await runVerifier(context, brief, deps.verify!.metrics, change, request.history, interfaces, scope);
    if (!result) { say('verifier', text); return finish(text ? 'answered' : 'no-change'); }
    if (result.kind === 'ask') { say('verifier', result.message); return finish('awaiting-confirmation'); }
    // The checks start again, because this board can report different things.
    if (result.kind === 'no-code') { noMcu = true; mode = 'chip'; say('verifier', result.message); return askVerifier(brief, change); }
    if (result.kind === 'cannot-build') {
      // The module kit can't do it, but real parts can. The checks start again, because each mode can report different things.
      if (!onChip && deps.chip) { mode = 'chip'; say('verifier', 'The module kit can’t do this, so I’ll design a custom board from real parts.'); return askVerifier(brief, change); }
      emit({ type: 'decline', message: result.message, closest: null, closestBrief: result.closestBrief });
      return finish('declined');
    }
    const whole = result.brief ?? brief;
    // With nothing to agree there is nothing to confirm, so no button can ever lead nowhere.
    if (!result.requirements.length) {
      if (!change) return proceed(whole);
      say('verifier', 'That leaves nothing to check, so I’ll go ahead without any.');
      return request.design
        ? await build('editor', { ...request.design, requirements: [] }, request.edits, request.jobId, 'Remove the requirements', [{ type: 'design', design: { ...request.design, requirements: [] }, brief, changes: ['Removed the requirements'] }])
        : proceed(brief);
    }
    emit({ type: 'requirements', requirements: result.requirements, notCheckable: result.notCheckable, message: result.message, brief: whole, existing: Boolean(change && request.design), ...(mode === 'chip' ? { mode } : {}), ...(noMcu ? { noMcu } : {}) });
    return finish('awaiting-confirmation');
  }

  function startChip(message: string, edit?: ChipTurn['edit']): Promise<TurnOutcome> {
    return chipTurn({ ...context, board, library: deps.chip!, message, ...(edit ? { edit } : {}), ...(deps.compileProject ? { compileProject: deps.compileProject } : {}), ...(deps.pollMs !== undefined ? { pollMs: deps.pollMs } : {}), ...(confirmed ? { requirements: confirmed } : {}), ...(noMcu ? { noMcu } : {}), ...(deps.verify ? { checkRequirements } : {}), say, finish: outcome => (outcome === 'built' ? finishBuilt() : finish(outcome)) });
  }

  /** The design step for this mode, once there's nothing left to agree. */
  function proceed(brief: string): Promise<TurnOutcome> {
    return mode === 'chip' && deps.chip ? startChip(brief) : startDesign(brief);
  }

  /** Builds, then gives the fixer up to two tries. Each retry is a new job based on the last job that ran. */
  async function build(role: AgentRole, design: CircuitDesign, edits: BoardEdits | undefined, baseJobId: string | undefined, label: string, announce: AgentEvent[]): Promise<TurnOutcome> {
    const tried: string[] = [];
    let requirementFailure: string | undefined;
    let current = design, currentEdits = edits, base = baseJobId, currentLabel = label, pending = announce;
    let failed: AgentJob | undefined;
    // ERC has passed by now. A requirement that fails before layout can't be fixed by moving parts.
    const early = checkRequirements(design.requirements, factsFromDesign(design));
    if (early.length) { say('verifier', `Requirement gate failed, so nothing was built. ${early.join(' ')}`); return finish('build-failed'); }
    for (let attempt = 1; ; attempt++) {
      let refusal: string | undefined;
      let jobId: string | undefined;
      try {
        ({ jobId } = await board.create({ design: current, ...(base ? { baseJobId: base } : {}), ...(currentEdits ? { edits: currentEdits } : {}) }, signal));
      } catch (error) {
        // The job API checks a layout before queueing. A refusal is an answer, not a crash: nothing was built.
        if (!(error instanceof BoardServiceError) || error.status !== 400 || !(currentEdits || base)) throw error;
        refusal = error.message.slice(0, 300);
        emit({ type: 'message', role: attempt > 1 ? 'fixer' : role, text: `That layout can’t be built: ${refusal} Nothing was queued.` });
        if (!failed) return finish('no-change');
      }
      if (jobId) {
        // A design only becomes current once the build service has accepted it.
        for (const event of pending) emit(event);
        emit({ type: 'job', jobId, attempt, baseJobId: base ?? null, label: currentLabel });
        const job: AgentJob = await waitForJob(board, jobId, { ...(signal ? { signal } : {}), ...(deps.pollMs !== undefined ? { pollMs: deps.pollMs } : {}) });
        const raw = assessJob(job);
        // Firmware from a model has to have compiled here. "Skipped" isn't a pass.
        const compiled = !current.app || raw.compile === 'compiled' || job.status === 'failed' ? raw : { ...raw, ok: false, problems: [...raw.problems, 'Compile gate: the firmware wasn’t compiled on this build.'] };
        // Now the board has a real size, so the requirements get a final say. A too-large board goes to the Fixer.
        const failedRequirements = compiled.ok ? checkRequirements(current.requirements, factsFromDesign(current, job)) : [];
        const assessed = failedRequirements.length ? { ...compiled, ok: false, problems: [...compiled.problems, ...failedRequirements] } : compiled;
        requirementFailure = failedRequirements.length ? failedRequirements.join(' ') : undefined;
        budget.pipelineMs += assessed.pipelineMs;
        emit({ type: 'job-result', jobId, attempt, status: job.status, ok: assessed.ok, drcErrors: assessed.drcErrors, compile: assessed.compile, caseOk: assessed.caseOk, pipelineMs: assessed.pipelineMs, problems: assessed.problems });
        // The service must echo edits back, or a layout change would be ignored and reported as done.
        if (currentEdits && !job.input?.edits) {
          emit({ type: 'message', role, text: 'The build service ignored the layout change, so this board is unchanged. Layout edits aren’t available on this server yet.' });
          return finish('build-failed');
        }
        if (assessed.ok) { say(attempt > 1 ? 'fixer' : role, closingLine(job, attempt)); return finishBuilt(); }
        if (!raw.problems.length && compiled.problems.length) { say('firmware', `Compile gate failed: ${compiled.problems[0]}`); return finish('build-failed'); }
        failed = job;
      }
      const last = failed!;
      if (attempt > MAX_FIX_RETRIES) { say('fixer', requirementFailure ?? closingLine(last, attempt)); return finish('build-failed'); }
      emit({ type: 'role', role: 'fixer' });
      const fix = await runFixer(context, current, reader(last.jobId, refusal ?? requirementFailure), currentEdits, tried);
      if (fix.result?.kind !== 'fix') {
        say('fixer', fix.result?.reason ?? fix.text);
        say('fixer', requirementFailure ?? closingLine(last, attempt));
        return finish('build-failed');
      }
      say('fixer', fix.result.reason);
      pending = fix.result.designChanged
        ? [{ type: 'design', design: fix.result.design, brief: request.brief ?? request.message, changes: fix.result.changes }]
        : fix.result.edits ? [{ type: 'edit', edits: fix.result.edits, changes: fix.result.changes }] : [];
      current = fix.result.design; currentEdits = fix.result.edits; base = last.jobId;
      currentLabel = `Fix ${attempt} of ${MAX_FIX_RETRIES}: ${fix.result.changes.join('; ') || 'adjusted'}`;
    }
  }

  /** The compile gate for model-written firmware. An outcome means the chat has already said which gate failed and why. */
  async function withFirmware(target: CircuitDesign, wanted: string, previous?: string): Promise<{ design: CircuitDesign } | { outcome: TurnOutcome }> {
    emit({ type: 'role', role: 'firmware' });
    const { result, text } = await runFirmware({ ...context, ...(deps.compileApp ? { compile: deps.compileApp } : {}) }, target, wanted, previous);
    if (result?.kind === 'app') {
      say('firmware', `${result.summary ? `${result.summary} ` : ''}A model wrote this firmware and it has only been compiled, so read it before you flash it.`);
      // Each change adds to the brief, and the newest words matter most.
      return { design: { ...target, app: { source: result.source, brief: wanted.slice(-2000) } } };
    }
    if (result && result.tries >= MAX_COMPILE_TRIES) {
      say('firmware', `Compile gate failed, so nothing was built. ${result.reason}`);
      return { outcome: finish('build-failed') };
    }
    say('firmware', result ? `No firmware was written, so nothing was built. ${result.reason}` : text || 'No firmware was written, so nothing was built.');
    return { outcome: finish('no-change') };
  }

  const confirmed = request.requirementsConfirmed ? request.requirements : undefined;

  async function design(message: string): Promise<TurnOutcome> {
    // The checks come first, so the maker agrees what done means before anything is designed.
    if (deps.verify && !request.requirementsConfirmed) return askVerifier(message);
    return startDesign(message);
  }

  async function startDesign(message: string): Promise<TurnOutcome> {
    emit({ type: 'role', role: 'designer' });
    const { result, text } = await runDesigner(context, message, request.history, confirmed);
    if (!result) { say('designer', text); return finish(text ? 'answered' : 'no-change'); }
    return designed(result, message);
  }

  /** The kit said no after all. Checks agreed for the kit don't carry over, so any get written again. */
  function toChip(brief: string, why = ''): Promise<TurnOutcome> {
    mode = 'chip';
    say('designer', `${why ? `${why.trim()} ` : 'The module kit can’t do this. '}I’ll design a custom board from real parts.`);
    return deps.verify ? askVerifier(brief) : startChip(brief);
  }

  async function designed(result: DesignerResult, message: string): Promise<TurnOutcome> {
    if (result.kind === 'decline') {
      if (deps.chip) { if (result.noCode) noMcu = true; return toChip(message, result.message); }
      emit({ type: 'decline', message: result.message, closest: result.closest || null, closestBrief: result.closestBrief || null });
      return finish('declined');
    }
    say('designer', result.summary);
    // Code writes these from what the maker confirmed, whatever a model sent.
    const { requirements: _ignored, ...sent } = result.design;
    let chosen: CircuitDesign = confirmed?.length ? { ...sent, requirements: confirmed } : sent;
    if (result.appBrief) {
      const written = await withFirmware(chosen, result.appBrief);
      if ('outcome' in written) return written.outcome;
      chosen = written.design;
    }
    return build('designer', chosen, undefined, undefined, chosen.title, [{ type: 'design', design: chosen, brief: message, changes: [] }]);
  }

  /** The chat edits the latest design. If the build on screen isn't that design, the maker should hear so. */
  async function noteStaleContext() {
    if (!request.jobId || !request.design) return;
    const job = await board.get(request.jobId, signal).catch(() => null);
    if (job?.input?.kind === 'source') emit({ type: 'message', role: 'editor', text: 'This change starts from the design, so the TSX edits in the build on screen aren’t carried over.' });
    else if (job?.input?.designContentId && job.input.designContentId !== contentId(request.design)) emit({ type: 'message', role: 'editor', text: 'This change starts from your latest design, not the older build on screen.' });
  }

  try {
    const role = routeTurn(request);
    emit({ type: 'start', turnId: randomUUID(), role, provider: provider.name, model: provider.model, capUsd: budget.capUsd });
    // Changing checks still on the card, or confirming new ones for a device that already exists.
    if (deps.verify && request.requirements && !request.requirementsConfirmed) return await askVerifier(request.brief ?? request.message, { current: request.requirements, request: request.message });
    if (deps.verify && request.requirementsConfirmed && request.design) {
      const next: CircuitDesign = { ...request.design, requirements: request.requirements ?? [] };
      return await build('editor', next, request.edits, request.jobId, 'Check the new requirements', [{ type: 'design', design: next, brief: request.brief ?? next.title, changes: ['Changed the requirements'] }]);
    }
    if (request.mode === 'chip') {
      // A board that exists is edited, not designed again.
      if (deps.chip && request.jobId) {
        const job = await board.get(request.jobId, signal);
        if (job.input?.kind !== 'plan' || !job.input.plan) { say('editor', 'That build isn’t a chip-level board, so it can’t be edited this way. Nothing was built.'); return finish('no-change'); }
        return await startChip(request.message, { plan: job.input.plan as ChipPlan, baseJobId: request.jobId, ...(request.ops ? { ops: request.ops } : {}) });
      }
      if (deps.chip && deps.verify && !request.requirementsConfirmed) return await askVerifier(request.message);
      if (!deps.chip) { say('designer', 'Chip-level boards aren’t available on this server yet. Nothing was built.'); return finish('no-change'); }
      return await startChip(request.message);
    }
    if (role === 'explainer') {
      const answer = await runExplainer(context, request.message, request.design, reader(request.jobId), request.history);
      say('explainer', answer);
      return finish('answered');
    }
    if (role === 'designer') return await design(request.message);
    await noteStaleContext();
    const { result, text } = await runEditor(context, request.message, request.design!, reader(request.jobId), request.edits, request.history);
    if (!result) { say('editor', text); return finish(text ? 'answered' : 'no-change'); }
    if (result.kind === 'new-design') return await design(request.message);
    if (result.kind === 'requirements') {
      say('editor', result.summary);
      if (!deps.verify) { say('editor', 'Requirement checks aren’t available on this server yet.'); return finish('no-change'); }
      return await askVerifier(request.brief ?? request.design!.title, { current: request.design!.requirements ?? [], request: result.request });
    }
    if (result.kind === 'firmware') {
      const current = request.design!;
      say('editor', result.summary);
      const written = await withFirmware(current, `${current.app?.brief ?? request.brief ?? current.title}\nChange now: ${result.request}`, firmwareProject(current)['src/main.cpp']);
      if ('outcome' in written) return written.outcome;
      return await build('editor', written.design, request.edits, request.jobId, result.summary, [{ type: 'design', design: written.design, brief: `${request.brief ?? ''}${request.brief ? '. ' : ''}${request.message}`, changes: ['Changed the firmware'] }]);
    }
    if (result.kind === 'decline') {
      if (deps.chip) return await toChip(`${request.brief ?? request.design!.title}. ${request.message}`);
      emit({ type: 'decline', message: result.message, closest: result.closest || null, closestBrief: result.closestBrief || null });
      return finish('declined');
    }
    say('editor', result.summary);
    const sameParts = partIds(result.design) === partIds(request.design!);
    // Firmware that was written for other parts can't be trusted to drive these, so it is rewritten and compiled again.
    const oldApp = result.design.app;
    if (oldApp && !sameParts) {
      const written = await withFirmware(result.design, `${oldApp.brief}\nChange now: ${request.message}`, oldApp.source);
      if ('outcome' in written) return written.outcome;
      result.design = written.design;
    }
    const announce: AgentEvent[] = result.designChanged
      ? [{ type: 'design', design: result.design, brief: `${request.brief ?? ''}${request.brief ? '. ' : ''}${request.message}`, changes: result.changes }]
      : result.edits ? [{ type: 'edit', edits: result.edits, changes: result.changes }] : [];
    // A base job pins existing parts where they are, and the job API has no spot yet for a new part beside
    // them, so a change of parts lays the board out afresh unless the maker has placed things by hand.
    return await build('editor', result.design, result.edits, sameParts || result.edits ? request.jobId : undefined, result.summary, announce);
  } catch (error) {
    if (error instanceof AgentStop) {
      if (error.reason === 'aborted') return finish('stopped');
      // The chat shows friendly words. The cause has to be somewhere, or a first live failure can't be diagnosed.
      console.error(`[agent] ${error.reason}: ${redact(error.message)}`);
      // Nothing was designed: the rule interpreter can still read it, exactly as with agents off.
      // A chip-level request is not the same device on a carrier, so it gets the truth and no fallback.
      if (!budget.pipelineMs && mode !== 'chip' && routeTurn(request) === 'designer') { emit({ type: 'fallback', reason: friendlyStop[error.reason] }); return finish('fallback'); }
      emit({ type: 'error', message: `${friendlyStop[error.reason]} ${error.reason === 'budget' ? error.message : ''}`.trim() });
      return finish('error');
    }
    if (signal?.aborted) return finish('stopped');
    const message = error instanceof BoardServiceError ? `The board service refused this: ${firstErrorLine(error.message)}` : `Something went wrong: ${error instanceof Error ? firstErrorLine(error.message) || 'unknown error' : 'unknown error'}`;
    emit({ type: 'error', message });
    return finish('error');
  }
}
