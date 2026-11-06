// A brief pasted from a terminal or a quoted message carries its gutter and its line wrapping along with it.

/** A quote gutter at the start of a line: terminal box and block characters, or a mail-style quote. */
const GUTTER = /^[ \t]*(?:(?:[│┃┆┇┊┋║▀-▟]|>(?=\s|$))[ \t]*)+/;
const LIST_ITEM = /^(?:[-*•]|\d+[.)])\s/;

/** The words of a brief without what the paste added. A blank line stays a paragraph, and a list stays a list. */
export function cleanBrief(text: string): string {
  const out: string[] = [];
  let joinable = false;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(GUTTER, '').replace(/[ \t]+/g, ' ').trim();
    if (!line) { if (out.length && out.at(-1) !== '') out.push(''); joinable = false; continue; }
    if (joinable && !LIST_ITEM.test(line)) out[out.length - 1] += ` ${line}`;
    else out.push(line);
    joinable = true;
  }
  return out.join('\n').trim();
}
