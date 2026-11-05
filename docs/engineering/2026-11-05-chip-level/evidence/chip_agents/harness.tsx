import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { Composer } from '/home/sogo/design-skill-research/repos/moki/web/src/studio/Chat';
import { AgentTurnCard } from '/home/sogo/design-skill-research/repos/moki/web/src/studio/agentCards';
import '/home/sogo/design-skill-research/repos/moki/web/src/studio/studio.css';
const params = new URLSearchParams(location.search);
const state = params.get('state') ?? 'on';
const req = [
  { id: 'life', plain: 'Runs at least 4 hours on a 1000 mAh battery', metric: 'battery_life_h', source: 'brief' },
  { id: 'usb', plain: 'Charges and runs over USB-C', metric: 'interface_present', source: 'inferred' },
  { id: 'size', plain: 'Fits within 60 by 40 mm', metric: 'board_size_mm', source: 'maker' },
] as never;
const usage = { calls: 2, inputTokens: 1100, outputTokens: 210, cacheReadTokens: 1140, cacheWriteTokens: 0, costUsd: 0.0041, capUsd: 2, agentMs: 4400, pipelineMs: 0, estimated: false };
const base = { brief: null, role: 'verifier', model: 'gpt-6.1-sol', working: false, usage: null };
const tool = { kind: 'tool', role: 'verifier', name: 'submit_requirements', ms: 2100, ok: true, summary: '3 checks', tokens: 2450, costUsd: 0.0041, estimated: false, sharedWith: 1 };
const turns: any[] = [
  { id: 'a', kind: 'agent', view: { ...base, brief: 'A focus timer that runs 4 h on a 1000 mAh battery, small enough for a desk', usage, items: [tool, { kind: 'requirements', requirements: req, notCheckable: ['That it looks nice on a desk'], summary: '', settled: 'open' }] } },
  { id: 'b', kind: 'agent', view: { ...base, items: [{ kind: 'requirements', requirements: req, notCheckable: [], summary: '', settled: 'confirmed' }] } },
  { id: 'c', kind: 'agent', view: { ...base, items: [{ kind: 'verify', ok: false, results: [
    { id: 'life', plain: 'Runs at least 4 hours on a 1000 mAh battery', status: 'unsupported', measured: 11.2, unit: 'h', estimated: true, evidence: 'This design has no battery. About 11 hours if it had one, from typical module currents.' },
    { id: 'usb', plain: 'Charges and runs over USB-C', status: 'pass', evidence: 'A USB-C block is in the plan.' },
    { id: 'size', plain: 'Fits within 60 by 40 mm', status: 'fail', measured: [90, 75], target: [60, 40], unit: 'mm', evidence: 'From the build record.' },
  ] }] } },
];
function App() {
  const [value, setValue] = useState(state === 'long' ? 'x'.repeat(2100) : '');
  const ref = useRef<HTMLTextAreaElement>(null);
  return <main className="st" style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 400, minHeight: '100vh', background: 'var(--paper)', margin: 0 }}>
    <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>{state === 'cards' ? turns.map(t => <AgentTurnCard key={t.id} turn={t} onBrief={() => {}} />) : <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Chat</p>}</div>
    <Composer value={value} setValue={setValue} onSubmit={() => {}} busy={state === 'busy'} hasDesign={false} hasBuild={false} inputRef={ref} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
