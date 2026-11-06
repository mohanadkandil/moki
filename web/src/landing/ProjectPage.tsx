// Opens one project, or says plainly why it can't.
import { CircleAlert } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { atBase } from '../board/base';
import { setEffort } from '../studio/agentChat';
import { WORDMARK } from '../studio/conversation';
import '../studio/studio.css';
import './landing.css';
import { ProjectError, projectsApi, type ProjectRecord } from './projectsApi';
import { isProjectId, navigate } from './routes';
import { hintFor } from './startProject';
import { StudioShell } from './StudioShell';

const Studio = lazy(() => import('../studio/Studio'));

type Load = { kind: 'loading' } | { kind: 'ready'; project: ProjectRecord } | { kind: 'missing' } | { kind: 'failed'; reason: string };

function Message({ title, body, retry }: { title: string; body: string; retry?: () => void }) {
  const home = atBase('/');
  useEffect(() => { document.title = `${title} · ${WORDMARK}`; }, [title]);
  return (
    <div className="st st-landing">
      <header className="st-land-head"><a className="st-wordmark" href={home}>{WORDMARK}</a></header>
      <main className="st-land-main st-land-message">
        <CircleAlert size={20} aria-hidden="true" />
        <h1>{title}</h1>
        <p>{body}</p>
        <div className="st-say-actions">
          {retry && <button type="button" className="st-paper-button" onClick={retry}>Try again</button>}
          <a className="st-paper-button is-primary" href={home} onClick={e => { e.preventDefault(); navigate(home); }}>Start a new project</a>
        </div>
      </main>
    </div>
  );
}

export default function ProjectPage({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isProjectId(projectId)) { setLoad({ kind: 'missing' }); return; }
    const abort = new AbortController();
    setLoad({ kind: 'loading' });
    projectsApi.get(projectId, abort.signal).then(project => {
      setEffort(project.effort);
      setLoad({ kind: 'ready', project });
    }, (err: unknown) => {
      if (abort.signal.aborted) return;
      if (err instanceof ProjectError && err.status === 404) setLoad({ kind: 'missing' });
      else setLoad({ kind: 'failed', reason: err instanceof Error ? err.message : 'The project service isn’t answering.' });
    });
    return () => abort.abort();
  }, [projectId, attempt]);

  const shell = <StudioShell hint={hintFor(projectId)} />;
  if (load.kind === 'loading') return shell;
  if (load.kind === 'missing') return <Message title="Project not found" body="This link doesn’t match a project on this server. It may have been typed wrong, or come from another machine." />;
  if (load.kind === 'failed') return <Message title="This project didn’t open" body={load.reason} retry={() => setAttempt(n => n + 1)} />;
  return <Suspense fallback={shell}><Studio key={projectId} project={load.project} /></Suspense>;
}
