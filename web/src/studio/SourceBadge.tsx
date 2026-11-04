/** @jsxRuntime automatic */
// The pragma lets the node test runner render this outside the web build's tsconfig.
import { Check, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { SourceStatus } from './facts';

export function SourceBadge({ status }: { status: SourceStatus }) {
  const icon = { ok: <Check size={13} aria-hidden="true" />, error: <CircleX size={13} aria-hidden="true" />, warn: <TriangleAlert size={13} aria-hidden="true" />, busy: <LoaderCircle size={13} className="st-spin" aria-hidden="true" />, quiet: null }[status.tone];
  const tone = status.tone === 'busy' || status.tone === 'quiet' ? '' : ` is-${status.tone}`;
  return <span className={`st-badge${tone}`}>{icon}{status.label}</span>;
}
