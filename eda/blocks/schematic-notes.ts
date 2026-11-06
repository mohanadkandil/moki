/** Text layout only: the SVG caller remains responsible for XML escaping and links. */
export interface SchematicNotesInput {
  notes: readonly string[];
  reference?: { lcsc: string; page: number; figure?: string; quote: string };
}
export interface SchematicNotesOptions {
  maxWidth?: number;
  fontSize?: number;
  maxChars?: number;
  lineHeight?: number;
  noteStartY?: number;
  minHeight?: number;
}

// Upper bounds for ordinary Arial/sans-serif glyph advances, in em. Wide letters
// and unknown Unicode receive extra room; character count alone would clip WWW.
const advance = (char: string): number => {
  if (char === ' ') return 0.4;
  if (/[MWmw@%]/u.test(char)) return 1.1;
  if (/[A-Z]/u.test(char)) return 0.9;
  if (/[a-z0-9]/u.test(char)) return 0.7;
  if (/[.,:;!'|`]/u.test(char)) return 0.45;
  return 1.1;
};

export function layoutSchematicNotes(section: SchematicNotesInput, options: SchematicNotesOptions = {}) {
  const maxWidth = options.maxWidth ?? 914;
  const fontSize = options.fontSize ?? 14;
  const maxChars = options.maxChars ?? 100;
  const lineHeight = options.lineHeight ?? 21;
  const noteStartY = options.noteStartY ?? 510;
  const minHeight = options.minHeight ?? 620;
  for (const [key, value] of Object.entries({ maxWidth, fontSize, maxChars, lineHeight, noteStartY, minHeight })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid schematic notes ${key}`);
  }
  if (!Number.isInteger(maxChars) || maxWidth < fontSize * 1.1 || lineHeight < fontSize)
    throw new Error('Schematic notes capacity cannot fit a glyph or line');

  const fits = (text: string) => {
    const chars = Array.from(text);
    return chars.length <= maxChars && chars.reduce((sum, char) => sum + advance(char) * fontSize, 0) <= maxWidth;
  };
  const wrap = (text: string): string[] => {
    const lines: string[] = [];
    // Explicit paragraph breaks survive; other whitespace becomes a normal SVG
    // word separator. No words, quoted content or individual notes are omitted.
    for (const paragraph of text.split(/\r\n|\r|\n/u)) {
      let line = '';
      const words = paragraph.trim().split(/\s+/u).filter(Boolean);
      for (const word of words) {
        if (fits(line ? `${line} ${word}` : word)) {
          line = line ? `${line} ${word}` : word;
          continue;
        }
        if (line) { lines.push(line); line = ''; }
        // Split an oversized URL, hash or other unbroken token by code point,
        // preserving surrogate pairs and every character of the token.
        for (const char of word) {
          if (line && !fits(line + char)) { lines.push(line); line = ''; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const noteLines = section.notes.flatMap(wrap);
  const ref = section.reference;
  const referenceLines = ref
    ? wrap(`${ref.lcsc} · reference p${ref.page}${ref.figure ? ` · Fig ${ref.figure}` : ''} · ${ref.quote}`)
    : [];
  const referenceStartY = noteStartY + noteLines.length * lineHeight + (noteLines.length && referenceLines.length ? 9 : 0);
  const lastBaseline = referenceLines.length
    ? referenceStartY + (referenceLines.length - 1) * lineHeight
    : noteLines.length ? noteStartY + (noteLines.length - 1) * lineHeight : 0;
  return {
    noteLines,
    referenceLines,
    noteStartY,
    referenceStartY,
    lineHeight,
    neededHeight: Math.max(minHeight, Math.ceil(lastBaseline + fontSize * 0.4 + 18)),
  };
}
