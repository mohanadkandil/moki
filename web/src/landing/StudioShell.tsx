// The studio's frame, drawn at once from what we already know. It shows until the real studio is ready, in the same
// places, so opening a project never passes through a loading screen.
import { ArrowUp, MessageSquare, PanelsTopLeft } from 'lucide-react';
import { atBase } from '../board/base';
import { AgentMark } from '../studio/agentMark';
import { WORDMARK } from '../studio/conversation';
import '../studio/studio.css';
import './landing.css';
import type { ProjectHint } from './startProject';

const TABS = ['Schematic', 'PCB', '3D', 'Case', 'Firmware', 'Code'];

/** The picker's own memory, read directly, so the frame needs none of the agent code to look right. */
function effortLabel() {
  try { return ({ fast: 'Fast', deep: 'Deep' } as Record<string, string>)[globalThis.localStorage?.getItem('moki.agent.effort') ?? ''] ?? 'Balanced'; } catch { return 'Balanced'; }
}

export function StudioShell({ hint }: { hint: ProjectHint }) {
  return (
    <div className={`st${hint.title ? ' has-project' : ''}`} data-view="chat" aria-busy="true">
      <section className="st-chat" aria-label="Chat">
        <header className="st-chat-head">
          <a className="st-wordmark" href={atBase('/')} aria-label={`${WORDMARK} home`}>{WORDMARK}</a>
          {hint.title && <div className="st-project st-project-title"><span className="st-title-button">{hint.title}</span></div>}
          <span className="st-head-grow" />
          <div className="st-switch" aria-hidden="true">
            <button type="button" tabIndex={-1} aria-pressed="true"><MessageSquare size={14} aria-hidden="true" />Chat</button>
            <button type="button" tabIndex={-1} aria-pressed="false"><PanelsTopLeft size={14} aria-hidden="true" />Board</button>
          </div>
        </header>
        <div className="st-thread">
          {hint.brief && <div className="st-turn st-brief"><p>{hint.brief}</p></div>}
        </div>
        <div className="st-composer" aria-hidden="true">
          <textarea rows={2} disabled tabIndex={-1} placeholder="Ask for a change" />
          <div className="st-composer-foot">
            <div className="st-agent-picker"><div className="st-agent-picker-button"><AgentMark on /><span>{effortLabel()}</span></div></div>
            <button type="button" className="st-send" disabled tabIndex={-1}><ArrowUp size={16} aria-hidden="true" /></button>
          </div>
        </div>
      </section>
      <section className="st-work" aria-label="Canvas">
        <header className="st-bar">
          <div className="st-tabs" aria-hidden="true">{TABS.map((tab, i) => <button key={tab} type="button" tabIndex={-1} aria-selected={i === 0}><span className="st-tab-label">{tab}</span></button>)}</div>
        </header>
        <div className="st-canvas" />
      </section>
    </div>
  );
}
