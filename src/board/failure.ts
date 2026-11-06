// What a person reads when a pipeline step throws. The whole text, with its source excerpt and stack,
// stays in the job's files (job.json, render.log). Agents, the chat and the studio all read this instead.
const WRAPPER = /^(?:Chip EDA|EDA render|Enclosure|Firmware generator)\b[^:\n]*failed[^:\n]*:\s*/;
const NAMED = /(?:^|[\s:])(?:(?:[A-Z]\w*)?Error|fatal error|error)(?:\[\w+\])?:\s*(.+)$/;
const STEPS: [RegExp, string][] = [
  [/^(?:Chip EDA|EDA render)\b/, 'The build failed during layout.'],
  [/^Enclosure\b/, 'The build failed while making the case.'],
  [/^Firmware generator\b/, 'The build failed while generating the firmware.'],
];
const MAX = 240;

/** A runtime's or compiler's echo of the code: numbered source, a caret, a stack frame, a traceback. */
export const isSourceLine = (line: string) => /^\s*(?:\d+\s*\|.*|\|?\s*[\^~]+\s*|at\s.*:\d+:\d+\)?|at\s\S+\s*\(.*\)|Traceback \(most recent.*|File ".*", line \d+.*)$/.test(line);

/** Takes source echoes out of text that may quote them, leaving everything else as written. */
export const withoutSourceLines = (text: string) => (text.split('\n').some(isSourceLine) ? text.split('\n').filter(line => !isSourceLine(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim() : text);

/** The error's own first message line: never source, never this server's paths. Empty if it has none. */
export function firstErrorLine(raw: string): string {
  const lines = raw.replace(WRAPPER, '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !isSourceLine(line));
  const named = lines.map(line => NAMED.exec(line)?.[1]).find(Boolean);
  const line = (named ?? lines[0] ?? '').replace(/(?<![\w.])\/(?:[^\s/:'"]+\/)+/g, '').trim();
  return line.length > MAX ? `${line.slice(0, MAX)}…` : line;
}

/** One human sentence, then the error's first message line. */
export function jobFailure(error: string | undefined): string {
  if (!error) return 'The build failed with no reported error.';
  const sentence = STEPS.find(([step]) => step.test(error))?.[1] ?? 'The build failed.';
  const line = firstErrorLine(error);
  return line ? `${sentence} ${line}${/[.!?…]$/.test(line) ? '' : '.'}` : sentence;
}
