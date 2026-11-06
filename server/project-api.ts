// Projects: one brief, its chat, its builds. The browser saves the chat it has drawn, and the agent API adds what
// it knows for certain, so closing a tab mid-build loses neither. Same gate as the board and agent APIs.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { EffortId, TurnOutcome } from '../src/agents/protocol.js';
import { cleanBrief } from '../src/agents/brief-text.js';
import { assessJob, type AgentJob } from '../src/agents/facts.js';
import { titleFromBrief } from '../src/agents/project-title.js';
import { CATALOG } from '../src/circuit/catalog.js';
import { MAX_BRIEF_LENGTH } from '../src/circuit/interpret.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LIST = 20;
const MAX_TITLE = 80;
const MAX_CREATE_BODY = 8_000;
/** A saved chat holds designs and job records. Past this, the browser hears it wasn't saved. */
const MAX_STATE_BODY = 2_000_000;
const MAX_JOBS = 200;

export type ProjectStatus = 'new' | 'waiting' | 'building' | 'built' | 'unverified' | 'failed' | 'stopped';
export interface ProjectJob { jobId: string; label: string | null; at: string }
export interface ProjectState { turns: unknown[]; session: unknown; canvasJobId: string | null }
export interface ProjectRecord {
  schema: 'moki.project/1';
  id: string;
  title: string;
  titleEdited: boolean;
  brief: string;
  effort: EffortId;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  /** What the browser last drew. Null until the chat starts. */
  state: ProjectState | null;
  /** Goes up with every save, so a tab with an old copy can't overwrite a newer one. */
  stateRev: number;
  /** The build an agent gave its verdict on. A save can't overrule that verdict. */
  verdictJobId: string | null;
  /** Every build this project's agent turns started, so a closed tab can't lose one. */
  jobs: ProjectJob[];
}
export type ProjectSummary = Pick<ProjectRecord, 'id' | 'title' | 'brief' | 'effort' | 'createdAt' | 'updatedAt' | 'status'> & {
  /** The newest build, so a list can ask how it ended after the tab closed. */
  lastJobId: string | null;
  /** Confirmed requirements need an agent's final check, so a build alone can't make this project done. */
  hasRequirements: boolean;
  /** The last few builds, newest first, so a list can go back to one that worked. */
  jobIds: string[];
  card: ProjectCard;
};
/** Where the agent left this project, from its saved chat. Everything here was said or measured there. */
export interface ProjectCard {
  /** What the agent last asked, refused, or how its turn ended. */
  note: { kind: 'ask' | 'decline' | 'stopped'; text: string } | null;
  /** What the turns have cost, across all of them. */
  costUsd: number | null;
  parts: number | null;
  /** The controller the design is built on. */
  controller: string | null;
  /** The saved design, while there's no build to show. Enough to draw its schematic and no more. */
  sheet: { title: string; parts: unknown[]; nets: unknown[] } | null;
}

export { titleFromBrief };

interface SavedItem { kind?: string; summary?: string; text?: string; message?: string; settled?: string }
const firstSentence = (text: string) => /^.*?[.!?](?=\s|$)/s.exec(text.trim())?.[0] ?? text.trim();

export function projectCard(state: ProjectState | null | undefined, status: ProjectStatus): ProjectCard {
  const turns = (state?.turns ?? []) as { kind?: string; view?: { items?: SavedItem[]; usage?: { costUsd?: unknown } | null } }[];
  const items = turns.flatMap(t => (t?.kind === 'agent' ? t.view?.items ?? [] : []));
  const cost = turns.reduce((sum, t) => sum + (typeof t?.view?.usage?.costUsd === 'number' ? t.view.usage.costUsd : 0), 0);
  const last = [...items].reverse().find(i => i?.kind === 'decline' || i?.kind === 'error' || i?.kind === 'note' || i?.kind === 'requirements');
  const question = status === 'waiting' ? [...items].reverse().find(i => i?.kind === 'requirements' && i.settled === 'open') : undefined;
  const stopped = last?.kind === 'error' || last?.kind === 'note' ? firstSentence(last.text ?? '') : '';
  let note: ProjectCard['note'] = null;
  if (last?.kind === 'decline' && last.message) note = { kind: 'decline', text: last.message };
  else if (question && (question.message || question.summary)) note = { kind: 'ask', text: question.message ?? firstSentence(question.summary!) };
  else if (stopped) note = { kind: 'stopped', text: stopped };
  const revisions = (state?.session as { revisions?: { design?: { title?: string; parts?: { module?: string }[]; nets?: unknown[] } }[] } | null | undefined)?.revisions;
  const design = Array.isArray(revisions) ? revisions.at(-1)?.design : undefined;
  const controller = design?.parts?.map(p => CATALOG.get(p.module ?? '')).find(d => d?.category === 'controller')?.name ?? null;
  const built = status === 'built' || status === 'unverified';
  return {
    note,
    costUsd: cost > 0 ? cost : null,
    parts: design?.parts?.length ?? null,
    controller,
    sheet: !built && design?.parts && design.nets ? { title: design.title ?? '', parts: design.parts, nets: design.nets } : null,
  };
}

