// What a project's card says and shows. Pure, so the words can be tested. Everything comes from the project or its job.
import { assessJob, type AgentJob } from '../../../src/agents/facts';
import { cleanBrief } from '../../../src/agents/brief-text';
import type { BoardJob } from '../board/types';
import { settledStatus, type ProjectSummary } from './projectsApi';

/** A job we've asked about. Null means the server no longer has it. */
export type KnownJobs = Readonly<Record<string, BoardJob | null | undefined>>;
export type Tone = 'ok' | 'ask' | 'no' | 'busy' | 'quiet';
export interface CardStatus { label: string; tone: Tone; /** Built, but the agent hasn't held this build up against the brief. */ unchecked?: boolean }
export type Picture =
  | { kind: 'pending' }
  | { kind: 'photo'; jobId: string; job: BoardJob; earlier: boolean }
  | { kind: 'drawing' }
  | { kind: 'blank' };
export interface Fact { label: string; value: string; short: string }

export const jobIdsOf = (p: ProjectSummary): string[] => p.jobIds ?? (p.lastJobId ? [p.lastJobId] : []);

/** The builds worth asking about: newest first, as far back as the first one that worked. */
export function jobsToAsk(p: ProjectSummary, jobs: KnownJobs): string[] {
  const out: string[] = [];
  for (const id of jobIdsOf(p)) {
    const job = jobs[id];
    if (job === undefined || job?.status === 'queued' || job?.status === 'running') out.push(id);
    if (job === undefined || job?.status === 'done') break;
  }
  return out;
}

export function pictureOf(p: ProjectSummary, jobs: KnownJobs, broken: ReadonlySet<string> = new Set()): Picture {
  const ids = jobIdsOf(p);
  for (let i = 0; i < ids.length; i++) {
    const job = jobs[ids[i]!];
    if (job === undefined) return { kind: 'pending' };
    if (job?.status === 'done' && !broken.has(ids[i]!)) return { kind: 'photo', jobId: ids[i]!, job, earlier: i > 0 };
  }
  return p.card?.sheet ? { kind: 'drawing' } : { kind: 'blank' };
}

export function cardStatus(p: ProjectSummary, jobs: KnownJobs): CardStatus {
  const latest = jobIdsOf(p)[0];
  const status = settledStatus(p.status, latest ? jobs[latest] as Partial<AgentJob> | null | undefined ?? null : null, p.hasRequirements);
  const note = p.card?.note ?? null;
  switch (status) {
    case 'built': return { label: 'Built', tone: 'ok' };
    // It did build. That the brief hasn't been checked against it is a fact about the build, so it goes with the facts.
    case 'unverified': return { label: 'Built', tone: 'ok', unchecked: true };
    case 'building': return { label: 'Building', tone: 'busy' };
    case 'failed': return { label: "Didn't build", tone: 'no' };
    default:
  }
  if (note?.kind === 'decline') return { label: "Didn't build", tone: 'no' };
  if (status === 'stopped') return { label: 'Stopped', tone: 'quiet' };
  if (status === 'waiting') return note?.kind === 'stopped' ? { label: 'Stopped', tone: 'quiet' } : { label: 'Needs your answer', tone: 'ask' };
  return { label: 'Draft', tone: 'quiet' };
}

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(?:(?:please|design|build|make|create|me)\s+)*(?:(?:an?|the)\s+)?/, '');
/** The brief as written, minus the paste's gutters and whatever only repeats the title. Empty when that's all it said. */
export function briefText(p: Pick<ProjectSummary, 'brief' | 'title'>): string {
  const brief = cleanBrief(p.brief).replace(/\s*\n\s*/g, ' ');
  const title = words(p.title);
  if (words(brief) === title) return '';
  const colon = brief.indexOf(':');
  if (colon > 0 && words(brief.slice(0, colon)) === title) {
    const rest = brief.slice(colon + 1).trim();
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return brief;
}

const month = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
/** Projects that share a title are told apart by when each began, which is the one thing that's always different. */
export function repeatTags(projects: readonly ProjectSummary[]): Map<string, string> {
  const groups = new Map<string, ProjectSummary[]>();
  for (const p of projects) { const key = p.title.trim().toLowerCase(); groups.set(key, [...(groups.get(key) ?? []), p]); }
  const tags = new Map<string, string>();
  for (const group of groups.values()) if (group.length > 1) for (const p of group) tags.set(p.id, month(p.createdAt));
  return tags;
}

const seconds = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
const money = (usd: number) => (usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`);
/** Only what the pictured build and the saved chat recorded. A missing number is left out, never guessed. */
export function factsOf(p: ProjectSummary, picture: Picture, unchecked = false): Fact[] {
  if (picture.kind !== 'photo') return [];
  const { job, earlier } = picture;
  const facts: Fact[] = [];
  if (job.board) {
    const size = `${Math.round(job.board.widthMm)} × ${Math.round(job.board.heightMm)} mm`;
    facts.push({ label: 'Board', value: `${size}, ${job.board.layers} layers`, short: size });
  }
  const plan = (job.input as { kind?: string; plan?: { blocks?: unknown[] } } | undefined)?.plan;
  if (plan?.blocks) facts.push({ label: 'Blocks', value: `${plan.blocks.length}, on a chip-level board`, short: `${plan.blocks.length} blocks` });
  else if (!earlier && p.card?.parts) {
    const count = `${p.card.parts} part${p.card.parts === 1 ? '' : 's'}`;
    facts.push({ label: 'Parts', value: p.card.controller ? `${p.card.parts}, on ${p.card.controller}` : String(p.card.parts), short: count });
  }
  if (assessJob(job as unknown as AgentJob).compile === 'compiled') facts.push({ label: 'Firmware', value: 'Compiled ✓', short: 'Compiled ✓' });
  if (unchecked) facts.push({ label: 'Your brief', value: 'Not checked on this build yet', short: 'Brief not checked yet' });
  if (job.totalMs) facts.push({ label: 'Build', value: seconds(job.totalMs), short: `Built in ${seconds(job.totalMs)}` });
  if (p.card?.costUsd) facts.push({ label: 'Agent cost', value: money(p.card.costUsd), short: money(p.card.costUsd) });
  return facts;
}

/** The agent's last word, as one quiet sentence under the title. A clause past a semicolon is more than a card needs. */
export function lastLine(p: ProjectSummary): string {
  const text = p.card?.note?.text.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentence = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  const semicolon = sentence.indexOf(';');
  return semicolon > 0 ? `${sentence.slice(0, semicolon)}.` : sentence;
}

/** The newest project with a build to look at takes the wide spot. Without one, every card is the same size. */
export function arrange(projects: readonly ProjectSummary[], jobs: KnownJobs, broken: ReadonlySet<string> = new Set()): { lead: ProjectSummary | null; rest: ProjectSummary[] } {
  const lead = projects.find(p => {
    const kind = pictureOf(p, jobs, broken).kind;
    return kind === 'photo' || kind === 'pending';
  }) ?? null;
  return { lead, rest: projects.filter(p => p !== lead) };
}
