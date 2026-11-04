import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useArtifact } from '../board/api';
import { hideLayersCss } from '../board/logic';
import type { BoardJob } from '../board/types';
import DrawingPane from './DrawingPane';
import type { EditControls } from './BoardCanvas';
import { RailButton } from './Rail';
import { PaneState } from './PaneState';
import { useBoardModel } from './useBoardModel';

// The drawing is ours, from circuit.json, because tscircuit's viewer has no API for its camera, selection or pads.
// Lazy, as the viewer was. If it ever throws, the tab falls back to the generated SVG.
const BoardCanvas = lazy(() => import('./BoardCanvas'));

class ViewerBoundary extends Component<{ fallback: (error: string) => ReactNode; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) }; }
  render() { return this.state.error ? this.props.fallback(this.state.error) : this.props.children; }
}

const asText = (res: Response) => res.text();

function SvgFallback({ job, reason }: { job: BoardJob; reason: string }) {
  const text = useArtifact(job.artifacts?.['pcb.svg'], asText);
  const [hidden, setHidden] = useState<string[]>([]);
  const css = useMemo(() => hideLayersCss(hidden), [hidden]);
  const toggle = (layer: string) => setHidden(h => (h.includes(layer) ? h.filter(x => x !== layer) : [...h, layer]));
  if (text.state !== 'ready') return <PaneState what="the PCB drawing" error={text.state === 'error' ? text.message : undefined} />;
  return (
    <>
      <p className="st-pane-note" role="note">The interactive viewer stopped ({reason}). Showing the generated drawing.</p>
      <DrawingPane text={text.value} css={css} tone="copper" label="PCB drawing" tools={(
        <>
          <RailButton label="Top layer" pressed={!hidden.includes('top')} onClick={() => toggle('top')}><span className="st-tool-text">Top</span></RailButton>
          <RailButton label="Bottom layer" pressed={!hidden.includes('bottom')} onClick={() => toggle('bottom')}><span className="st-tool-text">Bot</span></RailButton>
        </>
      )} />
    </>
  );
}

export default function PcbPane({ job, selection, setSelection, edit }: { job: BoardJob; selection: { part: string | null; net: string | null }; setSelection: (s: { part: string | null; net: string | null }) => void; edit: EditControls }) {
  const artifact = job.artifacts?.['circuit.json'];
  const circuit = useBoardModel(artifact);
  if (!artifact) {
    const waiting = job.status === 'running' || job.status === 'queued';
    return <PaneState what="the PCB" waiting={waiting} absent={waiting ? 'The PCB appears when the board stage finishes.' : 'This build has no PCB.'} />;
  }
  if (circuit.state !== 'ready') return <PaneState what="the PCB" error={circuit.state === 'error' ? circuit.message : undefined} />;
  if (!circuit.model) return <SvgFallback job={job} reason="its circuit file has no board" />;
  return (
    <ViewerBoundary fallback={reason => <SvgFallback job={job} reason={reason} />}>
      <Suspense fallback={<PaneState what="the PCB" />}>
        <BoardCanvas key={artifact.sha256} model={circuit.model} job={job} selection={selection} setSelection={setSelection} edit={edit} />
      </Suspense>
    </ViewerBoundary>
  );
}