const statusOfOutcome = (outcome: TurnOutcome, current: ProjectStatus): ProjectStatus => {
  switch (outcome) {
    case 'awaiting-confirmation': return 'waiting';
    case 'built': return 'built';
    case 'built-unverified': return 'unverified';
    case 'build-failed': case 'error': return 'failed';
    case 'stopped': return current === 'built' || current === 'unverified' ? current : 'stopped';
    default: return current;
  }
};

/** What a build alone can say, with the same test an agent uses. Requirements need an agent's final check, so they cap it. */
export function statusOfJob(job: Partial<AgentJob> | null | undefined, current: ProjectStatus, requirements: boolean): ProjectStatus {
  if (!job?.status) return current;
  if (job.status === 'queued' || job.status === 'running') return 'building';
  if (!assessJob(job as AgentJob).ok) return 'failed';
  return requirements ? 'unverified' : 'built';
}
const hasRequirements = (session: unknown) => {
  const revisions = (session as { revisions?: unknown } | null)?.revisions;
  return Array.isArray(revisions) && Boolean((revisions.at(-1) as { design?: { requirements?: unknown[] } } | undefined)?.design?.requirements?.length);
};
export class StaleSave extends Error {}

export class BadProject extends Error {}

export function createProjectStore(root: string) {
  const dir = resolve(root);
  const projects = new Map<string, ProjectRecord>();
  const writes = new Map<string, Promise<void>>();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(dir)) {
    if (!ID.test(name)) continue;
    try {
      const value = JSON.parse(readFileSync(join(dir, name, 'project.json'), 'utf8')) as ProjectRecord;
      if (value.schema === 'moki.project/1' && value.id === name) projects.set(name, value);
    } catch { /* A torn or foreign folder isn't a project. */ }
  }

  /** Writes in order, each atomic, so a slow older save can't overwrite a newer one. */
  function persist(project: ProjectRecord): Promise<void> {
    const snapshot = `${JSON.stringify(project)}\n`;
    const next = (writes.get(project.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const folder = join(dir, project.id);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const temporary = join(folder, `project.${randomUUID()}.tmp`);
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, join(folder, 'project.json'));
    });
    writes.set(project.id, next);
    return next;
  }
  const touch = (project: ProjectRecord) => { project.updatedAt = new Date().toISOString(); return persist(project); };

  return {
    async create(brief: string, effort: EffortId): Promise<ProjectRecord> {
      const now = new Date().toISOString();
      const project: ProjectRecord = { schema: 'moki.project/1', id: randomUUID(), title: titleFromBrief(brief), titleEdited: false, brief, effort, createdAt: now, updatedAt: now, status: 'new', state: null, stateRev: 0, verdictJobId: null, jobs: [] };
      projects.set(project.id, project);
      await persist(project);
      return project;
    },
    get: (id: string) => (ID.test(id) ? projects.get(id) : undefined),
    recent(): ProjectSummary[] {
      return [...projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_LIST)
        .map(({ id, title, brief, effort, createdAt, updatedAt, status, jobs, state }) => ({ id, title, brief, effort, createdAt, updatedAt, status, lastJobId: jobs.at(-1)?.jobId ?? null, hasRequirements: hasRequirements(state?.session), jobIds: jobs.slice(-4).reverse().map(j => j.jobId), card: projectCard(state, status) }));
    },
    async setTitle(project: ProjectRecord, title: string) { project.title = title; project.titleEdited = true; await touch(project); },
    async setState(project: ProjectRecord, state: ProjectState, baseRev?: number) {
      if (baseRev !== undefined && baseRev !== (project.stateRev ?? 0)) throw new StaleSave();
      project.state = state;
      project.stateRev = (project.stateRev ?? 0) + 1;
      // The browser knows about builds the rules started, which never pass through the agent API.
      for (const turn of state.turns as { kind?: string; label?: string | null; job?: { jobId?: unknown } | null }[]) {
        const jobId = turn?.kind === 'run' ? turn.job?.jobId : undefined;
        if (typeof jobId === 'string' && ID.test(jobId) && !project.jobs.some(j => j.jobId === jobId) && project.jobs.length < MAX_JOBS) project.jobs.push({ jobId, label: typeof turn.label === 'string' ? turn.label.slice(0, 200) : null, at: new Date().toISOString() });
      }
      const last = [...state.turns as { kind?: string; job?: Partial<AgentJob> | null }[]].reverse().find(t => t?.kind === 'run');
      // The browser polls faster than the agent, and can even report an old state late. Only an agent's verdict is final.
      if (last?.job?.jobId && last.job.jobId !== project.verdictJobId) project.status = statusOfJob(last.job, project.status, hasRequirements(state.session));
      await touch(project);
    },
    /** What the agent API knows for certain. It runs on the server, so it survives a closed tab. */
    async noteJob(id: string, jobId: string, label: string | null) {
      const project = this.get(id);
      if (!project || !ID.test(jobId) || project.jobs.some(j => j.jobId === jobId) || project.jobs.length >= MAX_JOBS) return;
      project.jobs.push({ jobId, label: label?.slice(0, 200) ?? null, at: new Date().toISOString() });
      project.status = 'building';
      await touch(project);
    },
    async noteOutcome(id: string, outcome: TurnOutcome) {
      const project = this.get(id);
      if (!project) return;
      project.status = statusOfOutcome(outcome, project.status);
      if (outcome === 'built' || outcome === 'built-unverified' || outcome === 'build-failed') project.verdictJobId = project.jobs.at(-1)?.jobId ?? null;
      await touch(project);
    },
    settled: async () => { await Promise.allSettled([...writes.values()]); },
  };
}
export type ProjectStore = ReturnType<typeof createProjectStore>;

