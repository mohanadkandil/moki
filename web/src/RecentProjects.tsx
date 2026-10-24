import { useEffect, useState } from 'react';
import { ArrowUpRight, Box, RefreshCw } from 'lucide-react';
import type { ProjectSummary } from '../../server/project-index';
import './recent-projects.css';

const phases: Record<ProjectSummary['phase'], string> = {
  planning: 'Planning', choosing: 'Choose a direction', running: 'In progress', completed: 'Study generated', failed: 'Needs attention',
};
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isSummary(value: unknown): value is ProjectSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && validId.test(row.id) && typeof row.title === 'string' && typeof row.brief === 'string'
    && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt))
    && typeof row.phase === 'string' && Object.hasOwn(phases, row.phase)
    && (row.imageUrl === undefined || typeof row.imageUrl === 'string' && /^\/api\/inspirations\/[a-f0-9-]{36}\/images\/direction-[1-4]\.jpg$/i.test(row.imageUrl));
}
function relativeTime(date: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 604800) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.floor(seconds / 86400), 'day');
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));
}

function RecentProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen?: (id: string) => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [project.imageUrl]);
  return <a className="recent-card" href={`/workshop/${project.id}`} onClick={event => {
    if (!onOpen || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); onOpen(project.id);
  }} aria-label={`Open ${project.title}. ${phases[project.phase]}.`}>
    <div className="recent-card-preview">
      {project.imageUrl && !imageFailed ? <img src={project.imageUrl} alt="" loading="lazy" width="640" height="400" onError={() => setImageFailed(true)} /> : <Box className="recent-empty-image" size={33} strokeWidth={1.15} aria-hidden="true" />}
      <span className="recent-open-icon" aria-hidden="true"><ArrowUpRight size={17} /></span>
    </div>
    <div className="recent-card-body"><h3>{project.title}</h3><p>{project.brief}</p><div className="recent-card-meta"><span className={`recent-phase recent-phase-${project.phase}`}><span aria-hidden="true" />{phases[project.phase]}</span><time dateTime={project.createdAt} title={new Date(project.createdAt).toLocaleString()}>{relativeTime(project.createdAt)}</time></div></div>
  </a>;
}

export default function RecentProjects({ onOpen }: { onOpen?: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let busy = false;
    async function load() {
      if (busy || stopped) return;
      busy = true;
      try {
        const response = await fetch('/api/projects', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), cache: 'no-store' });
        if (!response.ok) throw new Error('Project index unavailable');
        const body: unknown = await response.json();
        const rows = Array.isArray(body) ? body : body && typeof body === 'object' && 'projects' in body ? (body as { projects: unknown }).projects : null;
        if (!Array.isArray(rows)) throw new Error('Invalid project index');
        if (!stopped) { setProjects(rows.filter(isSummary).slice(0, 20)); setLoaded(true); setError(false); }
      } catch {
        if (!stopped && !controller.signal.aborted) { setError(true); setLoaded(true); }
      } finally {
        busy = false;
        if (!stopped) timer = setTimeout(() => { if (!document.hidden) void load(); else schedule(); }, 5000);
      }
    }
    function schedule() { if (!stopped) timer = setTimeout(() => { if (!document.hidden) void load(); else schedule(); }, 5000); }
    const onVisible = () => { if (!document.hidden && !busy) { clearTimeout(timer); void load(); } };
    document.addEventListener('visibilitychange', onVisible);
    void load();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [retry]);
  if (loaded && !error && projects.length === 0) return null;
  return <section className="recent-projects" aria-labelledby="recent-projects-title">
    <div className="recent-heading"><h2 id="recent-projects-title">Your workshops</h2>{projects.length > 0 && <span>Pick up where you left off.</span>}</div>
    {error && <div className="recent-connection-error" role="status"><span>{projects.length ? 'Your workshops could not be refreshed.' : 'Your workshops could not be loaded.'}</span><button type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={12} />Try reconnecting</button></div>}
    {!loaded && <p className="recent-loading" role="status">Loading your workshops…</p>}
    {projects.length > 0 && <div className="recent-grid">{projects.map(project => <RecentProjectCard key={project.id} project={project} onOpen={onOpen} />)}</div>}
  </section>;
}
