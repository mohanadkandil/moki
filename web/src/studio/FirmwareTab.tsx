import { Check, CircleX, Download, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useArtifact } from '../board/api';
import { NO_CODE_TAB } from '../../../src/agents/no-code';
import { compileState, formatBytes } from '../board/logic';
import type { BoardJob } from '../board/types';
import { readZip, type ZipEntry } from '../board/zip';
import { Rows } from './CaseTab';
import { CodeView } from './CodeView';
import { num, obj, str, type Json } from './facts';
import { PaneState } from './PaneState';

const FILES = [
  { suffix: 'src/main.cpp', label: 'main.cpp' },
  { suffix: 'include/pins.h', label: 'pins.h' },
  { suffix: 'platformio.ini', label: 'platformio.ini' },
] as const;
const asBuffer = (res: Response) => res.arrayBuffer();
const asJson = (res: Response) => res.json() as Promise<unknown>;

function Meter({ label, value }: { label: string; value: unknown }) {
  const { usedBytes, totalBytes, percent } = obj(value);
  const [used, total, pct] = [num(usedBytes), num(totalBytes), num(percent)];
  if (used === null) return null;
  return (
    <div className="st-meter">
      <div className="st-meter-head"><span>{label}</span><strong>{formatBytes(used)}{total !== null ? <em> of {formatBytes(total)}</em> : null}</strong></div>
      {pct !== null && <div className="st-meter-track" role="img" aria-label={`${pct}% used`}><i style={{ width: `${Math.min(100, pct)}%` }} /></div>}
    </div>
  );
}

function CompileBadge({ kind }: { kind: string }) {
  if (kind === 'none') return <span className="st-badge">No firmware</span>;
  if (kind === 'compiled') return <span className="st-badge is-ok"><Check size={13} aria-hidden="true" />Compiled</span>;
  if (kind === 'failed') return <span className="st-badge is-error"><CircleX size={13} aria-hidden="true" />Compile failed</span>;
  if (kind === 'not-compiled') return <span className="st-badge is-warn"><TriangleAlert size={13} aria-hidden="true" />Not compiled</span>;
  return <span className="st-badge"><LoaderCircle size={13} className="st-spin" aria-hidden="true" />Compile pending</span>;
}

export default function FirmwareTab({ job }: { job: BoardJob }) {
  const zip = job.artifacts?.['firmware.zip'];
  const receipt = job.artifacts?.['firmware-build.json'];
  const buffer = useArtifact(zip, asBuffer);
  const build = useArtifact(receipt, asJson);
  const [current, setCurrent] = useState<string>(FILES[0].suffix);
  const [text, setText] = useState<string | null>(null);
  const [pins, setPins] = useState<[string, string][]>([]);

  const entries = useMemo<ZipEntry[]>(() => {
    if (buffer.state !== 'ready') return [];
    try { return readZip(buffer.value); } catch { return []; }
  }, [buffer]);

  useEffect(() => {
    let live = true;
    setText(null);
    const entry = entries.find(e => e.path.endsWith(current));
    if (entry) void entry.text().then(t => { if (live) setText(t); });
    return () => { live = false; };
  }, [entries, current]);

  useEffect(() => {
    let live = true;
    const entry = entries.find(e => e.path.endsWith('include/pins.h'));
    if (entry) void entry.text().then(t => {
      if (live) setPins([...t.matchAll(/PIN_([A-Z0-9_]+)\s*=\s*(\d+)/g)].map(m => [m[1]!, m[2]!] as [string, string]));
    });
    return () => { live = false; };
  }, [entries]);

  const compile = compileState(job);
  if (job.noFirmware) return <div className="st-pane-state"><p>{NO_CODE_TAB}</p></div>;
  if (!zip) {
    const stage = job.stages?.find(s => s.name === 'firmware');
    const waiting = job.status === 'running' || job.status === 'queued';
    return <PaneState what="the firmware" waiting={waiting} absent={stage?.note ?? (waiting ? 'Firmware appears when its stage finishes.' : 'This build has no firmware.')} />;
  }
  const info: Json = obj(build.state === 'ready' ? build.value : null);
  const versions = Object.entries(obj(info.toolVersions));
  const log = str(info.logTail);

  return (
    <div className="st-split is-code">
      <div className="st-split-view st-code-host">
        <div className="st-file-head">
          <div className="st-code-tabs" role="tablist" aria-label="Firmware files">
            {FILES.map(f => (
              <button key={f.suffix} type="button" role="tab" aria-selected={current === f.suffix} onClick={() => setCurrent(f.suffix)}>{f.label}</button>
            ))}
          </div>
          {text !== null && <span className="st-file-meta">{text.split('\n').length} lines</span>}
          <CompileBadge kind={compile.kind} />
        </div>
        {text === null ? <PaneState what="the source" /> : <CodeView code={text} label={`Generated ${current}`} />}
      </div>
      <aside className="st-inspector st-sheet" aria-label="Compile receipt">
        <p className="st-sheet-title">Compile receipt</p>
        <section>
          <h3>Compile</h3>
          {compile.kind === 'compiled' && <p className="st-inspector-big is-ok">Compiled{str(info.board) ? ` for ${str(info.board)}` : ''}</p>}
          {compile.kind === 'failed' && <p className="st-inspector-big is-error">Compile failed</p>}
          {compile.kind === 'not-compiled' && <p className="st-inspector-big is-warn">Not compiled</p>}
          {compile.kind === 'pending' && <p className="st-inspector-big">Compile pending</p>}
          {(compile.kind === 'failed' || compile.kind === 'not-compiled') && <p className="st-open-note">{compile.reason}</p>}
          <Meter label="Flash" value={info.flash} />
          <Meter label="RAM" value={info.ram} />
          <p className="st-open-note">Compile checked only. It hasn’t been flashed or run on a board.</p>
        </section>
        {pins.length > 0 && (
          <section>
            <h3>Pins</h3>
            <dl className="st-pins">{pins.map(([name, gpio]) => <div key={name}><dt>{name}</dt><dd>GPIO {gpio}</dd></div>)}</dl>
          </section>
        )}
        <section>
          <h3>Files</h3>
          <a className="st-file" href={zip.url} download="firmware.zip"><Download size={14} aria-hidden="true" /><span>PlatformIO project</span><em>{formatBytes(zip.bytes)}</em></a>
        </section>
        {versions.length > 0 && (
          <details className="st-more">
            <summary>Toolchain versions</summary>
            <Rows rows={versions.map(([k, v]) => [k, String(v)] as const)} />
          </details>
        )}
        {log && <details className="st-more"><summary>Compiler log, last lines</summary><pre className="st-log">{log}</pre></details>}
      </aside>
    </div>
  );
}