/** A title a person typed: one line, no control characters. */
function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') throw new BadProject('title must be text.');
  // eslint-disable-next-line no-control-regex
  const title = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title) throw new BadProject('A project needs a title.');
  if (title.length > MAX_TITLE) throw new BadProject(`A title is at most ${MAX_TITLE} characters.`);
  return title;
}

function cleanState(value: unknown): ProjectState {
  const state = value as Partial<ProjectState> | null;
  if (typeof state !== 'object' || state === null || !Array.isArray(state.turns) || state.turns.length > 1000) throw new BadProject('state needs its turns.');
  if (typeof state.session !== 'object' || state.session === null) throw new BadProject('state needs its session.');
  if (state.canvasJobId !== null && state.canvasJobId !== undefined && (typeof state.canvasJobId !== 'string' || !ID.test(state.canvasJobId))) throw new BadProject('canvasJobId is not valid.');
  for (const key of Object.keys(state)) if (!['turns', 'session', 'canvasJobId'].includes(key)) throw new BadProject(`Unknown state field: ${key.slice(0, 40)}`);
  return { turns: state.turns, session: state.session, canvasJobId: state.canvasJobId ?? null };
}

export function createProjectService(options: { root: string; env?: NodeJS.ProcessEnv; store?: ProjectStore; shared?: boolean }) {
  const env = options.env ?? process.env;
  const store = options.store ?? createProjectStore(options.root);
  const tokenHash = env.MOKI_BOARD_API_TOKEN ? createHash('sha256').update(env.MOKI_BOARD_API_TOKEN).digest() : undefined;
  const json = (res: ServerResponse, code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

  async function readJson(req: IncomingMessage, res: ServerResponse, limit: number): Promise<Record<string, unknown> | null> {
    if (req.headers.origin) {
      let same = false;
      try { same = new URL(req.headers.origin).host === req.headers.host; } catch { /* A malformed Origin is not same-origin. */ }
      if (!same) { json(res, 403, { error: 'Same-origin requests only' }); return null; }
    }
    if (!(req.headers['content-type'] ?? '').includes('application/json')) { json(res, 415, { error: 'Send application/json' }); return null; }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      const data = Buffer.from(chunk);
      bytes += data.length;
      if (bytes > limit) { json(res, 413, { error: 'That is too large to save.' }); return null; }
      chunks.push(data);
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      if (typeof body === 'object' && body !== null && !Array.isArray(body)) return body as Record<string, unknown>;
    } catch { /* Falls through to the same answer. */ }
    json(res, 400, { error: 'Send a JSON object.' });
    return null;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path !== '/api/projects' && !path.startsWith('/api/projects/')) return next();
    // On the dev server the older /workshop uses these paths too. Only this app's requests say who they are.
    if (options.shared && req.headers['x-moki-projects'] !== '1') return next();
    try {
      if (tokenHash) {
        const supplied = req.headers['x-moki-capability'];
        const hash = createHash('sha256').update(typeof supplied === 'string' ? supplied : '').digest();
        if (!timingSafeEqual(tokenHash, hash)) return json(res, 401, { error: 'Project API capability required' });
      }
      if (path === '/api/projects') {
        if (req.method === 'GET') return json(res, 200, { projects: store.recent() });
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        const body = await readJson(req, res, MAX_CREATE_BODY);
        if (!body) return;
        for (const key of Object.keys(body)) if (!['brief', 'effort'].includes(key)) return json(res, 400, { error: `Unknown project field: ${key.slice(0, 40)}` });
        const brief = typeof body.brief === 'string' ? cleanBrief(body.brief) : '';
        if (!brief) return json(res, 400, { error: 'Say what you want to make.' });
        if (brief.length > MAX_BRIEF_LENGTH) return json(res, 400, { error: `A brief is at most ${MAX_BRIEF_LENGTH} characters.` });
        const effort = body.effort ?? 'balanced';
        if (effort !== 'fast' && effort !== 'balanced' && effort !== 'deep') return json(res, 400, { error: 'effort is not valid.' });
        const project = await store.create(brief, effort);
        return json(res, 201, { projectId: project.id });
      }
      const id = path.slice('/api/projects/'.length);
      if (!ID.test(id)) return json(res, 404, { error: 'Project not found' });
      const project = store.get(id);
      if (!project) return json(res, 404, { error: 'Project not found' });
      if (req.method === 'GET') return json(res, 200, project);
      if (req.method !== 'PATCH') return json(res, 405, { error: 'Method not allowed' });
      const body = await readJson(req, res, MAX_STATE_BODY);
      if (!body) return;
      for (const key of Object.keys(body)) if (!['title', 'state', 'baseRev'].includes(key)) return json(res, 400, { error: `Unknown project field: ${key.slice(0, 40)}` });
      if (body.title === undefined && body.state === undefined) return json(res, 400, { error: 'Nothing to change.' });
      if (body.title !== undefined) await store.setTitle(project, cleanTitle(body.title));
      if (body.baseRev !== undefined && (!Number.isSafeInteger(body.baseRev) || (body.baseRev as number) < 0)) return json(res, 400, { error: 'baseRev is not valid.' });
      if (body.state !== undefined) await store.setState(project, cleanState(body.state), body.baseRev as number | undefined);
      return json(res, 200, { updatedAt: project.updatedAt, title: project.title, stateRev: project.stateRev });
    } catch (error) {
      if (error instanceof BadProject) return json(res, 400, { error: error.message });
      if (error instanceof StaleSave) return json(res, 409, { error: 'This project changed somewhere else. Reload to see the latest.' });
      if (!res.headersSent) json(res, 500, { error: 'The project could not be saved.' });
      else res.end();
    }
  }
  return { handle, store };
}

export const projectsRoot = (env: NodeJS.ProcessEnv = process.env) => resolve(env.MOKI_PROJECTS_DIR ?? (env.NODE_ENV === 'production' ? 'var/projects-app' : 'var/studio-projects'));

let shared: ProjectStore | undefined;
/** One store in this process, shared by this API and the agent API that adds to it. */
export const projectStore = (): ProjectStore => (shared ??= createProjectStore(projectsRoot()));

export function projectApi(): Plugin {
  type Server = { middlewares: { use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): unknown } };
  const attach = (isShared: boolean) => (server: Server) => {
    const service = createProjectService({ root: projectsRoot(), store: projectStore(), shared: isShared });
    server.middlewares.use((req, res, next) => { void service.handle(req, res, next); });
  };
  return { name: 'moki-project-api', configureServer: attach(true) as never, configurePreviewServer: attach(false) as never };
}
