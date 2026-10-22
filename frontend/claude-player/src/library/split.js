// Multiple artists / composers / genres in one tag (the scanner's
// MultiTagMatcher, lw0; notebook F63). The split symbols (artists_split_chars,
// composers_split_chars, genres_split_chars: tags joined by U+001F; genres
// default to ";" and "//") separate the parts case-insensitively, with the
// whitespace around them dropped. A name from the exceptions
// (artists_split_ignore: "AC/DC | +/-") at the start of a part stays whole.

const quote = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const GENRE_DEFAULT_SPLIT = ';\u001f//';

/** A splitter for split symbols and exceptions, or null when nothing splits. */
export function makeSplitter(chars, exceptions = '') {
  const seen = new Set(), tokens = [];
  for (const t of String(chars ?? '').split('\u001f')) {
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    tokens.push(t);
  }
  if (!tokens.length) return null;
  const sep = new RegExp(`\\s*(?:${tokens.map(quote).join('|')})\\s*`, 'giu');
  const exc = [...new Set(String(exceptions ?? '').split(/\s*\|\s*/).map(e => e.trim()).filter(Boolean))];
  const sepAt = new RegExp(sep.source, 'giuy');
  const afterExc = new RegExp(`^\\s*(?:$|(?:${tokens.map(quote).join('|')}))`, 'iu');
  return value => {
    const s = String(value ?? '');
    const parts = [];
    let i = 0;
    while (i <= s.length) {
      // An exception at the start of a part, followed by a separator or the end.
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      const lower = s.slice(j).toLowerCase();
      const e = exc.find(x => lower.startsWith(x.toLowerCase()) && afterExc.test(s.slice(j + x.length)));
      if (e) {
        parts.push(s.slice(j, j + e.length));
        sepAt.lastIndex = j + e.length;
        const m = sepAt.exec(s);
        if (!m) break;
        i = m.index + m[0].length;
        continue;
      }
      sep.lastIndex = i;
      const m = sep.exec(s);
      if (!m) { parts.push(s.slice(i)); break; }
      parts.push(s.slice(i, m.index));
      i = m.index + m[0].length;
    }
    const out = [], keys = new Set();
    for (const p of parts) {
      const t = p.trim();
      if (t && !keys.has(t.toLowerCase())) { keys.add(t.toLowerCase()); out.push(t); }
    }
    return out;
  };
}
