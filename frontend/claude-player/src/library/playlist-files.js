// Playlist files (y51 / lc0 / PlaylistsExportActivity; notebook F66).
// Reading: .m3u8 as UTF-8; .m3u as UTF-8 with m3u_utf8 (default on), else in
// the tag encoding; .pls by its FileN= lines; .wpl / .zpl by their media src.
// In M3U, #EXTINF gives an entry's title and, with pl_import_ratings,
// #EXT-X-RATING: the rating of the next entry. Writing (lc0): "#EXTM3U", then
// per entry "#EXT-X-RATING:<rating>" and its path, CRLF line ends, UTF-8,
// one <name>.m3u8 per playlist.
// Entries resolve to library tracks by path (the longest matching tail),
// else by file name. Unresolved entries stay in the playlist (path:<path>)
// and pl_auto_resolve matches them again whenever the library changes.
import {decodeTextFile} from './tags.js';

export const UNRESOLVED = 'path:';
const KIND = {m3u: 1, pls: 2, wpl: 3, zpl: 3, m3u8: 0};

const extOf = name => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
const norm = p => String(p ?? '').replace(/\\/g, '/').replace(/^file:\/\//i, '').trim();
const base = p => { const n = norm(p); return n.slice(n.lastIndexOf('/') + 1).toLowerCase(); };

/** Entries {path, title, rating} of a playlist file's bytes. */
export function parsePlaylist(name, bytes, {utf8M3u = true, ratings = false} = {}) {
  const kind = KIND[extOf(name)] ?? 0;
  const text = decodeTextFile(bytes, kind !== 1 || utf8M3u, false);
  const out = [];
  if (kind === 2) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^File\d*\s*=\s*(.+)$/i.exec(line.trim());
      if (m && m[1].trim().length > 4) out.push({path: m[1].trim(), title: null, rating: -1});
    }
    return out;
  }
  if (kind === 3) {
    for (const m of text.matchAll(/<media\b[^>]*\bsrc\s*=\s*"([^"]*)"/gi)) out.push({path: m[1].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"'), title: null, rating: -1});
    return out;
  }
  let title = null, rating = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length <= 4) continue;
    if (line[0] === '#') {
      if (/^#EXT-X-RATING:/i.test(line)) { if (ratings) rating = parseInt(line.slice(14), 10); }
      else if (/^#EXTINF:/i.test(line)) { const c = line.indexOf(',', 8); if (c !== -1 && c < line.length - 1) title = line.slice(c + 1).trim(); }
      continue;
    }
    out.push({path: line, title, rating: Number.isFinite(rating) ? rating : -1});
    title = null;
    rating = -1;
  }
  return out;
}

/** A library track for an entry path: the longest matching path tail, else the file name. */
export function resolveEntry(library, path) {
  const want = norm(path).toLowerCase();
  if (!want) return null;
  let best = null, bestLen = 0;
  const name = base(want);
  for (const t of library.tracks) {
    const p = norm(t.path || t.fileName).toLowerCase();
    if (!p || base(p) !== name) continue;
    let n = 0;
    while (n < p.length && n < want.length && p[p.length - 1 - n] === want[want.length - 1 - n]) n++;
    if (n > bestLen) { best = t; bestLen = n; }
  }
  return best;
}

/** The M3U8 text of a playlist (lc0). */
export function playlistText(playlists, pl) {
  const byId = playlists.library.byId;
  const lines = ['#EXTM3U'];
  for (const id of pl.ids) {
    const t = byId.get(id);
    const path = t ? t.path || t.fileName || t.title : id.startsWith(UNRESOLVED) ? id.slice(UNRESOLVED.length) : null;
    if (!path) continue;
    lines.push('#EXT-X-RATING:' + (t?.rating ?? 0), path);
  }
  return lines.join('\r\n') + '\r\n';
}

/** Downloads each playlist as <name>.m3u8 (file-based ones only with fileBased). */
export function exportPlaylists(ctx, {fileBased = true} = {}) {
  const P = ctx.playlists;
  let n = 0;
  for (const pl of P?.items ?? []) {
    if (pl.path && !fileBased) continue;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([playlistText(P, pl)], {type: 'audio/x-mpegurl'}));
    const name = pl.name.replace(/[\\/:*?"<>|]/g, '_');
    a.download = name.endsWith('.m3u8') ? name : name + '.m3u8';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    n++;
  }
  return n;
}

/**
 * Imports playlist files (File objects): each becomes a file-based playlist
 * named by its file (an existing one from the same file is replaced).
 * Returns {playlists, entries, unresolved}.
 */
export async function importPlaylistFiles(ctx, files) {
  const P = ctx.playlists, lib = ctx.library;
  const utf8M3u = ctx.pref?.('m3u_utf8') !== false, ratings = !!ctx.pref?.('pl_import_ratings');
  const res = {playlists: 0, entries: 0, unresolved: 0};
  for (const f of files) {
    if (!(extOf(f.name) in KIND)) continue;
    const entries = parsePlaylist(f.name, new Uint8Array(await f.arrayBuffer()), {utf8M3u, ratings});
    const ids = [];
    for (const e of entries) {
      const t = resolveEntry(lib, e.path);
      if (t) {
        ids.push(t.id);
        if (ratings && e.rating >= 0 && e.rating <= 5 && t.rating !== e.rating) lib.setRating?.(t, e.rating);
      } else { ids.push(UNRESOLVED + norm(e.path)); res.unresolved++; }
    }
    const name = f.name.replace(/\.[^.]+$/, '');
    let pl = P.items.find(p => p.path === f.name);
    if (!pl) { pl = P.create(name); pl.path = f.name; }
    P.reorder(pl, ids);
    res.playlists++;
    res.entries += ids.length;
  }
  return res;
}

/** pl_auto_resolve: unresolved entries matched against the library again. */
export function autoResolve(ctx) {
  if (ctx.pref?.('pl_auto_resolve') === false) return;
  const P = ctx.playlists, lib = ctx.library;
  for (const pl of P?.items ?? []) {
    if (!pl.ids.some(id => id.startsWith(UNRESOLVED))) continue;
    let changed = false;
    const ids = pl.ids.map(id => {
      if (!id.startsWith(UNRESOLVED)) return id;
      const t = resolveEntry(lib, id.slice(UNRESOLVED.length));
      if (!t) return id;
      changed = true;
      return t.id;
    });
    if (changed) P.reorder(pl, ids);
  }
}
