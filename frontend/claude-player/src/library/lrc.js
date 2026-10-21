// Lyrics text: LRC ([mm:ss.xx] line timestamps, several per line allowed,
// [offset:±ms], enhanced <mm:ss.xx> word times dropped) or plain text.
// Returns {synced, lines: [{t, text}]} with t in ms (null when unsynced).

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const TAG = /^\[([a-z#]+):(.*)\]\s*$/i;

function ms(m, s, frac) {
  const f = frac ? Math.round(+('0.' + frac) * 1000) : 0;
  return (+m * 60 + +s) * 1000 + f;
}

export function parseLyrics(text) {
  if (!text) return null;
  const lines = [];
  let offset = 0, timed = false;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const tag = TAG.exec(raw);
    if (tag && !/^\d/.test(tag[1])) {
      if (tag[1].toLowerCase() === 'offset') offset = parseInt(tag[2]) || 0;
      continue;
    }
    const times = [];
    let rest = raw, m;
    TIME.lastIndex = 0;
    while ((m = TIME.exec(rest)) && m.index === 0) {
      times.push(ms(m[1], m[2], m[3]));
      rest = rest.slice(m[0].length);
      TIME.lastIndex = 0;
    }
    const line = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
    if (times.length) {
      timed = true;
      for (const t of times) lines.push({t, text: line});
    } else lines.push({t: null, text: line});
  }
  if (timed) {
    // LRC offset: positive values show lines earlier.
    const synced = lines.filter(l => l.t !== null).map(l => ({t: Math.max(0, l.t - offset), text: l.text}));
    synced.sort((a, b) => a.t - b.t);
    return {synced: true, lines: synced};
  }
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  while (lines.length && !lines[0].text) lines.shift();
  return lines.length ? {synced: false, lines} : null;
}

/** The track's lyrics: a sidecar .lrc, then synchronised, then plain tag lyrics. */
export function trackLyrics(t) {
  if (!t) return null;
  // Parsed once per text (cached on the track, not persisted).
  const key = (t.lyricsFile ?? '') + '\u0000' + (t.lyricsSynced ?? '') + '\u0000' + (t.lyrics ?? '');
  if (t._lyricsKey !== key) {
    Object.defineProperty(t, '_lyricsKey', {value: key, writable: true, enumerable: false, configurable: true});
    Object.defineProperty(t, '_lyrics', {value: parseLyrics(t.lyricsFile) ?? parseLyrics(t.lyricsSynced) ?? parseLyrics(t.lyrics), writable: true, enumerable: false, configurable: true});
  }
  return t._lyrics;
}

/** Index of the line active at position ms (the last line starting at or before it). */
export function activeLine(lyr, posMs) {
  if (!lyr?.synced) return -1;
  let lo = 0, hi = lyr.lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lyr.lines[mid].t <= posMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
