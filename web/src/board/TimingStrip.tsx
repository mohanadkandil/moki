import { Check, Circle, CornerUpLeft, LoaderCircle, Minus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatMs, formatSeconds, groupedNotes, timingCells, unattributedMs, type CellState } from './logic';
import type { BoardJob } from './types';

const STATE_WORD: Record<CellState, string> = {
  pending: 'waiting',
  running: 'running',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
  reused: 'reused',
  'not-reported': 'not run',
};

function StateIcon({ state }: { state: CellState }) {
  const size = 13;
  if (state === 'done') return <Check size={size} aria-hidden="true" />;
  if (state === 'failed') return <X size={size} aria-hidden="true" />;
  if (state === 'running') return <LoaderCircle size={size} className="bs-spin" aria-hidden="true" />;
  if (state === 'skipped' || state === 'not-reported') return <Minus size={size} aria-hidden="true" />;
  if (state === 'reused') return <CornerUpLeft size={size} aria-hidden="true" />;
  return <Circle size={9} aria-hidden="true" />;
}

/** The pipeline left to right, in measured ms. It is the progress list while running and the proof after. */
export default function TimingStrip({ job, waiting, startedAt }: { job: BoardJob | null; waiting: boolean; startedAt: number | null }) {
  const cells = job ? timingCells(job) : timingCells({ jobId: '', status: 'queued' });
  const running = waiting || job?.status === 'queued' || job?.status === 'running';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [running]);
  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;
  const notes = groupedNotes(cells);
  const rest = job ? unattributedMs(job) : null;
  const announce = job?.status === 'done' ? `Build finished in ${formatSeconds(job.totalMs ?? 0)}, cache ${job.cache ?? 'unknown'}.` : job?.status === 'failed' ? 'Build failed.' : cells.filter(c => c.state === 'done').map(c => c.name).slice(-1).map(n => `${n} finished.`)[0] ?? '';

  return (
    <section className="bs-timing" aria-label="Measured build time per stage">
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <div className="bs-strip">
        <div className="bs-total">
          {running || job?.totalMs === undefined ? (
            <>
              <span className="bs-total-label">{running ? (job?.status === 'running' ? 'Building' : 'Queued') : 'Total'}</span>
              <strong className="bs-total-value">{running ? formatSeconds(elapsed) : 'n/a'}</strong>
              <span className="bs-total-sub">{running ? 'so far, browser clock' : 'no total reported'}</span>
            </>
          ) : (
            <>
              <span className="bs-total-label">Total</span>
              <strong className="bs-total-value">{formatSeconds(job.totalMs)}</strong>
              <span className="bs-total-sub">
                {formatMs(job.totalMs)}
                {job.cache && <span className={`bs-cache is-${job.cache}`}>cache {job.cache}</span>}
              </span>
            </>
          )}
        </div>
        <ol className="bs-cells">
          {cells.map(cell => (
            <li key={cell.name} className={`bs-cell is-${cell.state}`} title={cell.note}>
              <span className="bs-cell-name"><StateIcon state={cell.state} />{cell.name}</span>
              <span className="bs-cell-ms">{cell.ms !== null && cell.state !== 'skipped' && cell.state !== 'reused' ? formatMs(cell.ms) : STATE_WORD[cell.state]}</span>
              <span className="bs-cell-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, cell.share * 100)}%` }} /></span>
              {cell.state === 'failed' && <span className="sr-only">failed</span>}
            </li>
          ))}
        </ol>
      </div>
      {(notes.length > 0 || rest !== null) && (
        <ul className="bs-notes">
          {notes.map(n => (
            <li key={`${n.state}${n.note}`} className={`is-${n.state}`}>
              {n.state === 'failed' ? <TriangleAlert size={13} aria-hidden="true" /> : null}
              <span className="lab-mono">{n.names.join(', ')}</span> <span>{STATE_WORD[n.state]}: {n.note}</span>
            </li>
          ))}
          {rest !== null && <li className="is-rest">{formatMs(rest)} of the total sits outside these stages (queueing, process start, file writes).</li>}
        </ul>
      )}
    </section>
  );
}
