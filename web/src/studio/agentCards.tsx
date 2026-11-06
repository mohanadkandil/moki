import { Check, ChevronRight, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { AgentRole, UsageTotals } from '../../../src/agents/protocol';
import { activityBlocks, activityLine, CONFIRM_TEXT, finishedLine, plainError, toolSteps, type AgentItem, type AgentTurn, type ToolStep } from './agentChat';
import { AgentMark } from './agentMark';
import { formatDuration } from './facts';
import './agent.css';

const ROLE: Record<AgentRole, string> = { designer: 'Designer', editor: 'Editor', fixer: 'Fixer', explainer: 'Explainer', firmware: 'Firmware', reviewer: 'Reviewer', verifier: 'Verifier', author: 'Block Author' };
const TOOL: Record<string, string> = {
  list_catalog: 'Read the catalog', get_module: 'Read a module', validate_design: 'Checked the design', propose_design: 'Proposed the design',
  decline: 'Said what’s missing', get_design: 'Read the design', read_job: 'Read the build record', propose_edit: 'Proposed a change',
  start_new: 'Handed to the designer', propose_fix: 'Proposed a fix', give_up: 'Stopped trying',
  list_metrics: 'Read what can be checked', submit_requirements: 'Wrote the checks', get_pin_map: 'Read the pin map', compile_app: 'Compiled the firmware',
  change_firmware: 'Handed to Firmware', change_requirements: 'Asked to change the checks', list_blocks: 'Read the circuit blocks', get_block: 'Read a block',
  search_parts: 'Searched for parts', get_part: 'Read a part', read_datasheet: 'Read a datasheet', check_plan: 'Checked the plan', propose_plan: 'Proposed a plan',
  get_plan: 'Read the plan', submit_review: 'Reported the review', read_failure: 'Read what failed',
  author_block: 'Wrote a new block', check_block: 'Checked a block', submit_block: 'Submitted a block', draft_example: 'Read an example block',
};

export const formatTokens = (n: number) => `${n.toLocaleString('en-US')} tok`;
export const formatCost = (usd: number) => (usd > 0 && usd < 0.0001 ? '<$0.0001' : `$${usd.toFixed(usd < 1 ? 4 : 2)}`);
const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : formatDuration(ms));

function ToolCard({ item }: { item: ToolStep }) {
  const [open, setOpen] = useState(false);
  const mark = item.estimated ? '~' : '';
  const canOpen = item.summaries.length > 0;
  const meta = [formatMs(item.ms), item.tokens !== null ? `${mark}${formatTokens(item.tokens)}` : null, item.costUsd !== null ? `${mark}${formatCost(item.costUsd)}` : null].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="st-agent-tool-mark" aria-hidden="true">{item.ok ? <Check size={13} /> : <X size={13} />}</span>
      <span className="st-agent-tool-name">{TOOL[item.name] ?? item.name}{item.count > 1 ? ` × ${item.count}` : ''}</span>
      <span className="st-agent-tool-meta">{meta}</span>
      {canOpen ? <ChevronRight size={13} className="st-stage-chev" aria-hidden="true" /> : <span />}
    </>
  );
  return (
    <li className={`st-agent-tool${item.ok ? '' : ' is-bad'}`}>
      {canOpen
        ? <button type="button" className="st-agent-tool-row" aria-expanded={open} onClick={() => setOpen(o => !o)}>{body}</button>
        : <div className="st-agent-tool-row">{body}</div>}
      {open && <p className="st-agent-tool-detail"><code>{item.name}</code> {item.summaries.join('; ')}</p>}
    </li>
  );
}

/** The Verifier writing to the maker. The checks it holds the design to stay underneath, as data. */
function RequirementsMessage({ item, onBrief }: { item: Extract<AgentItem, { kind: 'requirements' }>; onBrief: (text: string) => void }) {
  return (
    <>
      <p className="st-agent-text">{item.message}</p>
      {item.settled === 'open' && item.requirements.length > 0 && (
        <div className="st-agent-checks-foot">
          <button type="button" className="st-paper-button is-primary" onClick={() => onBrief(CONFIRM_TEXT)}>Looks right</button>
          <span>Or tell me what to change.</span>
        </div>
      )}
    </>
  );
}

const shown = (value: unknown, unit?: string) => `${Array.isArray(value) ? value.join(' × ') : String(value)}${unit ? ` ${unit}` : ''}`;

