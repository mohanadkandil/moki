import { useMemo } from 'react';
import { tokenize } from './highlight';

export function Highlighted({ code }: { code: string }) {
  const tokens = useMemo(() => tokenize(code), [code]);
  return <>{tokens.map((t, i) => (t.kind === 'plain' ? t.text : <span key={i} className={`tk-${t.kind}`}>{t.text}</span>))}</>;
}

export function Gutter({ lines }: { lines: number }) {
  const text = useMemo(() => Array.from({ length: lines }, (_, i) => i + 1).join('\n'), [lines]);
  return <pre className="st-gutter" aria-hidden="true">{text}</pre>;
}

/** Read-only source with line numbers. */
export function CodeView({ code, label }: { code: string; label: string }) {
  return (
    <div className="st-code" tabIndex={0} role="region" aria-label={label}>
      <Gutter lines={code.split('\n').length} />
      <pre className="st-code-text"><code><Highlighted code={code} /></code></pre>
    </div>
  );
}
