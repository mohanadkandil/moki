import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { LiveRun, StageState } from '../src/contracts/run.js';
import { createInspiration, getInspiration, chooseInspiration, inspirationImage,
  selectedInspiration, generateShowcase } from './inspiration-store.js';
import { createDesktopApi } from './desktop-api.js';
import { createProject, getProject, updateProjectTitle } from './project-store.js';
import { listProjectSummaries } from './project-index.js';

const artifactNames = ['board.kicad_pcb', 'pcb-geometry.json', 'product.py', 'product.step', 'product.glb',
  'geometry-check.json', 'report.json', 'electrical-plan.json', 'mechanical-plan.json', 'showcase.md',
  'moki-mechanical.png', 'moki-electrical.png', 'showcase.mp4'];
const names = [
  ['agents', 'Electrical planning'], ['workers', 'Daytona workers'],
  ['electrical', 'Proposed PCB outline'], ['handoff', 'Measured geometry handoff'],
  ['mechanical', 'First-pass enclosure'], ['validation', 'Geometry validation'],
  ['preview', '3D preview'], ['showcase', '10-second showcase'],
];

/** Local development bridge. Credentials and child processes stay in Node. */
export function workshopApi(): Plugin {
  const desktops = createDesktopApi();
  const jobs = new Map<string, LiveRun>();
  const project = process.cwd();
  const writes = new Map<string, Promise<void>>();
  let active: string | null = null;
  const directory = (id: string) => resolve(project, 'var/runs', id);
  const save = async (job: LiveRun) => {
    const snapshot = JSON.stringify(job, null, 2);
    const previous = writes.get(job.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await mkdir(directory(job.id), { recursive: true });
      const tmp = resolve(directory(job.id), 'run.tmp');
      await writeFile(tmp, snapshot); await rename(tmp, resolve(directory(job.id), 'run.json'));
    });
    writes.set(job.id, next); await next;
  };
  const load = async (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    if (jobs.has(id)) return jobs.get(id)!;
    try {
      const job: LiveRun = JSON.parse(await readFile(resolve(directory(id), 'run.json'), 'utf8'));
      // Restart recovery never displays an abandoned process as still running.
      if (job.status === 'running') { job.status = 'failed'; job.error = 'Server restarted during this run. Start another test.'; }
      jobs.set(id, job);
      return job;
    } catch { return null; }
  };
  async function latestRun(projectId: string) {
    const candidates = [...jobs.values()].filter(job => job.projectId === projectId);
    const entries = await readdir(resolve(project, 'var/runs'), {withFileTypes:true}).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name) || jobs.has(entry.name)) continue;
      try {
        const data: LiveRun = JSON.parse(await readFile(resolve(directory(entry.name), 'run.json'), 'utf8'));
        if (data.projectId === projectId) { const job = await load(entry.name); if (job) candidates.push(job); }
      } catch {}
    }
    return candidates.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0] || null;
  }
  function update(job: LiveRun, stage: string, state: StageState, message: string) {
    const at = new Date().toISOString();
    const item = job.stages.find(s => s.id === stage);
    if (item) {
      item.state = state; item.message = message.slice(0, 500);
      if (state === 'running') item.startedAt = at;
      else item.finishedAt = at;
    }
    job.events.push({ stage, state, message: message.slice(0, 500), at });
    void save(job).catch(() => {});
  }
  async function script(job: LiveRun, name: string, eventMode = false) {
    await new Promise<void>((yes, no) => {
      const child = spawn(process.execPath,
        [resolve(project, 'node_modules/tsx/dist/cli.mjs'), resolve(project, 'scripts', name), '--use-cli-profile'],
        { cwd: project, env: { ...process.env, MOKI_RUN_ID: job.id }, stdio: ['ignore', 'pipe', 'pipe'] });
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        if (!eventMode || !line.startsWith('MOKI_EVENT ')) return;
        try {
          const event = JSON.parse(line.slice(11));
          if (job.stages.some(s => s.id === event.stage) && ['running', 'passed', 'failed', 'blocked'].includes(event.state)) {
            update(job, event.stage, event.state, event.message);
          }
        } catch { /* Non-event tool output stays in the process. */ }
      });
      // Consume stderr without surfacing SDK request objects or environment data.
      child.stderr.on('data', () => {});
      const timeout = setTimeout(() => { child.kill('SIGTERM'); }, 300_000);
      child.on('error', () => { clearTimeout(timeout); no(new Error('Could not start the worker adapter')); });
      child.on('close', code => { clearTimeout(timeout); code === 0 ? yes() : no(new Error(`${name} failed. Inspect the saved checker report.`)); });
    });
  }
  async function execute(job: LiveRun) {
    async function refreshArtifacts() {
      for (const name of artifactNames) {
        if (job.artifacts.some(a => a.name === name)) continue;
        try {
          const file = await readFile(resolve(directory(job.id), name));
          job.artifacts.push({ name, url: `/api/runs/${job.id}/artifacts/${name}`, bytes: file.length,
            sha256: createHash('sha256').update(file).digest('hex') });
        } catch { /* The stage producing this artifact has not completed. */ }
      }
    }
    try {
      await save(job);
      const selection = await selectedInspiration(job.inspirationId!, job.conceptId!);
      await writeFile(resolve(directory(job.id), 'design-input.json'), JSON.stringify({ brief: job.brief, inspirationId: job.inspirationId,
        conceptId: job.conceptId, imagePath: selection.imagePath }));
      await script(job, 'design-run.ts', true);
      job.report = JSON.parse(await readFile(resolve(directory(job.id), 'report.json'), 'utf8'));
      if (!job.report?.ok) throw new Error('Design generation did not complete');
      await refreshArtifacts();
      const story = `# ${selection.title}\n\n${job.brief}\n\nFirst-pass CAD and a proposed PCB outline were generated from this brief and the selected visual direction. ` +
        'Independent geometry measurements are in geometry-check.json. Functional circuit, component-envelope and manufacturing checks remain unverified. ' +
        'The FLUX showcase film uses the selected visual concept, not the CAD geometry.\n';
      await writeFile(resolve(directory(job.id), 'showcase.md'), story);
      update(job, 'showcase', 'running', 'FLUX 3 Video · 10-second film from your selected visual direction.');
      try {
        await generateShowcase(job.inspirationId!, job.conceptId!, directory(job.id));
        update(job, 'showcase', 'passed', '10-second concept film saved. Visual concept, not CAD-grounded.');
      } catch (error) { update(job, 'showcase', 'failed', error instanceof Error ? error.message : 'Showcase generation failed'); }
      await refreshArtifacts();
      job.status = 'completed';
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Run failed';
      for (const stage of job.stages) if (stage.state === 'running') update(job, stage.id, 'failed', job.error);
      try { job.report = JSON.parse(await readFile(resolve(directory(job.id), 'report.json'), 'utf8')); } catch {}
    } finally {
      await refreshArtifacts();
      job.finishedAt = new Date().toISOString();
      active = null;
      await save(job);
    }
  }
  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  async function body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 12_000) throw new Error('Request too large');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  return {
    name: 'moki-local-workshop-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true, mode: 'local-workshop' });
          if (await desktops.handle(req, res, url.pathname)) return;
          if (url.pathname === '/projects' && req.method === 'GET') return json(res, 200, await listProjectSummaries());
          if (req.method === 'POST' && ['/projects', '/inspirations', '/runs'].includes(url.pathname) || req.method === 'POST' && /^\/(inspirations|projects)\//.test(url.pathname)) {
            const origin = req.headers.origin;
            if (!origin || new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Same-origin requests only' });
          }
          if (url.pathname === '/projects' && req.method === 'POST') {
            const input = await body(req);
            try { return json(res, 201, await createProject(input.brief)); }
            catch { return json(res, 400, { error: 'Could not save this project. Enter a product idea and try again.' }); }
          }
          const projectMatch = url.pathname.match(/^\/projects\/([a-f0-9-]{36})(?:\/(title|latest-run))?$/);
          if (projectMatch) {
            if (req.method === 'GET' && !projectMatch[2]) {
              const value = await getProject(projectMatch[1]!); return json(res, value ? 200 : 404, value || { error: 'Project not found' });
            }
            if (req.method === 'POST' && projectMatch[2] === 'title') {
              const input = await body(req); return json(res, 200, await updateProjectTitle(projectMatch[1]!, input.title));
            }
            if (req.method === 'GET' && projectMatch[2] === 'latest-run') return json(res, 200, await latestRun(projectMatch[1]!));
          }
          if (url.pathname === '/inspirations' && req.method === 'POST') {
            const input = await body(req);
            if (typeof input.brief !== 'string' || !input.brief.trim() || input.brief.length > 5000) return json(res, 400, { error: 'A product brief is required' });
            try { return json(res, 202, await createInspiration(input.brief, input.force === true, input.projectId)); }
            catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : 'Could not generate inspiration' }); }
          }
          const inspiration = url.pathname.match(/^\/inspirations\/([a-f0-9-]{36})(?:\/(select|images\/direction-[1-4]\.jpg))?$/);
          if (inspiration) {
            if (req.method === 'POST' && inspiration[2] === 'select') {
              const input = await body(req);
              try { return json(res, 200, await chooseInspiration(inspiration[1]!, input.conceptId)); }
              catch { return json(res, 400, { error: 'Choose an available concept image' }); }
            }
            if (req.method === 'GET' && inspiration[2]?.startsWith('images/')) {
              const file = await inspirationImage(inspiration[1]!, inspiration[2].slice(7));
              if (!file) return json(res, 404, { error: 'Image not found' });
              res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
              createReadStream(file).pipe(res); return;
            }
            if (req.method === 'GET' && !inspiration[2]) {
              const set = await getInspiration(inspiration[1]!);
              return json(res, set ? 200 : 404, set || { error: 'Inspiration not found' });
            }
          }
          if (url.pathname === '/runs' && req.method === 'POST') {
            const origin = req.headers.origin;
            if (!origin || new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Same-origin requests only' });
            if (active) return json(res, 409, { error: 'A test is already running', runId: active });
            const input = await body(req);
            if (input.mode !== 'design' || typeof input.brief !== 'string' || input.brief.length > 5000) return json(res, 400, { error: 'Expected a design brief' });
            const savedProject = await getProject(input.projectId);
            if (!savedProject || savedProject.brief !== input.brief) return json(res, 409, {error:'Open the saved workshop for this brief'});
            try {
              const selection = await selectedInspiration(input.inspirationId, input.conceptId);
              if (selection.brief !== input.brief) return json(res, 409, { error: 'The selected direction belongs to a different brief' });
            } catch { return json(res, 409, { error: 'Select a generated inspiration image first' }); }
            const job: LiveRun = { id: randomUUID(), brief: input.brief, status: 'running', createdAt: new Date().toISOString(),
              inspirationId: input.inspirationId, conceptId: input.conceptId,
              projectId: input.projectId,
              stages: names.map(([id, name]) => ({ id: id!, name: name!, state: 'pending' })), events: [], artifacts: [] };
            jobs.set(job.id, job); active = job.id;
            json(res, 202, job);
            void execute(job).catch(() => { active = null; });
            return;
          }
          const match = url.pathname.match(/^\/runs\/([a-f0-9-]{36})(?:\/artifacts\/([a-zA-Z0-9_.-]+))?$/);
          if (match && req.method === 'GET') {
            const job = await load(match[1]!);
            if (!job) return json(res, 404, { error: 'Run not found' });
            if (!match[2]) return json(res, 200, job);
            const name = match[2];
            if (!artifactNames.includes(name) || !job.artifacts.some(a => a.name === name)) return json(res, 404, { error: 'Artifact not found' });
            const path = resolve(directory(job.id), name);
            const info = await stat(path);
            const type = name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.glb') ? 'model/gltf-binary' : name.endsWith('.png') ? 'image/png' : name.endsWith('.json') ? 'application/json' : 'text/plain';
            res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
              ...(/\.(kicad_pcb|step|py)$/.test(name) ? {'Content-Disposition': `attachment; filename="${name}"`} : {}) });
            createReadStream(path).pipe(res);
            return;
          }
          json(res, 404, { error: 'Unknown workshop endpoint' });
        } catch { json(res, 400, { error: 'Invalid workshop request' }); }
      });
    },
  };
}
