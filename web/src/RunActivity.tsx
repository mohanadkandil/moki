import React from 'react';
import { Check, Circle, LoaderCircle, X, AlertCircle, Download } from 'lucide-react';
import type { LiveRun } from '../../src/contracts/run.js';

export default function RunActivity({ run, onOpenWorker }: { run: LiveRun; onOpenWorker?: (role: 'mechanical' | 'electrical') => void }) {
  return <div className="studio-run-activity" aria-live="polite">
    <div className="studio-run-title"><strong>{run.status === 'running' ? 'The workshop is running' : run.status === 'failed' ? 'This run needs attention' : 'Design study generated'}</strong><span>{run.id.slice(0, 8)}</span></div>
    <p>First-pass mechanical design and PCB outline only. No schematic or routed circuit has been generated.</p>
    {run.report?.release?.outcome === 'blocked' && <p role="status">Engineering incomplete: {run.report.release.reason}.</p>}
    <ol>{run.stages.map(stage => <li key={stage.id} data-state={stage.state}>
      {stage.state === 'passed' ? <Check size={14}/> : stage.state === 'running' ? <LoaderCircle className="studio-spin" size={14}/> : stage.state === 'failed' ? <X size={14}/> : stage.state === 'blocked' ? <AlertCircle size={14}/> : <Circle size={12}/>}
      <div>{onOpenWorker && (stage.id === 'electrical' || stage.id === 'mechanical') ? <button className="studio-worker-link" onClick={() => onOpenWorker(stage.id as 'mechanical' | 'electrical')}>{stage.name} ↗</button> : <strong>{stage.name}</strong>}{stage.state !== 'pending' && <small>{stage.message}</small>}</div>
      <span>{stage.state === 'passed' && stage.startedAt && stage.finishedAt ? `${((Date.parse(stage.finishedAt) - Date.parse(stage.startedAt)) / 1000).toFixed(1)}s` : stage.state}</span>
    </li>)}</ol>
    {run.error && <p role="alert" className="studio-run-error">{run.error}</p>}
    {run.report?.electrical && <div className="studio-run-facts"><span>Board <b>{run.report.electrical.width} × {run.report.electrical.height} mm</b></span><span>Holes <b>{Array.isArray(run.report.electrical.holes) ? run.report.electrical.holes.length : run.report.electrical.holes}</b></span></div>}
    {run.report?.fit && <details className="studio-run-evidence"><summary>Checker evidence</summary><p>Bare-board overlap: {run.report.fit.overlapMm3} mm³. Oversized negative fixture detected: {run.report.fit.negativeOverlapMm3.toFixed(1)} mm³. Stale revisions rejected.</p><code>PCB {run.report.fit.boardSha256.slice(0, 16)}…</code><code>STEP {run.report.fit.stepSha256.slice(0, 16)}…</code></details>}
    {run.report?.geometry && <details className="studio-run-evidence"><summary>Geometry evidence</summary><p>{run.report.geometry.solidCount} valid solids · {run.report.geometry.bboxMm.map(v=>v.toFixed(1)).join(' × ')} mm. {run.report.geometry.scope}</p><code>STEP {run.report.geometry.stepSha256.slice(0,16)}…</code></details>}
    {run.artifacts.length > 0 && <div className="studio-run-downloads">{run.artifacts.filter(a => /kicad_pcb|\.step$|fit-report/.test(a.name)).map(a => <a key={a.name} href={a.url} download={a.name}><Download size={12}/>{a.name}</a>)}</div>}
  </div>;
}
