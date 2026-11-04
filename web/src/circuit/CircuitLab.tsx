import { ArrowLeft, CircuitBoard, Download, FileJson, RotateCcw } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { exportRevision, PREVIEW_DISCLAIMER } from '../../../src/circuit/export';
import { EXAMPLE_BRIEFS, MAX_BRIEF_LENGTH, TEMPLATE_NAMES } from '../../../src/circuit/interpret';
import { physicalLayout, schematicLayout } from '../../../src/circuit/layout';
import type { Rejection, TemplateId } from '../../../src/circuit/model';
import { currentRevision, EMPTY_SESSION, submitBrief, type LabSession, type Revision } from '../../../src/circuit/session';
import type { BoardRequest } from '../board/BoardStudio';
import ConnectionChanges from '../rewire/ConnectionChanges';
import Inspector from './Inspector';
import SchematicView, { schematicSize } from './SchematicView';
import type { LabView, Selection } from './selection';
import Viewport from './Viewport';
import WiringView from './WiringView';
import './circuit-lab.css';
import '../board/board-studio.css';

// Loaded on first use: it brings three.js, which the drawing views don't need.
const BoardStudio = lazy(() => import('../board/BoardStudio'));

type Notice =
  | { kind: 'created'; revision: Revision }
  | { kind: 'unchanged'; revision: Revision }
  | { kind: 'rejected'; rejection: Rejection; brief: string };

const TEMPLATE_PARTS: Record<TemplateId, string> = {
  'focus-timer': 'ESP32, 0.96″ OLED, rotary encoder, optional piezo',
  'light-lamp': 'ESP32, light sensor divider, amber LED',
  'temp-monitor': 'ESP32, DS18B20 or BME280, optional OLED and piezo',
};

function readQuery() {
  const q = new URLSearchParams(window.location.search);
  const view: LabView = q.get('view') === 'wiring' ? 'wiring' : 'schematic';
  const select = q.get('select');
  const selection: Selection = select?.startsWith('net:') ? { kind: 'net', id: select.slice(4) } : select?.startsWith('part:') ? { kind: 'part', id: select.slice(5) } : null;
  return { brief: q.get('brief') ?? '', view, selection };
}

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function svgDocument(svg: SVGSVGElement, scale: number, title: string, contentId: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-export="skip"], .fresh-mark').forEach(n => n.remove());
  clone.querySelectorAll('.is-dim').forEach(n => n.classList.remove('is-dim'));
  clone.querySelector('[data-viewport]')?.removeAttribute('transform');
  const [, , w, h] = (clone.getAttribute('viewBox') ?? '0 0 100 100').split(' ').map(Number);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(w! * scale)));
  clone.setAttribute('height', String(Math.round(h! * scale)));
  clone.removeAttribute('class');
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); t.textContent = title;
  const d = document.createElementNS('http://www.w3.org/2000/svg', 'desc'); d.textContent = PREVIEW_DISCLAIMER;
  const metadata = document.createElementNS('http://www.w3.org/2000/svg', 'metadata');
  metadata.textContent = JSON.stringify({ schema: 'moki.svg-preview/1', contentId, preview: true });
  clone.prepend(t, d, metadata);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