function VerifyCard({ item }: { item: Extract<AgentItem, { kind: 'verify' }> }) {
  const passed = item.results.filter(r => r.status === 'pass').length;
  const failed = item.results.filter(r => r.status === 'fail').length;
  const open = item.results.length - passed - failed;
  const head = [`${passed} of ${item.results.length} requirements met`, failed ? `${failed} failed` : '', open ? `${open} not checked` : ''].filter(Boolean).join(', ');
  return (
    <section className={`st-agent-checks is-result${failed ? ' is-bad' : ''}`} aria-label="Requirement results">
      <h3>{head}</h3>
      <ul>
        {item.results.filter(r => r.status !== 'unsupported').map(r => (
          <li key={r.id} className={`is-${r.status}`}>
            <span className="st-agent-check-mark" aria-hidden="true">{r.status === 'pass' ? <Check size={13} /> : <X size={13} />}</span>
            <span>{r.plain}</span>
            <small>
              {/* A word like "knob" measured against "knob" says nothing the evidence doesn't. */}
              {r.measured !== undefined && (typeof r.measured !== 'string' || r.status === 'fail') ? `${r.estimated ? 'About ' : ''}${shown(r.measured, r.unit)}${r.target !== undefined ? `, needs ${shown(r.target, r.unit)}` : ''}. ` : ''}
              {r.evidence}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UsageLine({ usage }: { usage: UsageTotals }) {
  if (!usage.calls) return null;
  const mark = usage.estimated ? '~' : '';
  const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return (
    <p className="st-agent-usage">
      {usage.calls} model call{usage.calls === 1 ? '' : 's'} · {mark}{formatTokens(tokens)} · {mark}{formatCost(usage.costUsd)} of ${usage.capUsd.toFixed(2)} · {formatMs(usage.agentMs + usage.pipelineMs)}
      {usage.estimated ? <><br />Estimated, not a provider bill.</> : null}
    </p>
  );
}

/** One line for an agent's steps, live while it works. The steps and their cost are there for anyone who wants them. */
function ActivityLine({ role, tools, live, usage }: { role: AgentRole; tools: Extract<AgentItem, { kind: 'tool' }>[]; live: boolean; usage: UsageTotals | null }) {
  const [open, setOpen] = useState(false);
  const { steps, fromMemory } = toolSteps(tools);
  return (
    <div className="st-agent-activity">
      <p className="st-agent-who"><AgentMark on size={13} />{ROLE[role]}</p>
      <button type="button" className="st-agent-line" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {live && <LoaderCircle size={13} className="st-spin" aria-hidden="true" />}
        <span aria-live={live ? 'polite' : undefined}>{live ? activityLine(tools) : finishedLine(role, tools)}</span>
        <ChevronRight size={13} className="st-stage-chev" aria-hidden="true" />
      </button>
      {open && (
        <>
          {steps.length > 0 && <ol className="st-agent-tools" aria-label={`${ROLE[role]} steps`}>{steps.map((item, i) => <ToolCard key={i} item={item} />)}</ol>}
          {fromMemory > 0 && <p className="st-reading-note">{fromMemory} more read{fromMemory === 1 ? '' : 's'} answered instantly from memory.</p>}
          {usage && <UsageLine usage={usage} />}
        </>
      )}
    </div>
  );
}

export function AgentTurnCard({ turn, onBrief, canRetry = false }: { turn: AgentTurn; onBrief: (text: string) => void; /** Only the latest turn, so an old failure can't resend old words. */ canRetry?: boolean }) {
  const { view } = turn;
  // Steps stay where they happened, with what the agent said after them.
  const blocks = activityBlocks(view.items);
  const lastActivity = blocks.reduce((found, block, i) => ('tools' in block ? i : found), -1);
  const onLine = view.working && lastActivity === blocks.length - 1 && lastActivity >= 0;
  return (
    <>
      {view.brief && <div className="st-turn st-brief"><p>{view.brief}</p></div>}
      <div className="st-turn st-agent">
        {blocks.map((block, i) => {
          if ('tools' in block) return <ActivityLine key={i} role={block.role} tools={block.tools} live={onLine && i === lastActivity} usage={i === lastActivity ? view.usage : null} />;
          const { item } = block;
          switch (item.kind) {
            case 'message': return <p key={i} className="st-agent-text">{item.text}</p>;
            case 'changes': return <ul key={i} className="st-agent-changes">{item.lines.map(line => <li key={line}>{line}</li>)}</ul>;
            case 'note': return <p key={i} className="st-reading-note">{item.text}</p>;
            case 'requirements': return <RequirementsMessage key={i} item={item} onBrief={onBrief} />;
            case 'verify': return <VerifyCard key={i} item={item} />;
            case 'error':
              return (
                <div key={i} className="st-say is-error">
                  <CircleAlert size={15} aria-hidden="true" />
                  <div>
                    <p>{plainError(item.text)}</p>
                    {canRetry && (item.interrupted?.retry ?? view.brief) && <div className="st-say-actions"><button type="button" className="st-paper-button" onClick={() => onBrief((item.interrupted?.retry ?? view.brief)!)}>Try again</button></div>}
                  </div>
                </div>
              );
            case 'decline':
              return (
                <Fragment key={i}>
                  <p className="st-agent-text">{item.message}</p>
                  {item.closest && <p className="st-agent-text">{item.closest}</p>}
                  {item.closestBrief && <div className="st-say-actions"><button type="button" className="st-paper-button" onClick={() => onBrief(item.closestBrief!)}>Build the closest</button></div>}
                </Fragment>
              );
            default: return null;
          }
        })}
        {view.working && !onLine && <p className="st-sending" role="status"><LoaderCircle size={14} className="st-spin" aria-hidden="true" />{ROLE[view.role]} is working</p>}
      </div>
    </>
  );
}
