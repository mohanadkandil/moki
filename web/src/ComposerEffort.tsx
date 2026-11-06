// The effort picker in the landing's composer. Loaded on its own, so the landing's first paint carries no agent code.
import type { ReactNode } from 'react';
import { useAgentStatus } from './studio/agentChat';
import { AgentPicker } from './studio/agentPicker';

export default function ComposerEffort({ mark }: { mark: ReactNode }) {
  const status = useAgentStatus();
  return <div className="st-agent-picker-scope"><AgentPicker status={status} placement="below" mark={mark} /></div>;
}
