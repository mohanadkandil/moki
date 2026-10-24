import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { InspirationConcept, InspirationSet } from '../src/contracts/inspiration.js';

type Task = { id: string; polling_url: string; cost?: number };
type StoredConcept = InspirationConcept & { prompt: string; task?: Task; costCredits?: number };
type StoredSet = Omit<InspirationSet, 'concepts'> & { concepts: StoredConcept[]; projectId?: string };
const sets = new Map<string, StoredSet>();
const working = new Set<string>();
const directions = [
  { title: 'Soft & tactile', direction: 'Warm rounded forms, matte soft-touch polymer, playful accent controls, reassuring and friendly.' },
  { title: 'Quiet precision', direction: 'Restrained machined aluminum, soft silver and charcoal, precise details, calm proportions, discreet controls.' },
  { title: 'Playful utility', direction: 'Expressive compact silhouette, bold primary color accent, chunky practical controls, honest exposed fasteners.' },
  { title: 'Natural warmth', direction: 'Warm ceramic-like ivory surfaces, natural wood accents, restrained earth tones, gentle sculptural silhouette.' },
];
function path(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Unknown inspiration'); return resolve('var/inspirations', id); }
async function persist(set: StoredSet) { await mkdir(path(set.id), { recursive: true }); await writeFile(resolve(path(set.id), 'set.json'), JSON.stringify(set, null, 2)); }
function visible(set: StoredSet): InspirationSet {
  return { id: set.id, brief: set.brief, model: set.model, status: set.status, selectedId: set.selectedId, error: set.error,
    concepts: set.concepts.map(({ id, title, direction, status, imageUrl, error }) => ({ id, title, direction, status, imageUrl, error })) };
}
function key() { const value = process.env.BFL_API_KEY; if (!value) throw new Error('BFL is not configured on the server'); return value; }
function official(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !(parsed.hostname === 'api.bfl.ai' || parsed.hostname.endsWith('.bfl.ai') || parsed.hostname.endsWith('.bfl.ml'))) throw new Error('Unexpected BFL polling host');
  return parsed.href;
}
async function submit(endpoint: string, input: Record<string, unknown>): Promise<Task> {
  const response = await fetch(`https://api.bfl.ai/v1/${endpoint}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-key': key() }, body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(response.status === 402 ? 'BFL credits are insufficient' : response.status === 401 || response.status === 403 ? 'BFL authentication was rejected' : `BFL request failed (HTTP ${response.status})`);
  const task: Task = await response.json();
  if (!task.id || !task.polling_url) throw new Error('BFL did not return a task');
  official(task.polling_url);
  return task;
}
async function finish(task: Task, milliseconds: number) {
  const deadline = Date.now() + milliseconds;
  let errors = 0;
  while (Date.now() < deadline) {
    await delay(2000);
    let response: Response;
    try { response = await fetch(official(task.polling_url), { headers: { 'x-key': key() }, signal: AbortSignal.timeout(20_000) }); }
    catch { if (++errors > 3) throw new Error('BFL polling connection interrupted'); else continue; }
    if (!response.ok) { if (response.status >= 500 && ++errors < 4) continue; throw new Error(`BFL polling failed (HTTP ${response.status})`); }
    const result = await response.json();
    if (result.status === 'Ready') {
      const sample = result.result?.sample;
      if (typeof sample !== 'string' || new URL(sample).protocol !== 'https:') throw new Error('BFL returned no downloadable output');
      return sample;
    }
    if (['Error', 'Request Moderated', 'Content Moderated', 'Task not found'].includes(result.status)) throw new Error(`BFL task: ${result.status}`);
  }
  throw new Error('BFL generation exceeded its time limit');
}
async function download(url: string, limit: number, kind: 'image' | 'video') {
  // No authorization header follows the provider's signed media URL.
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error('Could not download the BFL output');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith(kind + '/') && contentType !== 'application/octet-stream') throw new Error('Unexpected BFL output format');
  const chunks: Uint8Array[] = []; let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new Error('BFL output exceeds download limit'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function generate(set: StoredSet) {
  if (working.has(set.id)) return;
  working.add(set.id); set.status = 'running'; set.error = undefined;
  await persist(set);
  try {
    await Promise.allSettled(set.concepts.map(async concept => {
      if (concept.status === 'ready') return;
      concept.status = 'running'; concept.error = undefined;
      try {
        // A persisted remote task is polled again; a refresh never submits it twice.
        if (!concept.task) {
          concept.task = await submit(set.model, { prompt: concept.prompt, aspect_ratio: '4:3', resolution: '1k', output_format: 'jpeg' });
          concept.costCredits = concept.task.cost;
          await persist(set);
        }
        const sample = await finish(concept.task, 240_000);
        const image = await download(sample, 16 * 1024 * 1024, 'image');
        await writeFile(resolve(path(set.id), `${concept.id}.jpg`), image);
        concept.imageUrl = `/api/inspirations/${set.id}/images/${concept.id}.jpg`;
        concept.status = 'ready';
      } catch (error) { concept.status = 'failed'; concept.error = error instanceof Error ? error.message : 'Concept generation failed'; }
      await persist(set);
    }));
    set.status = set.concepts.every(c => c.status === 'ready') ? 'completed' : 'failed';
    if (set.status === 'failed') set.error = 'Some directions could not be generated. Ready images remain available.';
  } finally { working.delete(set.id); await persist(set); }
}
async function stored(id: string): Promise<StoredSet | null> {
  if (sets.has(id)) return sets.get(id)!;
  try {
    const set: StoredSet = JSON.parse(await readFile(resolve(path(id), 'set.json'), 'utf8'));
    sets.set(id, set);
    if (set.status === 'running') void generate(set);
    return set;
  } catch { return null; }
}
export async function getInspiration(id: string) { const set = await stored(id); return set ? visible(set) : null; }
export async function createInspiration(brief: string, force = false, projectId?: string) {
  if (!force) {
    let existing = [...sets.values()].find(s => s.brief === brief && s.projectId === projectId);
    if (!existing && projectId) {
      const entries = await readdir(resolve('var/inspirations'), {withFileTypes:true}).catch(() => []);
      const saved = await Promise.all(entries.filter(e => e.isDirectory() && /^[a-f0-9-]{36}$/.test(e.name)).map(async e => {
        try {
          const file = resolve(path(e.name), 'set.json');
          const data: StoredSet = JSON.parse(await readFile(file, 'utf8'));
          return data.projectId === projectId && data.brief === brief ? {data,mtime:(await stat(file)).mtimeMs} : null;
        } catch { return null; }
      }));
      const previous = saved.filter((v):v is NonNullable<typeof v> => !!v).sort((a,b)=>b.mtime-a.mtime)[0];
      if (previous) existing = await stored(previous.data.id) || undefined;
    }
    if (existing) return visible(existing);
  }
  if (working.size) throw new Error('An inspiration set is already generating');
  key();
  const id = randomUUID();
  const set: StoredSet = { id, brief, projectId, model: 'flux-3-image-klein', status: 'running', concepts: directions.map((d, i) => ({
    id: `direction-${i + 1}`, ...d, status: 'pending',
    prompt: `Industrial design concept for this exact product brief: ${brief}\nDesign direction: ${d.direction}\n` +
      'Show one coherent physical product, three-quarter view, alone on a warm off-white seamless studio surface. ' +
      'High-end industrial design photography, believable assembly seams and material texture, beautifully restrained lighting. ' +
      'The entire object fits comfortably inside the frame with generous negative space. Design the product rather than packaging. No logos, caption, collage or added text. ' +
      'Preserve any functional requirements and requested colors from the brief; vary silhouette, materials, proportions and control arrangement for this direction.'
  })) };
  sets.set(id, set);
  await persist(set);
  void generate(set);
  return visible(set);
}
export async function chooseInspiration(id: string, conceptId: string) {
  const set = await stored(id);
  const concept = set?.concepts.find(c => c.id === conceptId && c.status === 'ready');
  if (!set || !concept) throw new Error('Choose a ready inspiration image');
  set.selectedId = concept.id; await persist(set); return visible(set);
}
export async function selectedInspiration(id: string, conceptId: string) {
  const set = await stored(id);
  const concept = set?.concepts.find(c => c.id === conceptId && c.id === set.selectedId && c.status === 'ready');
  if (!set || !concept) throw new Error('Select an inspiration before starting engineering');
  return { brief: set.brief, title: concept.title, imagePath: resolve(path(id), `${concept.id}.jpg`), imageUrl: concept.imageUrl! };
}
export async function inspirationImage(id: string, name: string) {
  const set = await stored(id);
  const concept = set?.concepts.find(c => `${c.id}.jpg` === name && c.status === 'ready');
  return concept ? resolve(path(id), name) : null;
}
export async function generateShowcase(id: string, conceptId: string, outputDirectory: string) {
  const selection = await selectedInspiration(id, conceptId);
  const image = await readFile(selection.imagePath);
  const task = await submit('flux-3-video', { mode: 'i2v', version: 'latest', duration: 10, resolution: 'hd', aspect_ratio: '16:9',
    generate_audio: true, draft: false, keyframes: image.toString('base64'),
    prompt: `A ten-second premium industrial design concept film featuring exactly the product in the reference. ` +
      `Preserve its silhouette, color, material and controls. ${selection.brief}. ` +
      'One slow, smooth studio camera orbit with a gentle macro detail of the controls, then settle on a clean three-quarter hero composition. ' +
      'Warm white seamless studio, soft daylight, elegant contact shadows. Subtle tactile sounds and quiet ambient audio, no speech, text, logos, hands, new parts, transformations or explosions.' });
  await writeFile(resolve(outputDirectory, 'showcase-task.json'), JSON.stringify({ model: 'flux-3-video', duration: 10, task, source: { inspirationId: id, conceptId }, scope: 'Selected visual concept; not CAD-grounded' }, null, 2));
  const media = await finish(task, 900_000);
  const video = await download(media, 120 * 1024 * 1024, 'video');
  await writeFile(resolve(outputDirectory, 'showcase.mp4'), video);
  return { model: 'flux-3-video', durationRequested: 10, costCredits: task.cost, scope: 'Selected visual concept; not CAD-grounded' };
}
