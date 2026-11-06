// The composer's agent control: the mark, and how hard the agent should try. Model names and money live in the
// popover, so the composer stays about the maker's sentence.
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AgentStatus, EffortOption } from '../../../src/agents/protocol';
import { useEffort } from './agentChat';
import { AgentMark } from './agentMark';
import './agent.css';

const money = (usd: number) => (usd < 0.01 ? 'under $0.01' : usd < 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(usd % 1 ? 2 : 0)}`);
const cost = (e: EffortOption) => (e.avgCostUsd === null ? 'No builds yet' : `About ${money(e.avgCostUsd)} a build, from ${e.builds} build${e.builds === 1 ? '' : 's'}`);

export function AgentPicker({ status, placement = 'above', mark }: { status: AgentStatus | null; placement?: 'above' | 'below'; mark?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [effort, setEffort] = useEffort();
  const root = useRef<HTMLDivElement>(null);
  const name = useId();
  const on = Boolean(status?.enabled);
  const options = status?.efforts ?? [];
  const current = options.find(e => e.id === effort) ?? options.find(e => e.id === 'balanced');

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
  }, [open]);

  const label = on ? (current?.label ?? 'Agent') : 'Rules';
  return (
    <div className={`st-agent-picker${placement === 'below' ? ' is-below' : ''}`} ref={root}>
      <button type="button" className="st-agent-picker-button" aria-expanded={open} aria-haspopup="dialog" aria-label={on ? `Agent effort: ${label}. Change` : 'Read by rules. About this'} onClick={() => setOpen(v => !v)}>
        {mark ?? <AgentMark on={on} />}
        <span>{label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="st-agent-picker-pop" role="dialog" aria-label={on ? 'Agent effort' : 'About the rules'}>
          {on && options.length > 0 ? (
            <fieldset>
              <legend className="st-sr">How hard the agent should try</legend>
              {options.map(option => (
                <label key={option.id} className={option.id === current?.id ? 'is-on' : undefined}>
                  <input type="radio" name={name} className="st-sr" checked={option.id === current?.id} onChange={() => setEffort(option.id)} />
                  <span className="st-agent-picker-tick" aria-hidden="true">{option.id === current?.id ? <Check size={14} /> : null}</span>
                  <span className="st-agent-picker-name">{option.label}</span>
                  <span className="st-agent-picker-use">{option.use}</span>
                  <small>{option.model}, {option.reasoning} reasoning. Up to {money(option.capUsd)} a build. {cost(option)}.</small>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="st-agent-picker-note">{on ? `${status?.model ?? 'The agent'}, up to $${status?.capUsd.toFixed(0)} a build.` : `Read by rules, not an AI model.${status?.reason ? ` ${status.reason}` : ''}`}</p>
          )}
        </div>
      )}
    </div>
  );
}
