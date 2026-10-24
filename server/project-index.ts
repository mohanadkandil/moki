import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

export type ProjectSummary = {
  id: string;
  title: string;
  brief: string;
  createdAt: string;
  phase: 'planning' | 'choosing' | 'running' | 'completed' | 'failed';
  latestRun?: { id: string; status: 'running' | 'completed' | 'failed'; createdAt: string; finishedAt?: string };
  imageUrl?: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const projectSchema = z.object({
  id: z.string().uuid(), title: z.string().min(1).max(60), brief: z.string().min(1).max(12_000),
  createdAt: z.string().datetime(), status: z.enum(['planning', 'ready', 'failed']),
});
const runSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid().optional(), status: z.enum(['running', 'completed', 'failed']),
  createdAt: z.string().datetime(), finishedAt: z.string().datetime().optional(), inspirationId: z.string().uuid().optional(),
});
const inspirationSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid().optional(), status: z.enum(['running', 'completed', 'failed']), selectedId: z.string().optional(),
  concepts: z.array(z.object({ id: z.string(), status: z.enum(['pending', 'running', 'ready', 'failed']) })),
});

/** Read only known local UUID directories. Invalid or partially written files are skipped. */
async function records<T>(folder: string, filename: string, schema: z.ZodType<T>): Promise<Array<{ value: T; modified: number }>> {
  let entries;
  try { entries = await readdir(resolve('var', folder), { withFileTypes: true }); }
  catch { return []; }
  const values = await Promise.all(entries.filter(entry => entry.isDirectory() && uuid.test(entry.name)).map(async entry => {
    const file = resolve('var', folder, entry.name, filename);
    try {
      const [contents, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
      const parsed = schema.safeParse(JSON.parse(contents));
      if (!parsed.success || (parsed.data as { id?: string }).id !== entry.name) return null;
      return { value: parsed.data, modified: info.mtimeMs };
    } catch { return null; }
  }));
  return values.filter((value): value is { value: T; modified: number } => value !== null);
}

/** Read-only disk index. It never restores workers, submits a model call, or resumes generation. */
export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const [projects, runs, inspirations] = await Promise.all([
    records('projects', 'project.json', projectSchema),
    records('runs', 'run.json', runSchema),
    records('inspirations', 'set.json', inspirationSchema),
  ]);
  const latestRuns = new Map<string, z.infer<typeof runSchema>>();
  for (const { value: run } of runs) {
    if (!run.projectId) continue;
    const previous = latestRuns.get(run.projectId);
    if (!previous || Date.parse(run.createdAt) > Date.parse(previous.createdAt)) latestRuns.set(run.projectId, run);
  }
  const latestInspirations = new Map<string, typeof inspirations[number]>();
  for (const inspiration of inspirations) {
    const projectId = inspiration.value.projectId;
    if (!projectId) continue;
    const previous = latestInspirations.get(projectId);
    if (!previous || inspiration.modified > previous.modified) latestInspirations.set(projectId, inspiration);
  }
  return projects.sort((a, b) => Date.parse(b.value.createdAt) - Date.parse(a.value.createdAt)).slice(0, 20).map(({ value: project }) => {
    const run = latestRuns.get(project.id);
    const inspiration = latestInspirations.get(project.id)?.value;
    const selected = inspiration?.concepts.find(concept => concept.id === inspiration.selectedId && concept.status === 'ready' && /^direction-[1-4]$/.test(concept.id));
    const phase: ProjectSummary['phase'] = run ? run.status : project.status === 'failed' || inspiration?.status === 'failed' ? 'failed' : project.status === 'planning' || inspiration?.status === 'running' ? 'planning' : 'choosing';
    // Explicit projection prevents internal tasks, signed URLs, and provider payloads from escaping.
    return {
      id: project.id, title: project.title, brief: project.brief, createdAt: project.createdAt, phase,
      ...(run ? { latestRun: { id: run.id, status: run.status, createdAt: run.createdAt, ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}) } } : {}),
      ...(selected && inspiration ? { imageUrl: `/api/inspirations/${inspiration.id}/images/${selected.id}.jpg` } : {}),
    };
  });
}
