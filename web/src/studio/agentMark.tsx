// The agent's mark. It is one component on purpose: the brand isn't decided, so this is the only place to swap.
// Filled means an AI model reads the brief. A plain ring means the rules do.
export function AgentMark({ on, size = 15 }: { on: boolean; size?: number }) {
  return (
    <svg className={`st-agent-mark${on ? '' : ' is-off'}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {on ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <circle cx="10.6" cy="5.8" r="1.7" fill="var(--paper-raised)" />
        </>
      ) : <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}
