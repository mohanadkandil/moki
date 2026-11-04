import { LoaderCircle, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useArtifact } from '../board/api';
import type { BoardJob } from '../board/types';
import { Gutter, Highlighted } from './CodeView';
import { sourceStatus } from './facts';
import { PaneState } from './PaneState';
import { SourceBadge } from './SourceBadge';

export interface Draft { text: string; base: string | null; jobId: string | null }
const asText = (res: Response) => res.text();

export default function CodeTab({ job, draft, setDraft, busy, onRender }: { job: BoardJob; draft: Draft; setDraft: (d: Draft) => void; busy: boolean; onRender: () => void }) {
  const artifact = job.artifacts?.['board.tsx'];
  const loaded = useArtifact(artifact, asText);
  const layer = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  // Take the job's source unless there are unsaved edits. Edits survive a tab switch or a new build.
  useEffect(() => {
    if (loaded.state !== 'ready') return;
    // The source that was just rendered is no longer an edit, so it becomes the new base.
    if (draft.base === null || draft.text === draft.base || draft.text === loaded.value) setDraft({ text: loaded.value, base: loaded.value, jobId: job.jobId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, job.jobId, draft.text, draft.base]);

  if (!artifact) return <PaneState what="the source" absent="This build has no source file." />;
  if (loaded.state !== 'ready' || draft.base === null) return <PaneState what="the source" error={loaded.state === 'error' ? loaded.message : undefined} />;
  const edited = draft.text !== draft.base;
  // Unedited text from another job says nothing about this one. The effect above replaces it.
  if (!edited && (draft.jobId !== job.jobId || draft.base !== loaded.value)) return <PaneState what="the source" />;
  const status = sourceStatus(job, busy);
  const editedElsewhere = edited && draft.jobId !== job.jobId && draft.jobId !== null;

  return (
    <div className="st-editor">
      <div className="st-editor-bar">
        <span className="st-editor-name">board.tsx</span>
        <span className="st-file-meta">{draft.text.split('\n').length} lines</span>
        {edited ? <span className="st-badge is-warn">Edited, not rendered</span> : <SourceBadge status={status} />}
        <span className="st-editor-hint">{edited ? `${editedElsewhere ? `These edits started from build ${draft.jobId!.slice(0, 8)}, not the one showing. ` : ''}Rendering rebuilds the board and case. Firmware needs the design graph, so it’s skipped.` : status.hint}</span>
        <button type="button" className="st-ghost" disabled={!edited || busy} onClick={() => setDraft({ text: loaded.value, base: loaded.value, jobId: job.jobId })}><RotateCcw size={14} aria-hidden="true" />Revert</button>
        <button type="button" className="st-primary" disabled={!edited || busy} onClick={onRender}>
          {busy ? <LoaderCircle size={14} className="st-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}Render
        </button>
      </div>
      <div className="st-editor-body">
        <div className="st-editor-gutter" ref={gutter}><Gutter lines={draft.text.split('\n').length} /></div>
        <div className="st-editor-pane">
          <pre className="st-editor-layer" ref={layer} aria-hidden="true"><code><Highlighted code={draft.text + '\n'} /></code></pre>
          <textarea
            value={draft.text}
            spellCheck={false}
            wrap="off"
            aria-label="board.tsx source"
            onChange={e => setDraft({ ...draft, text: e.target.value })}
            onScroll={e => {
              if (layer.current) { layer.current.scrollTop = e.currentTarget.scrollTop; layer.current.scrollLeft = e.currentTarget.scrollLeft; }
              if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
            }}
          />
        </div>
      </div>
    </div>
  );
}
