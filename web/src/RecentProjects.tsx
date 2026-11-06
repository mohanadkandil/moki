import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { boardApi } from './board/api';
import { atBase } from './board/base';
import { arrange, briefText, cardStatus, factsOf, jobsToAsk, lastLine, pictureOf, repeatTags, type CardStatus, type Tone, type KnownJobs, type Picture } from './landing/gallery';
import type { ProjectStatus, ProjectSummary } from './landing/projectsApi';
import { navigate } from './landing/routes';
import { rememberHint } from './landing/startProject';
import './recent-projects.css';

const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly ProjectStatus[] = ['new', 'waiting', 'building', 'built', 'unverified', 'failed', 'stopped'];
function isSummary(value: unknown): value is ProjectSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && validId.test(row.id) && typeof row.title === 'string' && typeof row.brief === 'string'
    && typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt))
    && STATUSES.includes(row.status as ProjectStatus);
}
function relativeTime(date: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 604800) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.floor(seconds / 86400), 'day');
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));
}

const THUMBNAIL = (jobId: string) => atBase(`/api/board/jobs/${jobId}/files/thumb.png`);
const GalleryDrawing = lazy(() => import('./landing/GalleryDrawing'));

/**
 * A sheet with nothing on it yet, and one wire across it that says where things stand, in the drawing's own symbols:
 * two open terminals waiting to be joined, an open switch, a no-connect, a pulse on its way, or a net just begun.
 */
function StatusWire({ tone, stopped }: { tone: Tone; stopped: boolean }) {
  const left = <line x1="0" x2="50%" y1="50%" y2="50%" />;
  const right = <line x1="50%" x2="100%" y1="50%" y2="50%" />;
  const at = (children: ReactNode) => <svg x="50%" y="50%" overflow="visible">{children}</svg>;
  if (tone === 'ask') return <>{left}{right}{at(<><rect className="recent-wire-gap" x="-30" y="-8" width="60" height="16" /><circle className="recent-wire-open" cx="-22" r="6" /><circle className="recent-wire-open" cx="22" r="6" /></>)}</>;
  if (tone === 'no') return <>{left}{at(<path className="recent-wire-mark" d="M-8 -8L8 8M8 -8L-8 8" />)}</>;
  if (tone === 'busy') return <>{left}{right}{at(<circle className="recent-wire-pulse" r="4.5" />)}</>;
  if (stopped) return <>{left}{right}{at(<><rect className="recent-wire-gap" x="-24" y="-20" width="48" height="28" /><path d="M-22 0L18 -17" /><circle className="recent-wire-node" cx="-22" r="3" /><circle className="recent-wire-node" cx="22" r="3" /></>)}</>;
  return <>{left}{at(<circle className="recent-wire-node" r="3" />)}</>;
}

function BlankSheet({ status }: { status: CardStatus }) {
  return <div className={`recent-sheet recent-sheet-${status.tone}`}>
    <svg className="recent-wire" width="100%" height="100%" aria-hidden="true"><StatusWire tone={status.tone} stopped={status.label === 'Stopped'} /></svg>
    <span className="recent-sheet-block">No drawing yet</span>
  </div>;
}

/** A build from before pictures existed has its drawn on first view, which takes seconds. Until then the stage stands empty, with nothing claiming to label it. */
function Photo({ project, picture, onBroken, caption }: { project: ProjectSummary; picture: Extract<Picture, { kind: 'photo' }>; onBroken: (jobId: string) => void; caption: boolean }) {
  const [shown, setShown] = useState(false);
  const lidOff = Boolean(picture.job.artifacts?.['assembly.glb']);
  const label = picture.earlier ? 'From an earlier build that worked' : caption ? (lidOff ? '3D render, lid off' : '3D render') : null;
  return <div className={`recent-pic recent-pic-stage${shown ? ' is-shown' : ''}`}>
    <img ref={image => { if (image?.complete && image.naturalWidth && !shown) setShown(true); }} src={THUMBNAIL(picture.jobId)} width={1280} height={800} loading="lazy" decoding="async" alt={`3D render of ${project.title}, from its ${picture.earlier ? 'last working' : 'latest'} build.`} onLoad={() => setShown(true)} onError={() => onBroken(picture.jobId)} />
    {label && shown && <span className="recent-pic-caption">{label}</span>}
  </div>;
}

