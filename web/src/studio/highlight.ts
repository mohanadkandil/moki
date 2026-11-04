// A small tokenizer for the two languages on screen, C++ and TSX. It colors code; it doesn't parse it.
export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'tag' | 'attr';
export interface Token { kind: TokenKind; text: string }

const KEYWORDS = new Set(['const', 'constexpr', 'let', 'var', 'int', 'bool', 'void', 'float', 'unsigned', 'long', 'char', 'auto', 'static', 'struct', 'enum', 'class', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'true', 'false', 'null', 'nullptr', 'export', 'default', 'function', 'import', 'from', 'new', 'uint8_t', 'uint16_t', 'uint32_t', 'int32_t']);
const PATTERN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|^[ \t]*#[^\n]*|^;[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[A-Za-z][\w.]*)|\b([A-Za-z_][\w]*)(?==[{"'])|\b(\d+(?:\.\d+)?(?:[a-zA-Z]+)?|0x[0-9a-fA-F]+)\b|\b([A-Za-z_]\w*)\b/gm;

export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  const push = (kind: TokenKind, text: string) => {
    const previous = tokens.at(-1);
    if (previous && previous.kind === kind) previous.text += text;
    else tokens.push({ kind, text });
  };
  for (const m of code.matchAll(PATTERN)) {
    if (m.index > last) push('plain', code.slice(last, m.index));
    if (m[1]) push('comment', m[0]);
    else if (m[2]) push('string', m[0]);
    else if (m[3]) push('tag', m[0]);
    else if (m[4]) push('attr', m[0]);
    else if (m[5]) push('number', m[0]);
    else push(KEYWORDS.has(m[0]) ? 'keyword' : 'plain', m[0]);
    last = m.index + m[0].length;
  }
  if (last < code.length) push('plain', code.slice(last));
  return tokens;
}
