import { splitInlineCode } from './inlineCode';

export interface FrontHelpEntry { term: string; definition: string }

/** null/undefined and [] mean no help; undefined from this parser means invalid. */
export function parseFrontHelp(raw: unknown): FrontHelpEntry[] | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length > 2) return undefined;
  const result: FrontHelpEntry[] = [];
  const terms = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    if (Object.keys(entry).length !== 2 || !Object.keys(entry).every((key) => key === 'term' || key === 'definition')) return undefined;
    if (typeof entry.term !== 'string' || typeof entry.definition !== 'string') return undefined;
    const term = entry.term.trim();
    const definition = entry.definition.trim();
    if (!term || term.length > 80 || !definition || definition.length > 240 || terms.has(term.toLowerCase())) return undefined;
    terms.add(term.toLowerCase());
    result.push({ term, definition });
  }
  return result.length ? result : null;
}

export function unlinkedTermHelp(text: string, raw: unknown): FrontHelpEntry[] {
  const entries = parseFrontHelp(raw) ?? [];
  const linked = new Set<FrontHelpEntry>();
  for (const part of splitInlineCode(text)) {
    if (part.kind === 'code') continue;
    for (const { entry } of termHelpMatches(part.value, entries.filter(hint => !linked.has(hint)))) linked.add(entry);
  }
  return entries.filter(hint => !linked.has(hint));
}

export function termHelpMatches(text: string, entries: FrontHelpEntry[]) {
  const isWord = (character: string | undefined) => /[a-z0-9_]/i.test(character ?? '');
  const ordered = entries.flatMap(entry => {
    const hits = [];
    let offset = text.indexOf(entry.term);
    while (offset >= 0) {
      if (!(isWord(entry.term[0]) && isWord(text[offset - 1])) &&
          !(isWord(entry.term[entry.term.length - 1]) && isWord(text[offset + entry.term.length]))) {
        hits.push({ entry, offset });
      }
      offset = text.indexOf(entry.term, offset + entry.term.length);
    }
    return hits;
  })
    .sort((a, b) => a.offset - b.offset || b.entry.term.length - a.entry.term.length);
  let end = 0;
  const used = new Set<FrontHelpEntry>();
  return ordered.filter(({ entry, offset }) => {
    if (offset < end || used.has(entry)) return false;
    used.add(entry);
    end = offset + entry.term.length;
    return true;
  });
}