export default function CircuitLab() {
  const initial = useMemo(readQuery, []);
  const [session, setSession] = useState<LabSession>(EMPTY_SESSION);
  const [draft, setDraft] = useState(initial.brief);
  const [viewing, setViewing] = useState<number | null>(null);
  const [view, setView] = useState<LabView>(initial.view);
  const [selection, setSelection] = useState<Selection>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);
  const sessionRef = useRef(session);
  // StrictMode mounts effects twice in development; the brief from the URL must be drawn once.
  const startedFromUrl = useRef(false);
  sessionRef.current = session;
  const [boardRequest, setBoardRequest] = useState<BoardRequest | null>(() => {
    const jobId = new URLSearchParams(window.location.search).get('board');
    return jobId ? { nonce: 1, jobId } : null;
  });
  const [boardOpen, setBoardOpen] = useState(boardRequest !== null);

  const latest = currentRevision(session);
  const shown = (viewing !== null ? session.revisions.find(r => r.number === viewing) : null) ?? latest;
  const previousOfShown = shown ? session.revisions.find(r => r.number === shown.number - 1) ?? null : null;
  const schematic = useMemo(() => (shown ? schematicLayout(shown.design) : null), [shown]);
  useEffect(() => {
    // A selection from another revision (e.g. ONEWIRE after switching to the BME280) is dropped.
    if (!shown || !selection) return;
    const exists = selection.kind === 'part' ? shown.design.parts.some(p => p.id === selection.id) : shown.design.nets.some(n => n.id === selection.id);
    if (!exists) setSelection(null);
  }, [shown, selection]);
  const physical = useMemo(() => (shown ? physicalLayout(shown.design) : null), [shown]);
  const colors = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of physical?.wires ?? []) if (!map.has(w.net)) map.set(w.net, w.color);
    return map;
  }, [physical]);

  function run(brief: string, choice?: TemplateId, select?: Selection) {
    const step = submitBrief(sessionRef.current, brief, choice);
    sessionRef.current = step.session;
    setSession(step.session);
    setViewing(null);
    const { outcome } = step;
    if (outcome.kind === 'created' || outcome.kind === 'unchanged') {
      setNotice({ kind: outcome.kind, revision: outcome.revision });
      const design = outcome.revision.design;
      setSelection(current => {
        const next = select ?? current;
        if (!next) return null;
        const exists = next.kind === 'part' ? design.parts.some(p => p.id === next.id) : design.nets.some(n => n.id === next.id);
        return exists ? next : null;
      });
      if (outcome.kind === 'created' && outcome.revision.number > 1) {
        const changed = outcome.revision.changes.filter(c => c.kind === 'part-added' || c.kind === 'part-changed').map(c => c.subject);
        const all = outcome.revision.changes.some(c => c.kind === 'template-changed');
        setFresh(new Set(all ? design.parts.map(p => p.id) : changed));
      }
    } else if (outcome.kind === 'rejected') {
      setNotice({ kind: 'rejected', rejection: outcome.rejection, brief: step.session.rejected?.brief ?? brief });
    } else {
      setNotice({ kind: 'rejected', rejection: step.session.rejected!.rejection, brief });
    }
  }

  useEffect(() => {
    document.title = 'Circuit preview · Workshop';
    // Keep the relative back link ('.') pointing at the landing page when opened as …/lab/.
    if (window.location.pathname.endsWith('/lab/')) window.history.replaceState(null, '', window.location.pathname.slice(0, -1) + window.location.search);
    if (initial.brief && !startedFromUrl.current) { startedFromUrl.current = true; run(initial.brief, undefined, initial.selection); }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement)) setSelection(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => setFresh(new Set()), 1900);
    return () => clearTimeout(t);
  }, [fresh]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    run(draft);
  }

  function startOver() {
    setSession(EMPTY_SESSION); sessionRef.current = EMPTY_SESSION;
    setDraft(''); setSelection(null); setNotice(null); setViewing(null);
    document.getElementById('lab-brief')?.focus();
  }

  function drawExample(brief: string) {
    setDraft(brief);
    run(brief);
  }

  const mood = notice?.kind === 'rejected' ? 'puzzled' : latest ? 'happy' : 'idle';
  const stale = viewing !== null && latest && viewing !== latest.number;
  const unchangedDraft = latest && draft.trim() === latest.brief;

  return (
    <div className="lab">
      <header className="lab-bar">
        <a className="lab-back" href="." aria-label="Back to the landing page"><ArrowLeft size={16} /><span>Landing</span></a>
        <div className="lab-title">
          <span className="lab-wordmark">Workshop</span>
          <span className="lab-crumb">Circuit preview</span>
        </div>
        <span className="lab-provisional" title="The product name and identity are still being chosen.">Moki · name study, provisional</span>
      </header>

      {boardRequest && (
        <Suspense fallback={<div className="studio-opening" role="status">Opening the board studio…</div>}>
          <BoardStudio request={boardRequest} visible={boardOpen} onClose={() => setBoardOpen(false)} />
        </Suspense>
      )}

      <div className="lab-body" style={boardOpen ? { display: 'none' } : undefined}>
        <section className="lab-companion" aria-labelledby="lab-heading">
          <form className="lab-composer" onSubmit={submit}>
            <h1 id="lab-heading">Describe a small circuit</h1>
            <label htmlFor="lab-brief" className="sr-only">Your brief</label>
            <textarea
              id="lab-brief"
              value={draft}
              maxLength={MAX_BRIEF_LENGTH}
              rows={3}
              placeholder="A focus timer with a screen and a knob that beeps when time is up"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              aria-describedby="lab-brief-help"
            />
            <div className="lab-composer-row">
              <span id="lab-brief-help" className="lab-quiet">Enter to draw · Shift+Enter for a new line</span>
              <div className="lab-actions">
                {latest && <button type="button" className="lab-text-button" onClick={startOver}><RotateCcw size={14} />Start over</button>}
                <button type="submit" className="lab-primary" disabled={!draft.trim() || Boolean(unchangedDraft && !session.rejected)}>{latest ? 'Update drawing' : 'Draw circuit'}</button>
              </div>
            </div>
            <div className="lab-examples" aria-label="Supported examples">
              {EXAMPLE_BRIEFS.map(ex => (
                <button key={ex.template} type="button" onClick={() => drawExample(ex.brief)}>{ex.label}</button>
              ))}
            </div>
          </form>

          <div className="lab-guide" role="status" aria-live="polite">
            <GuideFace mood={mood} />
            <div className="lab-guide-text">
              <GuideMessage notice={notice} latest={latest} onChoose={(id) => notice?.kind === 'rejected' && run(notice.brief, id)} />
            </div>
          </div>

          {shown && previousOfShown && (
            <ConnectionChanges before={previousOfShown.design} after={shown.design} revision={shown.number} onSelectNet={id => setSelection({ kind: 'net', id })} />
          )}
          {shown && <Reading revision={shown} onSelect={setSelection} />}

          {session.revisions.length > 0 && (
            <section className="lab-section" aria-labelledby="rev-heading">
              <h2 id="rev-heading">Revisions</h2>
              <ol className="lab-revisions" reversed>
                {[...session.revisions].reverse().map(r => (
                  <li key={r.number}>
                    <button type="button" aria-current={shown?.number === r.number ? 'true' : undefined} onClick={() => { setViewing(r.number === latest?.number ? null : r.number); }}>
                      <span className="lab-rev-num">Revision {r.number}</span>
                      <span className="lab-rev-brief">{r.brief}</span>
                      <span className="lab-rev-change">{r.changes.length ? r.changes.slice(0, 2).map(c => c.text).join(' · ') + (r.changes.length > 2 ? ` · ${r.changes.length - 2} more` : '') : `First drawing: ${r.design.title.toLowerCase()}`}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <details className="lab-limits">
            <summary>What this preview is, and isn’t</summary>
            <ul>
              <li>Three bounded templates for a USB-powered ESP32-DevKitC V4 at 3.3 V. Briefs outside them are explained, not guessed.</li>
              <li>Reading the brief is rule-based and runs in your browser. No AI model is called.</li>
              <li>The structure checks only confirm the drawing is self-consistent: every pin exists, nothing is wired twice, supplies match. There is no electrical rule check or simulation. Build Board compiles firmware, but nothing has run on hardware.</li>
              <li>Pinouts and outlines are typical for these hobby modules, not measured from yours. Check your boards’ silkscreen before wiring.</li>
            </ul>
          </details>
        </section>

        <section className="lab-stage" aria-label="Drawing">
          <div className="lab-stage-head">
            <div className="lab-tabs" role="tablist" aria-label="View">
              {(['schematic', 'wiring'] as const).map(v => (
                <button
                  key={v} id={`tab-${v}`} type="button" role="tab" aria-selected={view === v} aria-controls="lab-canvas" tabIndex={view === v ? 0 : -1}
                  onClick={() => setView(v)}
                  onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const next = v === 'schematic' ? 'wiring' : 'schematic'; setView(next); document.getElementById(`tab-${next}`)?.focus(); } }}
                >{v === 'schematic' ? 'Schematic' : 'Wiring'}</button>
              ))}
            </div>
            {shown && (
              <div className="lab-exports">
                <button type="button" className="lab-build" onClick={() => { setBoardRequest(r => ({ nonce: (r?.nonce ?? 0) + 1, design: shown.design })); setBoardOpen(true); }}><CircuitBoard size={15} />Build board</button>
                <button type="button" onClick={() => download(`circuit-preview-${shown.design.template}-rev${shown.number}.json`, 'application/json', JSON.stringify(exportRevision(shown), null, 2))}><FileJson size={15} />Netlist JSON</button>
                <button type="button" onClick={() => svgRef.current && download(`circuit-preview-${shown.design.template}-rev${shown.number}-${view}.svg`, 'image/svg+xml', svgDocument(svgRef.current, view === 'wiring' ? 5 : 1.5, `${shown.design.title}, revision ${shown.number}, ${view}`, shown.contentId))}><Download size={15} />SVG</button>
              </div>
            )}
          </div>
          {stale && (
            <p className="lab-banner">Viewing revision {viewing} of {latest!.number}. <button type="button" onClick={() => setViewing(null)}>Back to latest</button></p>
          )}
          {!stale && notice?.kind === 'rejected' && latest && (
            <p className="lab-banner">Your latest brief wasn’t drawn. Still showing revision {latest.number}, from “{latest.brief}”.</p>
          )}
          <div id="lab-canvas" role="tabpanel" aria-labelledby={`tab-${view}`} className={`lab-canvas is-${view}`}>
            {shown && schematic && physical ? (
              view === 'schematic' ? (
                <Viewport key="s" {...schematicSize(schematic)} label={`Schematic of the ${shown.design.title.toLowerCase()}, revision ${shown.number}`} resetKey={`${shown.fingerprint}-s`} svgRef={svgRef}>
                  <SchematicView layout={schematic} title={shown.design.title} revision={shown.number} selection={selection} onSelect={setSelection} fresh={fresh} />
                </Viewport>
              ) : (
                <Viewport key="w" width={physical.width} height={physical.height} label={`Wiring view of the ${shown.design.title.toLowerCase()}, revision ${shown.number}`} resetKey={`${shown.fingerprint}-w`} svgRef={svgRef} className="is-mat">
                  <WiringView layout={physical} selection={selection} onSelect={setSelection} fresh={fresh} screenText={screenText(shown)} />
                </Viewport>
              )
            ) : (
              <EmptyCanvas onExample={drawExample} />
            )}
          </div>
          {shown && (
            <p className="lab-caption">
              {view === 'schematic'
                ? 'Same-named power symbols are one connection. Unused ESP32 pins are hidden. Drag to pan; ctrl or ⌘ + scroll to zoom.'
                : 'Approximate bench arrangement: point-to-point jumpers and breadboard power rails. Wire colours are suggestions. Display values are examples.'}
            </p>
          )}
        </section>

        {shown && <Inspector design={shown.design} selection={selection} onSelect={setSelection} colors={colors} />}
      </div>
    </div>
  );
}

function screenText(revision: Revision): string {
  const { template, options } = { template: revision.design.template, options: revision.interpretation.options };
  if (template === 'focus-timer') return `${String(options.focusMinutes ?? 25).padStart(2, '0')}:00`;
  if (template === 'temp-monitor') return options.sensor === 'bme280' ? '21.5° 48%' : '21.5 °C';
  return '';
}

function EmptyCanvas({ onExample }: { onExample: (brief: string) => void }) {
  return (
    <div className="lab-empty">
      <h2>Three circuits can be drawn here</h2>
      <p>Describe one in your own words, or start from an example and change it.</p>
      <ul>
        {EXAMPLE_BRIEFS.map(ex => (
          <li key={ex.template}>
            <button type="button" onClick={() => onExample(ex.brief)}>
              <span className="lab-empty-name">{ex.label}</span>
              <span className="lab-empty-parts">{TEMPLATE_PARTS[ex.template]}</span>
              <span className="lab-empty-brief">“{ex.brief}”</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuideMessage({ notice, latest, onChoose }: { notice: Notice | null; latest: Revision | null; onChoose: (id: TemplateId) => void }) {
  if (!notice) {
    return <p>I can draw three small ESP32 circuits from a short description: a <strong>focus timer</strong>, a <strong>light-sensing lamp</strong> and a <strong>temperature monitor</strong>.</p>;
  }
  if (notice.kind === 'rejected') {
    const { rejection } = notice;
    return (
      <>
        <p><strong>{rejection.message}</strong></p>
        {rejection.reason === 'internal' && <p className="lab-quiet">Your brief was understood. Details for the preview’s developers:</p>}
        {rejection.details.length > 0 && <ul>{rejection.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
        {rejection.candidates && (
          <div className="lab-choices">
            {rejection.candidates.map(id => <button key={id} type="button" onClick={() => onChoose(id)}>Draw the {TEMPLATE_NAMES[id]}</button>)}
          </div>
        )}
        {latest && <p className="lab-quiet">Revision {latest.number} is still on the drawing.</p>}
      </>
    );
  }
  const r = notice.revision;
  if (notice.kind === 'unchanged') return <p>Same circuit and settings as revision {r.number}. Only the wording changed.</p>;
  if (r.number === 1) return <p>Drawn as the <strong>{r.design.title.toLowerCase()}</strong>{r.interpretation.chosenBy === 'user' ? ', as you chose' : ''}: {r.design.parts.length} parts, {r.design.nets.length} connections. Select anything to see why it’s wired that way.</p>;
  return (
    <>
      <p>Revision {r.number}{r.interpretation.chosenBy === 'user' ? ', as you chose' : ''}:</p>
      <ul>{r.changes.map((c, i) => <li key={i}>{c.text}</li>)}</ul>
    </>
  );
}

function Reading({ revision, onSelect }: { revision: Revision; onSelect: (s: Selection) => void }) {
  const { interpretation, design } = revision;
  const warnings = design.notes.filter(n => n.level === 'warning');
  return (
    <>
      <section className="lab-section" aria-labelledby="read-heading">
        <h2 id="read-heading">What I used from your brief</h2>
        <ul className="lab-recognized">
          {interpretation.recognized.map(r => (
            <li key={r.text}><mark>{r.text}</mark><span>{r.meaning}</span></li>
          ))}
        </ul>
        <p className="lab-quiet">Anything else in the brief was not interpreted.</p>
        {interpretation.notes.map((n, i) => <p key={i} className="lab-note is-info">{n}</p>)}
      </section>
      <section className="lab-section" aria-labelledby="fw-heading">
        <h2 id="fw-heading">Settings for firmware</h2>
        <dl className="lab-behavior">
          {design.behavior.map(b => (<div key={b.label}><dt>{b.label}</dt><dd>{b.value}</dd></div>))}
        </dl>
        <p className="lab-quiet">Recorded with the design. Build Board writes these into the firmware it compiles. Nothing has been flashed.</p>
      </section>
      {warnings.length > 0 && (
        <section className="lab-section" aria-labelledby="check-heading">
          <h2 id="check-heading">Check before wiring</h2>
          <ul className="lab-checks">
            {warnings.map((w, i) => (
              <li key={i}>
                {w.part ? <button type="button" className="lab-ref-button lab-mono" onClick={() => onSelect({ kind: 'part', id: w.part! })}>{w.part}</button> : null}
                <span>{w.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function GuideFace({ mood }: { mood: 'idle' | 'happy' | 'puzzled' }) {
  return (
    <svg className={`lab-face is-${mood}`} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 3c9.6 0 17 6.9 17 16.4C37 29.5 29.7 37 20 37S3 29.5 3 19.4C3 9.9 10.4 3 20 3Z" fill="#ffe14d" stroke="#17191c" strokeWidth="2" />
      <path d="M20 3v-2.2" stroke="#17191c" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="0.8" r="1.6" fill="#17191c" />
      {mood === 'puzzled' ? (
        <>
          <circle cx="14" cy="18" r="2.2" fill="#17191c" />
          <path d="M24 15.5l4.5 1.2" stroke="#17191c" strokeWidth="2" strokeLinecap="round" />
          <circle cx="26" cy="19.5" r="2.2" fill="#17191c" />
          <path d="M16 28.5c2.5-1.6 5.5-1.6 8 0" fill="none" stroke="#17191c" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          {mood === 'happy' ? (
            <>
              <path d="M11.5 19c1-2.4 4-2.4 5 0" fill="none" stroke="#17191c" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M23.5 19c1-2.4 4-2.4 5 0" fill="none" stroke="#17191c" strokeWidth="2.2" strokeLinecap="round" />
            </>
          ) : (
            <>
              <circle cx="14" cy="18.5" r="2.3" fill="#17191c" />
              <circle cx="26" cy="18.5" r="2.3" fill="#17191c" />
            </>
          )}
          <path d="M15 25.5c2.8 3 7.2 3 10 0" fill="none" stroke="#17191c" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