function CardPicture({ project, picture, status, onBroken, caption }: { project: ProjectSummary; picture: Picture; status: CardStatus; onBroken: (jobId: string) => void; caption: boolean }) {
  if (picture.kind === 'pending') return <div className="recent-pic recent-pic-stage" />;
  if (picture.kind === 'blank') return <div className="recent-pic"><BlankSheet status={status} /></div>;
  if (picture.kind === 'drawing') return <div className="recent-pic"><Suspense fallback={<BlankSheet status={status} />}><GalleryDrawing sheet={project.card!.sheet!} fallback={<BlankSheet status={status} />} /></Suspense></div>;
  return <Photo project={project} picture={picture} onBroken={onBroken} caption={caption} />;
}

function CardStatusLine({ status, project }: { status: CardStatus; project: ProjectSummary }) {
  return <div className="recent-card-meta">
    <span className={`recent-phase recent-phase-${status.tone}`}><span aria-hidden="true" />{status.label}</span>
    <time dateTime={project.updatedAt} title={new Date(project.updatedAt).toLocaleString()}>{relativeTime(project.updatedAt)}</time>
  </div>;
}

function RecentProjectCard({ project, lead, jobs, broken, tag, onBroken }: { project: ProjectSummary; lead: boolean; jobs: KnownJobs; broken: ReadonlySet<string>; tag: string | undefined; onBroken: (jobId: string) => void }) {
  const url = atBase(`/studio/${project.id}`);
  const picture = pictureOf(project, jobs, broken);
  const status = cardStatus(project, jobs);
  const facts = factsOf(project, picture, status.unchecked);
  const brief = briefText(project);
  const said = lastLine(project);
  const line = facts.filter(f => f.label !== 'Agent cost' && f.label !== 'Build').map(f => f.short).join(' · ');
  const title = tag ? `${project.title}, started ${tag}` : project.title;
  return <a className={`recent-card${lead ? ' recent-lead' : ''}`} href={url} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); rememberHint(project.id, { title: project.title }); navigate(url);
  }} aria-label={`Open ${title}. ${status.label}.${line ? ` ${line.replace(' ✓', '')}.` : ''}`}>
    <CardPicture project={project} picture={picture} status={status} onBroken={onBroken} caption={lead} />
    {lead
      ? <div className="recent-card-body">
          <CardStatusLine status={status} project={project} />
          <h3>{project.title}{tag && <em>{tag}</em>}</h3>
          {brief && <p>{brief}</p>}
          {facts.length > 0 && <dl>{facts.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
          <span className="recent-open">Open workshop <ArrowUpRight size={15} aria-hidden="true" /></span>
        </div>
      : <div className="recent-card-body">
          <h3>{project.title}{tag && <em>{tag}</em>}</h3>
          {line ? <p>{line}</p> : said ? <p className="recent-said">{said}</p> : brief && <p>{brief}</p>}
          <CardStatusLine status={status} project={project} />
        </div>}
  </a>;
}

export default function RecentProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [jobs, setJobs] = useState<KnownJobs>({});
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const asking = useRef(new Set<string>());
  // A build says how it really ended, and what there is to show of it. One that has finished never changes, so it's asked once.
  useEffect(() => {
    for (const project of projects) for (const id of jobsToAsk(project, jobs)) {
      if (asking.current.has(id)) continue;
      asking.current.add(id);
      void boardApi().get(id).then(
        job => setJobs(known => ({ ...known, [id]: job })),
        (error: { status?: number }) => { if (error?.status === 404) setJobs(known => ({ ...known, [id]: null })); },
      ).finally(() => asking.current.delete(id));
    }
  }, [projects, jobs]);
  const { lead, rest } = useMemo(() => arrange(projects, jobs, broken), [projects, jobs, broken]);
  const tags = useMemo(() => repeatTags(projects), [projects]);
  const markBroken = (jobId: string) => setBroken(known => new Set(known).add(jobId));
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let busy = false;
    async function load() {
      if (busy || stopped) return;
      busy = true;
      try {
        const response = await fetch(atBase('/api/projects'), { headers: { 'x-moki-projects': '1' }, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) throw new Error('Project index unavailable');
        const body: unknown = await response.json();
        const rows = body && typeof body === 'object' && 'projects' in body ? (body as { projects: unknown }).projects : null;
        if (!Array.isArray(rows)) throw new Error('Invalid project index');
        if (!stopped) {
          const summaries = rows.filter(isSummary).slice(0, 20);
          setProjects(summaries); setLoaded(true); setError(false);
        }
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
    {lead && <RecentProjectCard key={lead.id} project={lead} lead jobs={jobs} broken={broken} tag={tags.get(lead.id)} onBroken={markBroken} />}
    {rest.length > 0 && <div className="recent-grid">{rest.map(project => <RecentProjectCard key={project.id} project={project} lead={false} jobs={jobs} broken={broken} tag={tags.get(project.id)} onBroken={markBroken} />)}</div>}
  </section>;
}
