// A short title from a brief, with no model call, so it is free and always there. The maker can change it.
// Pure, because the server stores it and the browser shows it the moment a brief is sent.
export function titleFromBrief(brief: string): string {
  const firstLine = brief.trim().split(/\r?\n/)[0] ?? '';
  const clause = (firstLine.split(/(?<=[a-z0-9)])[.!?:;](?:\s|$)|\s[—–-]\s/i)[0] ?? firstLine).trim();
  const bare = clause.replace(/^(?:(?:please|can you|could you|i want(?: to)?|i need|i'd like(?: to)?|let's|let us|help me|make(?: me)?|build(?: me)?|create(?: me)?|design(?: me)?)\s+)+/i, '').replace(/^(?:an?|the|some|something for)\s+(?=\S)/i, match => (/something/i.test(match) ? match : ''));
  // "A focus timer with a screen" is called a focus timer. The rest of the brief is still there to read.
  const named = /^(.{6,}?)\s+(?:with|that|which|using|powered)\s/i.exec(bare)?.[1] ?? bare;
  const text = (named || clause || 'Untitled project').replace(/\s+/g, ' ');
  const limit = 48;
  const cut = text.length <= limit ? text : `${text.slice(0, text.lastIndexOf(' ', limit) > 16 ? text.lastIndexOf(' ', limit) : limit)}…`;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}
